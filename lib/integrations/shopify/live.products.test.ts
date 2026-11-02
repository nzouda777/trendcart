import { describe, expect, it } from "vitest";

import {
  IntegrationError,
  shopifyProductRefSchema,
  type ShopifyDraftProductInput,
} from "@/lib/domain/contracts";

import fx from "./__fixtures__/admin-graphql-products.json";
import type { FetchLike } from "./graphql";
import { createLiveShopifyClient } from "./live";
import { imageFilename } from "./product-input";

/*
 * Live product methods against recorded 2026-10 responses (no network): each
 * test asserts the exact operations and variables sent, in order.
 */

type Call = { url: string; query: string; variables: Record<string, unknown> };

function replay(
  ...responses: { status?: number; body: unknown; headers?: Record<string, string> }[]
) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push({ url, query: body.query, variables: body.variables ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request #${calls.length}: ${body.query.slice(0, 80)}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json", ...next.headers },
    });
  };
  return { fetch, calls };
}

const creds = { shopDomain: "some-shop.myshopify.com", accessToken: "shpat_test" };

function client(fetch: FetchLike, sleeps: number[] = []) {
  return createLiveShopifyClient({
    apiKey: "k",
    apiSecret: "s",
    apiVersion: "2026-10",
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
}

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

const draft: ShopifyDraftProductInput = {
  idempotencyKey: "prod_01JTRENDCART",
  title: "LED Sunset Lamp",
  descriptionHtml: "<p>Golden hour, <strong>every</strong> hour &amp; anywhere.</p>",
  templateSuffix: "trendcart",
  vendor: "Demo Store",
  tags: ["trendcart"],
  options: [{ name: "Color", values: ["Orange", "Purple"] }],
  variants: [
    { optionValues: ["Orange"], price: 29.99, compareAtPrice: 49.99, sku: "LAMP-OR" },
    { optionValues: ["Purple"], price: 31, compareAtPrice: null },
  ],
  imageUrls: [
    "https://ae01.alicdn.example/kf/lamp-1.jpg",
    "https://ae01.alicdn.example/kf/lamp-3.webp",
    "https://ae01.alicdn.example/kf/lamp-1.jpg",
  ],
  metafields: {
    highlights: ["16 colors", "USB\npowered", "360° rotation"],
    faq: [{ question: "Shipping?", answer: "7-12 days." }],
    guarantee: "30-day money back.\nNo questions asked.",
  },
};

type SetVariables = {
  identifier?: unknown;
  synchronous: boolean;
  input: Record<string, unknown> & {
    variants: Record<string, unknown>[];
    files: Record<string, unknown>[];
    metafields: Record<string, unknown>[];
  };
};

describe("live createDraftProduct", () => {
  it("creates a DRAFT with options, prices, SEO, template, images and metafields", async () => {
    const { fetch, calls } = replay(
      { body: fx.definitionsAll },
      { body: fx.productNotFound },
      { body: fx.productSetCreated },
    );
    const ref = shopifyProductRefSchema.parse(await client(fetch).createDraftProduct(creds, draft));
    expect(ref).toEqual({
      productId: "gid://shopify/Product/8123456789012",
      handle: "led-sunset-lamp",
      status: "DRAFT",
      adminUrl: "https://admin.shopify.com/store/some-shop/products/8123456789012",
      onlineStoreUrl: null,
      // Drafts have no storefront URL, but a preview URL for the page preview.
      previewUrl:
        "https://some-shop.myshopify.com/products_preview?preview_key=5b0f3c1a9e2d47c86a1e0b7d2f4c9a31",
    });

    expect(calls.map((c) => /(?:query|mutation) (\w+)/.exec(c.query)?.[1])).toEqual([
      "TrendcartMetafieldDefinitions",
      "TrendcartProductByCustomId",
      "TrendcartProductSet",
    ]);
    expect(calls[1]!.variables).toEqual({
      identifier: {
        customId: { namespace: "trendcart", key: "product_id", value: "prod_01JTRENDCART" },
      },
    });

    const v = calls[2]!.variables as SetVariables;
    expect(v.synchronous).toBe(true);
    // New product: upsert on the custom ID, so a concurrent run cannot duplicate it.
    expect(v.identifier).toEqual({
      customId: { namespace: "trendcart", key: "product_id", value: "prod_01JTRENDCART" },
    });
    expect(v.input).toMatchObject({
      title: "LED Sunset Lamp",
      descriptionHtml: draft.descriptionHtml,
      seo: { title: "LED Sunset Lamp", description: "Golden hour, every hour & anywhere." },
      templateSuffix: "trendcart",
      vendor: "Demo Store",
      tags: ["trendcart"],
      status: "DRAFT",
      productOptions: [
        { name: "Color", position: 1, values: [{ name: "Orange" }, { name: "Purple" }] },
      ],
    });
    expect(v.input.variants).toEqual([
      {
        optionValues: [{ optionName: "Color", name: "Orange" }],
        price: "29.99",
        compareAtPrice: "49.99",
        inventoryItem: { tracked: false, sku: "LAMP-OR" },
      },
      {
        optionValues: [{ optionName: "Color", name: "Purple" }],
        price: "31.00",
        compareAtPrice: null,
        inventoryItem: { tracked: false },
      },
    ]);
    // Deduplicated, Shopify fetches each URL itself, deterministic marker filenames.
    expect(v.input.files).toEqual([
      {
        originalSource: "https://ae01.alicdn.example/kf/lamp-1.jpg",
        filename: "tc-088763f4882c386a.jpg",
        contentType: "IMAGE",
        alt: "LED Sunset Lamp",
      },
      {
        originalSource: "https://ae01.alicdn.example/kf/lamp-3.webp",
        filename: "tc-37adee7891ef74ee.webp",
        contentType: "IMAGE",
        alt: "LED Sunset Lamp",
      },
    ]);
    expect(v.input.metafields).toEqual([
      {
        namespace: "custom",
        key: "highlights",
        type: "list.single_line_text_field",
        value: JSON.stringify(["16 colors", "USB powered", "360° rotation"]),
      },
      {
        namespace: "custom",
        key: "faq",
        type: "json",
        value: JSON.stringify([{ question: "Shipping?", answer: "7-12 days." }]),
      },
      {
        namespace: "custom",
        key: "guarantee",
        type: "multi_line_text_field",
        value: "30-day money back.\nNo questions asked.",
      },
      { namespace: "trendcart", key: "product_id", type: "id", value: "prod_01JTRENDCART" },
    ]);
  });

  it("re-running updates the same product: variant ids, our images and foreign media are kept", async () => {
    const { fetch, calls } = replay(
      { body: fx.definitionsAll },
      { body: fx.productExisting },
      { body: fx.productSetUpdatedActive },
    );
    const ref = await client(fetch).createDraftProduct(creds, {
      ...draft,
      options: [{ name: "Color", values: ["Orange", "Purple"] }],
    });
    // Status is reported as-is and never demoted by a re-run.
    expect(ref.status).toBe("ACTIVE");

    const v = calls[2]!.variables as SetVariables;
    expect(v.identifier).toEqual({ id: "gid://shopify/Product/8123456789012" });
    expect(v.input).not.toHaveProperty("status");
    expect(v.input.variants.map((x) => x.id)).toEqual([
      "gid://shopify/ProductVariant/4400000000001", // Orange matched by option value
      undefined, // Purple is new (old Green variant is dropped by productSet)
    ]);
    expect(v.input.files).toEqual([
      { id: "gid://shopify/MediaImage/3300000000001" }, // lamp-1, matched despite _uuid suffix
      {
        originalSource: "https://ae01.alicdn.example/kf/lamp-3.webp",
        filename: "tc-37adee7891ef74ee.webp",
        contentType: "IMAGE",
        alt: "LED Sunset Lamp",
      },
      { id: "gid://shopify/Video/3300000000003" }, // approved video: kept
      { id: "gid://shopify/MediaImage/3300000000004" }, // merchant's own image: kept
      // lamp-2 (no longer in input) and the still-processing image are dropped.
    ]);
  });

  it("without an idempotency key, creates without an identifier", async () => {
    const { fetch, calls } = replay({ body: fx.definitionsAll }, { body: fx.productSetCreated });
    await client(fetch).createDraftProduct(creds, {
      ...draft,
      idempotencyKey: undefined,
      options: [],
      variants: [{ optionValues: [], price: 10, compareAtPrice: 12 }],
      seo: { title: "Custom SEO", description: "Custom meta." },
    });
    const v = calls[1]!.variables as SetVariables;
    expect(v).not.toHaveProperty("identifier");
    // No options: Shopify's default option, one variant.
    expect(v.input.productOptions).toEqual([
      { name: "Title", position: 1, values: [{ name: "Default Title" }] },
    ]);
    expect(v.input.variants[0]!.optionValues).toEqual([
      { optionName: "Title", name: "Default Title" },
    ]);
    expect(v.input.seo).toEqual({ title: "Custom SEO", description: "Custom meta." });
    expect(v.input.metafields.some((m) => m.namespace === "trendcart")).toBe(false);
  });

  it("rejects inconsistent variants before any network call", async () => {
    const { fetch, calls } = replay();
    const c = client(fetch);
    for (const bad of [
      { ...draft, variants: [{ optionValues: [], price: 1, compareAtPrice: null }] },
      { ...draft, variants: [{ optionValues: ["Blue"], price: 1, compareAtPrice: null }] },
      {
        ...draft,
        variants: [
          { optionValues: ["Orange"], price: 1, compareAtPrice: null },
          { optionValues: ["Orange"], price: 2, compareAtPrice: null },
        ],
      },
      { ...draft, title: "" },
    ]) {
      const error = await rejection(c.createDraftProduct(creds, bad));
      expect(error.code).toBe("invalid_input");
      expect(error.retryable).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("surfaces productSet userErrors as invalid_input", async () => {
    const { fetch } = replay(
      { body: fx.definitionsAll },
      { body: fx.productNotFound },
      { body: fx.productSetUserErrors },
    );
    const error = await rejection(client(fetch).createDraftProduct(creds, draft));
    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("input.variants.0.price");
  });

  it("waits for the cost bucket to refill, then retries the throttled call", async () => {
    const sleeps: number[] = [];
    const { fetch, calls } = replay(
      { body: fx.definitionsAll },
      { body: fx.throttledLowBucket },
      { status: 429, body: {}, headers: { "Retry-After": "2.0" } },
      { body: fx.productNotFound },
      { body: fx.productSetCreated },
    );
    const ref = await client(fetch, sleeps).createDraftProduct(creds, draft);
    expect(ref.status).toBe("DRAFT");
    // (152 requested - 2 available) / 100 per second = 1.5 s; then Retry-After 2 s.
    expect(sleeps).toEqual([1500, 2000]);
    expect(calls).toHaveLength(5);
  });

  it("gives up after the retry budget with a retryable rate_limited error", async () => {
    const throttled = { body: fx.throttledLowBucket };
    const { fetch } = replay(throttled, throttled, throttled, throttled);
    const error = await rejection(client(fetch).ensureMetafieldDefinitions(creds));
    expect(error.code).toBe("rate_limited");
    expect(error.retryable).toBe(true);
  });
});

describe("live publishProduct", () => {
  const id = "gid://shopify/Product/8123456789012";

  it("sets ACTIVE, publishes to the Online Store publication and returns the storefront URL", async () => {
    const { fetch, calls } = replay(
      { body: fx.productActivated },
      { body: fx.publications },
      { body: fx.published },
      { body: fx.productRefActive },
    );
    const ref = await client(fetch).publishProduct(creds, id);
    expect(ref).toMatchObject({
      status: "ACTIVE",
      onlineStoreUrl: "https://some-shop.myshopify.com/products/led-sunset-lamp",
      previewUrl:
        "https://some-shop.myshopify.com/products_preview?preview_key=5b0f3c1a9e2d47c86a1e0b7d2f4c9a31",
    });
    expect(calls[0]!.variables).toEqual({ product: { id, status: "ACTIVE" } });
    expect(calls[1]!.query).toContain("catalogType: APP");
    expect(calls[2]!.variables).toEqual({
      id,
      input: [{ publicationId: "gid://shopify/Publication/1002" }],
    });
  });

  it("caches the Online Store publication per shop", async () => {
    const { fetch, calls } = replay(
      { body: fx.productActivated },
      { body: fx.publications },
      { body: fx.published },
      { body: fx.productRefActive },
      { body: fx.productActivated },
      { body: fx.published },
      { body: fx.productRefActive },
    );
    const c = client(fetch);
    await c.publishProduct(creds, id);
    await c.publishProduct(creds, id);
    expect(calls.filter((x) => x.query.includes("TrendcartPublications"))).toHaveLength(1);
  });

  it("fails clearly when the Online Store channel is missing or the product is gone", async () => {
    const missingChannel = replay(
      { body: fx.productActivated },
      { body: fx.publicationsNoOnlineStore },
    );
    const e1 = await rejection(client(missingChannel.fetch).publishProduct(creds, id));
    expect(e1.code).toBe("not_found");
    expect(e1.retryable).toBe(false);

    const gone = replay({ body: fx.productActivateMissing });
    expect((await rejection(client(gone.fetch).publishProduct(creds, id))).code).toBe(
      "invalid_input",
    );
    expect((await rejection(client(replay().fetch).publishProduct(creds, "123"))).code).toBe(
      "invalid_input",
    );
  });
});

describe("live unpublishProduct", () => {
  const id = "gid://shopify/Product/8123456789012";

  it("sets DRAFT with one productUpdate and returns the ref without a storefront URL", async () => {
    const { fetch, calls } = replay({ body: fx.productDrafted });
    const ref = await client(fetch).unpublishProduct(creds, id);
    expect(shopifyProductRefSchema.parse(ref)).toMatchObject({
      productId: id,
      handle: "led-sunset-lamp",
      status: "DRAFT",
      onlineStoreUrl: null,
      adminUrl: "https://admin.shopify.com/store/some-shop/products/8123456789012",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain("mutation TrendcartProductDraft");
    expect(calls[0]!.query).not.toContain(id);
    expect(calls[0]!.variables).toEqual({ product: { id, status: "DRAFT" } });
  });

  it("is idempotent: an already-DRAFT product returns its ref with no error", async () => {
    const { fetch, calls } = replay({ body: fx.productDrafted }, { body: fx.productDrafted });
    const c = client(fetch);
    const first = await c.unpublishProduct(creds, id);
    const second = await c.unpublishProduct(creds, id);
    expect(second).toEqual(first);
    expect(calls).toHaveLength(2);
  });

  it("maps a deleted product to not_found and other userErrors to invalid_input", async () => {
    const gone = await rejection(
      client(replay({ body: fx.productDraftMissing }).fetch).unpublishProduct(creds, id),
    );
    expect(gone.code).toBe("not_found");
    expect(gone.retryable).toBe(false);

    const invalid = await rejection(
      client(replay({ body: fx.productDraftInvalid }).fetch).unpublishProduct(creds, id),
    );
    expect(invalid.code).toBe("invalid_input");
    expect(invalid.message).toMatch(/status/);

    expect((await rejection(client(replay().fetch).unpublishProduct(creds, "123"))).code).toBe(
      "invalid_input",
    );
  });

  it("retries a throttled call like the other mutations", async () => {
    const sleeps: number[] = [];
    const { fetch, calls } = replay({ body: fx.throttledLowBucket }, { body: fx.productDrafted });
    const ref = await client(fetch, sleeps).unpublishProduct(creds, id);
    expect(ref.status).toBe("DRAFT");
    expect(calls).toHaveLength(2);
    expect(sleeps.length).toBeGreaterThan(0);
  });
});

describe("live deleteProductMedia", () => {
  const productId = "gid://shopify/Product/8123456789012";

  it("deletes the files, and treats already-deleted media as success", async () => {
    const { fetch, calls } = replay({ body: fx.fileDeleted }, { body: fx.fileDeleteAlreadyGone });
    const c = client(fetch);
    const mediaIds = ["gid://shopify/Video/3300000000003", "gid://shopify/Video/3300000000003"];
    await c.deleteProductMedia(creds, { productId, mediaIds });
    await c.deleteProductMedia(creds, { productId, mediaIds });
    expect(calls[0]!.variables).toEqual({ fileIds: ["gid://shopify/Video/3300000000003"] });
  });

  it("is a no-op for an empty list and rejects other errors and bad ids", async () => {
    const { fetch, calls } = replay({ body: fx.fileDeleteLocked });
    const c = client(fetch);
    await c.deleteProductMedia(creds, { productId, mediaIds: [] });
    expect(calls).toHaveLength(0);
    expect(
      (await rejection(c.deleteProductMedia(creds, { productId, mediaIds: ["123"] }))).code,
    ).toBe("invalid_input");
    expect(
      (
        await rejection(
          c.deleteProductMedia(creds, {
            productId,
            mediaIds: ["gid://shopify/MediaImage/1"],
          }),
        )
      ).message,
    ).toMatch(/processed/);
  });
});

describe("image filenames", () => {
  it("keep the source extension and default to jpg", () => {
    expect(imageFilename("https://x.example/a/b.PNG?w=800")).toMatch(/^tc-[0-9a-f]{16}\.png$/);
    expect(imageFilename("https://x.example/a/b.jpeg")).toMatch(/\.jpg$/);
    expect(imageFilename("https://x.example/image?id=1")).toMatch(/\.jpg$/);
  });
});
