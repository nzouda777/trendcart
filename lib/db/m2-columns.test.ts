/**
 * M2 schema additions (migration 0001): page copy on product, dedicated Shopify
 * token columns and TikTok refresh-token expiry; connection statuses (0002);
 * Shopify product URLs (0003). Exercised through scoped-db so tenancy keeps holding.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditActionSchema } from "@/lib/audit";
import type { PageCopy } from "@/lib/domain/contracts";
import { createScopedDb, type ScopedDb } from "@/lib/tenant/scoped-db";

import {
  brand,
  connectionStatusEnum,
  product,
  shopifyConnection,
  shopifyProduct,
  tiktokProfileConnection,
} from "./schema";
import { createTestDb, insertWorkspace } from "./testing";
import type { Database } from "./types";

let db: Database;
let close: () => Promise<void>;
let a: ScopedDb;
let b: ScopedDb;
let brandA: string;

/** Stand-in for a lib/crypto envelope: these tests only check column storage. */
const enc = (plaintext: string) => `test-envelope:${plaintext}`;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = createScopedDb(db, await insertWorkspace(db, "Workspace A"));
  b = createScopedDb(db, await insertWorkspace(db, "Workspace B"));
  brandA = (await a.insert(brand, { name: "A", country: "FR", language: "fr" })).id;
});

afterAll(async () => {
  await close();
});

const copy: PageCopy = {
  title: "Mini blender",
  descriptionHtml: "<p>Portable.</p>",
  highlights: ["USB-C", "Quiet", "Light"],
  faq: [
    { question: "Battery?", answer: "2 h." },
    { question: "Dishwasher?", answer: "Cup only." },
    { question: "Warranty?", answer: "1 year." },
  ],
  guarantee: "30-day returns.",
  adTexts: ["Smoothies anywhere."],
};

describe("migration 0001", () => {
  it("stores page copy on product, scoped to the workspace", async () => {
    const p = await a.insert(product, {
      brandId: brandA,
      sourceType: "product_link",
      sourceUrl: "https://example.com/p",
    });
    expect(p.pageCopy).toBeNull();
    expect(p.pageCopyGeneratedAt).toBeNull();

    const at = new Date("2026-10-31T10:00:00Z");
    expect(await b.update(product, { pageCopy: copy }, eq(product.id, p.id))).toEqual([]);
    const [updated] = await a.update(
      product,
      { pageCopy: copy, pageCopyGeneratedAt: at },
      eq(product.id, p.id),
    );
    expect(updated?.pageCopy).toEqual(copy);
    expect(updated?.pageCopyGeneratedAt?.toISOString()).toBe(at.toISOString());
  });

  it("keeps legacy Shopify rows (token bundle, new columns null) readable", async () => {
    const legacyBundle = JSON.stringify({
      v: 1,
      accessToken: "shpat_legacy",
      refreshToken: "shprt_legacy",
      expiresAt: "2026-11-01T00:00:00.000Z",
      refreshTokenExpiresAt: null,
    });
    const row = await a.insert(shopifyConnection, {
      brandId: brandA,
      shopDomain: "legacy.myshopify.com",
      accessTokenEnc: enc(legacyBundle),
      status: "active",
    });
    const read = await a.getById(shopifyConnection, row.id);
    expect(read.refreshTokenEnc).toBeNull();
    expect(read.tokenExpiresAt).toBeNull();
    expect(read.refreshTokenExpiresAt).toBeNull();
    expect(read.accessTokenEnc).toBe(enc(legacyBundle));
  });

  it("stores Shopify tokens in dedicated columns", async () => {
    const expires = new Date("2026-10-31T11:00:00Z");
    const refreshExpires = new Date("2027-01-29T10:00:00Z");
    const row = await a.insert(shopifyConnection, {
      brandId: brandA,
      shopDomain: "new.myshopify.com",
      accessTokenEnc: enc("shpat_new"),
      refreshTokenEnc: enc("shprt_new"),
      tokenExpiresAt: expires,
      refreshTokenExpiresAt: refreshExpires,
      status: "active",
    });
    const read = await a.getById(shopifyConnection, row.id);
    expect(read.accessTokenEnc).toBe(enc("shpat_new"));
    expect(read.refreshTokenEnc).toBe(enc("shprt_new"));
    expect(read.tokenExpiresAt?.toISOString()).toBe(expires.toISOString());
    expect(read.refreshTokenExpiresAt?.toISOString()).toBe(refreshExpires.toISOString());
    expect(read.status).toBe("active");
    expect(await b.findById(shopifyConnection, row.id)).toBeUndefined();
  });

  it("stores the TikTok refresh-token expiry", async () => {
    const row = await a.insert(tiktokProfileConnection, {
      brandId: brandA,
      openId: "open-1",
      displayName: "creator",
      refreshExpiresAt: new Date("2027-10-31T00:00:00Z"),
    });
    const read = await a.getById(tiktokProfileConnection, row.id);
    expect(read.refreshExpiresAt?.toISOString()).toBe("2027-10-31T00:00:00.000Z");
    expect(await b.findById(tiktokProfileConnection, row.id)).toBeUndefined();
  });
});

describe("migration 0003", () => {
  it("round-trips the Shopify product URLs, scoped to the workspace", async () => {
    const p = await a.insert(product, {
      brandId: brandA,
      sourceType: "product_link",
      sourceUrl: "https://example.com/urls",
    });
    const conn = await a.insert(shopifyConnection, {
      brandId: brandA,
      shopDomain: "urls.myshopify.com",
    });
    const row = await a.insert(shopifyProduct, {
      productId: p.id,
      connectionId: conn.id,
      shopifyProductId: "gid://shopify/Product/1",
      handle: "mini-blender",
    });
    expect(row.previewUrl).toBeNull();
    expect(row.adminUrl).toBeNull();
    expect(row.storefrontUrl).toBeNull();

    const urls = {
      previewUrl: "https://urls.myshopify.com/products/mini-blender?preview_key=abc",
      adminUrl: "https://admin.shopify.com/store/urls/products/1",
      storefrontUrl: "https://urls.myshopify.com/products/mini-blender",
    };
    expect(await b.update(shopifyProduct, urls, eq(shopifyProduct.id, row.id))).toEqual([]);
    expect(await b.findById(shopifyProduct, row.id)).toBeUndefined();
    expect((await a.getById(shopifyProduct, row.id)).previewUrl).toBeNull();

    const [updated] = await a.update(shopifyProduct, urls, eq(shopifyProduct.id, row.id));
    expect(updated).toMatchObject(urls);
    expect(await a.getById(shopifyProduct, row.id)).toMatchObject(urls);
  });

  it("accepts the page.update audit action", () => {
    expect(auditActionSchema.parse("page.update")).toBe("page.update");
  });
});

describe("migration 0002", () => {
  it("accepts every connection status, including expiring and revoked", async () => {
    expect(connectionStatusEnum.enumValues).toEqual([
      "pending",
      "active",
      "expiring",
      "needs_reauth",
      "revoked",
      "disconnected",
    ]);
    const row = await a.insert(shopifyConnection, {
      brandId: brandA,
      shopDomain: "statuses.myshopify.com",
    });
    for (const status of connectionStatusEnum.enumValues) {
      const [u] = await a.update(shopifyConnection, { status }, eq(shopifyConnection.id, row.id));
      expect(u?.status).toBe(status);
    }
  });
});
