import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import type { AnalyzeInput } from "@/lib/domain/contracts";
import { brand, pendingImage, product } from "@/lib/db/schema";
import { isUploadSourceUrl } from "@/lib/media/images";
import { pushPendingImages } from "@/lib/workflows/pending-images";

import { createBrand } from "../brands";
import { ServiceError } from "../errors";
import { deletePendingImage, listPendingImages, uploadProductImages } from "../product-images";
import { importFromImage } from "../products";
import { fakeIntegrations, newBrandInput, setupTestEnv, testDeps, type TestEnv } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-0123456789";

vi.mock("@/lib/services/internal/credentials", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getShopifyCredentialsFor: async () => ({
    creds: { shopDomain: "acme.myshopify.com", accessToken: "token" },
    templateSuffix: null,
  }),
}));

let env: TestEnv;
let brandId: string;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(brand);
  brandId = (await createBrand(env.a.owner, newBrandInput())).id;
});

const png = (seed: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1, seed + 2]);

const analysis = {
  productName: "Sunset projection lamp",
  category: "Home decor",
  description: "A lamp that projects a sunset.",
  features: ["USB powered"],
  sellingPoints: ["Cozy light"],
  keywords: ["sunset lamp"],
  bestFrameSec: null,
  confidence: 0.9,
};

function imageIntegrations() {
  const analyze = vi.fn(async (_ctx: unknown, input: AnalyzeInput) => ({
    data: { ...analysis, referenceImageUrl: input.source === "image" ? input.imageUrl : null },
    usage: [{ provider: "anthropic" as const, model: "claude", costUsd: 0.01 }],
  }));
  const attachImage = vi.fn(async (_creds: unknown, input: { idempotencyKey: string }) => ({
    mediaId: "gid://shopify/MediaImage/1",
    url: `https://cdn.shopify.com/s/files/tcu-${input.idempotencyKey.slice(0, 16)}.png`,
  }));
  return {
    analyze,
    attachImage,
    integrations: fakeIntegrations({ productAnalyzer: { analyze }, shopify: { attachImage } }),
  };
}

describe("importFromImage (image search)", () => {
  it("stores the uploaded photo, analyses it from its bytes and dedupes re-uploads", async () => {
    const { integrations, analyze } = imageIntegrations();
    const first = await importFromImage(
      env.a.creative,
      { brandId, image: png(1) },
      testDeps(integrations),
    );
    expect(first.created).toBe(true);
    expect(first.product).toMatchObject({
      sourceType: "image",
      status: "awaiting_product_confirmation",
      name: "Sunset projection lamp",
    });
    expect(isUploadSourceUrl(first.product.sourceUrl)).toBe(true);

    const call = analyze.mock.calls[0]![1] as Record<string, string>;
    expect(call.source).toBe("image");
    expect(call.mediaType).toBe("image/png");
    expect(call.imageBase64).toBe(Buffer.from(png(1)).toString("base64"));
    expect(call.imageUrl).toMatch(/\/api\/images\/[^?]+\?exp=\d+&sig=/);

    const stored = await env.db.select().from(pendingImage);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ purpose: "search", mimeType: "image/png" });

    const again = await importFromImage(
      env.a.creative,
      { brandId, image: png(1) },
      testDeps(integrations),
    );
    expect(again).toMatchObject({ created: false, product: { id: first.product.id } });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("accepts an image link and refuses non-images and viewers", async () => {
    const { integrations, analyze } = imageIntegrations();
    const viaLink = await importFromImage(
      env.a.creative,
      { brandId, imageUrl: "https://cdn.example.com/lamp.jpg" },
      testDeps(integrations),
    );
    expect(viaLink.product.sourceType).toBe("image");
    expect(analyze.mock.calls[0]![1]).toMatchObject({
      source: "image",
      imageUrl: "https://cdn.example.com/lamp.jpg",
    });

    await expect(
      importFromImage(
        env.a.creative,
        { brandId, image: new TextEncoder().encode("<svg/>") },
        testDeps(integrations),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      importFromImage(env.a.viewer, { brandId, image: png(2) }, testDeps(integrations)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("product photos", () => {
  it("hold photos until the Shopify draft exists, then push them and delete them", async () => {
    const { integrations, attachImage } = imageIntegrations();
    const { product: p } = await importFromImage(
      env.a.creative,
      { brandId, image: png(3) },
      testDeps(integrations),
    );

    const added = await uploadProductImages(
      env.a.creative,
      { productId: p.id, files: [png(10), png(11), png(10)] },
      testDeps(integrations),
    );
    expect(added).toEqual({ sentToShopify: 0, pending: 2, duplicates: 1 });
    expect(attachImage).not.toHaveBeenCalled();

    const listed = await listPendingImages(env.a.viewer, p.id);
    expect(listed.map((i) => i.purpose).sort()).toEqual(["gallery", "gallery", "search"]);
    const gallery = listed.find((i) => i.purpose === "gallery")!;
    await deletePendingImage(env.a.creative, { productId: p.id, imageId: gallery.id });
    // The search photo is not removable by hand.
    const search = listed.find((i) => i.purpose === "search")!;
    await expect(
      deletePendingImage(env.a.creative, { productId: p.id, imageId: search.id }),
    ).rejects.toBeInstanceOf(ServiceError);

    const pushed = await pushPendingImages(env.system(env.wsA), integrations, {
      productId: p.id,
      connectionId: "conn-1",
      shopifyProductId: "gid://shopify/Product/1",
    });
    expect(pushed).toBe(2);
    expect(attachImage).toHaveBeenCalledTimes(2);
    expect(await env.db.select().from(pendingImage)).toHaveLength(0);

    // The analysis now points at Shopify's copy of the search photo.
    const [row] = await env.db.select().from(product);
    expect(row!.analysis?.referenceImageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
  });

  it("is role-checked and workspace-scoped", async () => {
    const { integrations } = imageIntegrations();
    const { product: p } = await importFromImage(
      env.a.creative,
      { brandId, image: png(20) },
      testDeps(integrations),
    );
    await expect(
      uploadProductImages(env.a.viewer, { productId: p.id, files: [png(21)] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPendingImages(env.bOwner, p.id)).resolves.toEqual([]);
    await expect(
      uploadProductImages(env.bOwner, { productId: p.id, files: [png(22)] }),
    ).rejects.toThrow();
  });
});
