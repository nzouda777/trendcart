import { describe, expect, it } from "vitest";

import {
  IntegrationError,
  shopifyMediaRefSchema,
  shopifyProductRefSchema,
  shopifyShopInfoSchema,
  shopifyTokenSchema,
  type ShopifyClient,
  type ShopifyDraftProductInput,
} from "@/lib/domain/contracts";

import { MOCK_SHOP_DOMAIN, MOCK_SHOPIFY_API_SECRET } from "./config";
import { signWebhookBody } from "./hmac";
import { createShopifyClient } from "./index";
import { createMockShopifyClient } from "./mock";
import { shopifyInstallTokenSchema } from "./types";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const mock = () => createMockShopifyClient({ now: () => NOW });
const creds = { shopDomain: MOCK_SHOP_DOMAIN, accessToken: "shpat_mock_x" };
const redirectUri = "http://localhost:3000/api/shopify/callback";
const state = "a".repeat(43);

const draft: ShopifyDraftProductInput = {
  title: "LED Sunset Lamp",
  descriptionHtml: "<p>Golden hour, every hour.</p>",
  templateSuffix: "trendcart",
  options: [{ name: "Color", values: ["Orange", "Purple"] }],
  variants: [
    { optionValues: ["Orange"], price: 29.99, compareAtPrice: 49.99, sku: "LAMP-OR" },
    { optionValues: ["Purple"], price: 29.99, compareAtPrice: null },
  ],
  imageUrls: ["https://images.example.test/lamp.jpg"],
  metafields: {
    highlights: ["16 colors", "USB powered", "360° rotation"],
    faq: [{ question: "Shipping?", answer: "7-12 days." }],
    guarantee: "30-day money back.",
  },
};

function callbackQuery(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe("mock Shopify client: contract conformance", () => {
  it("is what the factory returns in mock mode and satisfies ShopifyClient", () => {
    const client: ShopifyClient = createShopifyClient("mock");
    expect((client as { mode?: string }).mode).toBe("mock");
    expect((createShopifyClient("live") as { mode?: string }).mode).toBe("live");
  });

  it("install round-trips locally: URL -> our callback -> token", async () => {
    const client = mock();
    const url = client.buildInstallUrl({
      shopDomain: MOCK_SHOP_DOMAIN,
      oauth: { state, redirectUri },
    });
    expect(url.startsWith(`${redirectUri}?`)).toBe(true);
    const query = callbackQuery(url);
    expect(query.shop).toBe(MOCK_SHOP_DOMAIN);

    const token = await client.completeInstall({ query, expectedState: state });
    shopifyTokenSchema.parse(token);
    shopifyInstallTokenSchema.parse(token);
    // Deterministic.
    expect((await mock().completeInstall({ query, expectedState: state })).accessToken).toBe(
      token.accessToken,
    );
  });

  it("custom app installs are signed with the store's own secret", async () => {
    const client = mock();
    const app = { clientId: "cid", clientSecret: "store-secret" };
    const query = callbackQuery(
      client.buildInstallUrl({ shopDomain: MOCK_SHOP_DOMAIN, oauth: { state, redirectUri }, app }),
    );
    await expect(
      client.completeInstall({ query, expectedState: state, app }),
    ).resolves.toBeTruthy();
    await expect(client.completeInstall({ query, expectedState: state })).rejects.toThrow(
      /signature/,
    );
  });

  it("rejects a bad state or a tampered callback like live", async () => {
    const client = mock();
    const query = callbackQuery(
      client.buildInstallUrl({ shopDomain: MOCK_SHOP_DOMAIN, oauth: { state, redirectUri } }),
    );
    await expect(client.completeInstall({ query, expectedState: "b".repeat(43) })).rejects.toThrow(
      /state/,
    );
    await expect(
      client.completeInstall({ query: { ...query, code: "other" }, expectedState: state }),
    ).rejects.toBeInstanceOf(IntegrationError);
  });

  it("verifies webhooks signed with the mock secret", () => {
    const body = JSON.stringify({ myshopify_domain: MOCK_SHOP_DOMAIN });
    const client = mock();
    expect(
      client.verifyWebhook({
        rawBody: body,
        hmacHeader: signWebhookBody(body, MOCK_SHOPIFY_API_SECRET),
      }),
    ).toBe(true);
    expect(client.verifyWebhook({ rawBody: body, hmacHeader: signWebhookBody(body, "nope") })).toBe(
      false,
    );
  });

  it("shop info, templates and metafields parse with the contract", async () => {
    const client = mock();
    shopifyShopInfoSchema.parse(await client.getShopInfo(creds));
    expect(await client.listProductTemplates(creds)).toEqual([null, "landing", "trendcart"]);
    await expect(client.ensureMetafieldDefinitions(creds)).resolves.toBeUndefined();
  });

  it("describes the landing template's slots from its dynamic sources", async () => {
    const structure = await mock().getProductTemplateStructure(creds, "landing");
    expect(structure.slots.map((s) => [`${s.namespace}.${s.key}`, s.type])).toEqual([
      ["custom.tagline", "single_line_text_field"],
      ["custom.how_to_use", "rich_text_field"],
      ["custom.in_the_box", "list.single_line_text_field"],
    ]);
    expect(structure.slots[1]!.context).toContain("How to use it");
    expect((await mock().getProductTemplateStructure(creds, "trendcart")).slots).toEqual([]);
    await expect(mock().getProductTemplateStructure(creds, "gone")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("creates a deterministic DRAFT product, attaches a READY video, publishes and deletes", async () => {
    const client = mock();
    const product = shopifyProductRefSchema.parse(await client.createDraftProduct(creds, draft));
    expect(product.status).toBe("DRAFT");
    expect(product.handle).toBe("led-sunset-lamp");
    expect(product.onlineStoreUrl).toBeNull();
    expect(
      product.previewUrl?.startsWith(`https://${MOCK_SHOP_DOMAIN}/products_preview?preview_key=`),
    ).toBe(true);
    expect(product.productId).toMatch(/^gid:\/\/shopify\/Product\/\d{13}$/);
    expect((await mock().createDraftProduct(creds, draft)).productId).toBe(product.productId);

    const media = shopifyMediaRefSchema.parse(
      await client.attachVideoFromUrl(creds, {
        productId: product.productId,
        sourceUrl: "https://v16.tiktokcdn.example/video.mp4",
      }),
    );
    expect(media.status).toBe("READY");
    expect(media.mediaId).toMatch(/^gid:\/\/shopify\/Video\/\d+$/);

    const published = shopifyProductRefSchema.parse(
      await client.publishProduct(creds, product.productId),
    );
    expect(published.status).toBe("ACTIVE");
    expect(published.onlineStoreUrl).toBe(`https://${MOCK_SHOP_DOMAIN}/products/led-sunset-lamp`);

    await expect(
      client.deleteProductMedia(creds, { productId: product.productId, mediaIds: [media.mediaId] }),
    ).resolves.toBeUndefined();
  });

  it("re-running with the same idempotency key returns the same product, even after a retitle", async () => {
    const client = mock();
    const first = await client.createDraftProduct(creds, { ...draft, idempotencyKey: "prod_1" });
    const again = await client.createDraftProduct(creds, {
      ...draft,
      idempotencyKey: "prod_1",
      title: "LED Sunset Lamp Pro",
    });
    expect(again.productId).toBe(first.productId);
    expect(again.handle).toBe(first.handle);

    await client.publishProduct(creds, first.productId);
    // A re-run after publishing never demotes the product.
    const afterPublish = await client.createDraftProduct(creds, {
      ...draft,
      idempotencyKey: "prod_1",
    });
    expect(afterPublish.status).toBe("ACTIVE");

    const other = await client.createDraftProduct(creds, { ...draft, idempotencyKey: "prod_2" });
    expect(other.productId).not.toBe(first.productId);
  });

  it("unpublishProduct reverts a publish to DRAFT, idempotently", async () => {
    const client = mock();
    const product = await client.createDraftProduct(creds, draft);
    await client.publishProduct(creds, product.productId);

    const reverted = shopifyProductRefSchema.parse(
      await client.unpublishProduct(creds, product.productId),
    );
    expect(reverted).toMatchObject({
      productId: product.productId,
      handle: "led-sunset-lamp",
      status: "DRAFT",
      onlineStoreUrl: null,
    });
    expect(await client.unpublishProduct(creds, product.productId)).toEqual(reverted);

    // The stored status is DRAFT: a re-run of createDraftProduct sees it.
    expect((await client.createDraftProduct(creds, draft)).status).toBe("DRAFT");

    // Already DRAFT, never published: no error.
    const other = await client.createDraftProduct(creds, { ...draft, idempotencyKey: "prod_x" });
    expect((await client.unpublishProduct(creds, other.productId)).status).toBe("DRAFT");

    await expect(client.unpublishProduct(creds, "123")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      client.unpublishProduct({ shopDomain: "nope", accessToken: "x" }, product.productId),
    ).rejects.toMatchObject({ code: "auth_expired" });
  });

  it("validates inputs like the real API would", async () => {
    const client = mock();
    await expect(
      client.createDraftProduct(creds, {
        ...draft,
        variants: [{ optionValues: [], price: 1, compareAtPrice: null }],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.createDraftProduct(creds, { ...draft, title: "" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      client.getShopInfo({ shopDomain: "nope", accessToken: "x" }),
    ).rejects.toMatchObject({
      code: "auth_expired",
    });
    await expect(client.publishProduct(creds, "123")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("mock deleteProductTemplate (QA N6)", () => {
  it("deletes only generated templates, idempotently, and never one a live product uses", async () => {
    const client = mock();
    const suffix = "tc-prod_123";
    await client.upsertProductTemplate(creds, { suffix, template: { sections: {}, order: [] } });
    await expect(client.deleteProductTemplate(creds, { suffix })).resolves.toEqual({
      deleted: true,
    });
    await expect(client.deleteProductTemplate(creds, { suffix })).resolves.toEqual({
      deleted: false,
    });
    for (const bad of ["trendcart", "default", "tc-../x", "tc-a.liquid"]) {
      await expect(client.deleteProductTemplate(creds, { suffix: bad })).rejects.toMatchObject({
        code: "invalid_input",
      });
    }

    await client.upsertProductTemplate(creds, { suffix, template: {} });
    const product = await client.createDraftProduct(creds, {
      ...draft,
      templateSuffix: suffix,
      idempotencyKey: "prod_123",
    });
    // Published with it: refused. Back to draft: allowed.
    await client.publishProduct(creds, product.productId);
    await expect(
      client.deleteProductTemplate(creds, { suffix, productId: product.productId }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await client.unpublishProduct(creds, product.productId);
    await expect(
      client.deleteProductTemplate(creds, { suffix, productId: product.productId }),
    ).resolves.toEqual({ deleted: true });
  });
});
