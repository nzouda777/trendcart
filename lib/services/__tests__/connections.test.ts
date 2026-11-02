import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { encrypt } from "@/lib/crypto";
import { auditLog, brand, shopifyConnection, tiktokProfileConnection } from "@/lib/db/schema";
import type { ShopifyAdapter, ShopifyInstallToken } from "@/lib/integrations/shopify";
import { tokenAad } from "@/lib/integrations/shopify/credentials";
import { serializeTokenBundle } from "@/lib/integrations/shopify/token-bundle";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { createBrand } from "../brands";
import {
  connectionHealth,
  disconnectConnection,
  listConnections,
  saveTikTokAdConnections,
  saveTikTokProfileConnection,
  setShopifyTemplate,
} from "../connections";
import {
  getShopifyCredentials,
  getTikTokAdsCredentials,
  getTikTokProfileTokens,
  markConnectionNeedsReauth,
} from "../internal/credentials";

import { newBrandInput, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let brandId: string;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(auditLog);
  await env.db.delete(brand);
  brandId = (await createBrand(env.a.owner, newBrandInput())).id;
});

const SHOP_DOMAIN = "demo-store.myshopify.com";

const installToken = (overrides: Partial<ShopifyInstallToken> = {}): ShopifyInstallToken => ({
  shopDomain: SHOP_DOMAIN,
  accessToken: "shpat_supersecret",
  scopes: ["write_products", "read_themes"],
  refreshToken: "shprt_refresh_secret",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  ...overrides,
});

/**
 * Shopify rows are written by lib/integrations/shopify (completeShopifyInstall)
 * as an encrypted token bundle; this fixture writes the same shape.
 */
async function insertShopify(token: ShopifyInstallToken = installToken(), workspaceId = env.wsA) {
  const id = crypto.randomUUID();
  return createScopedDb(env.db, workspaceId).insert(shopifyConnection, {
    id,
    brandId,
    shopDomain: token.shopDomain,
    scopes: token.scopes,
    accessTokenEnc: encrypt(serializeTokenBundle(token), { aad: tokenAad(id) }),
    status: "active",
  });
}

/** A Shopify adapter that only knows how to refresh tokens. */
function fakeShopify(refreshed?: ShopifyInstallToken) {
  const refreshAccessToken = vi.fn(async () => refreshed ?? installToken());
  return { client: { refreshAccessToken } as unknown as ShopifyAdapter, refreshAccessToken };
}

const profileToken = (expiresInMs: number) => ({
  openId: "open_1",
  accessToken: "act.secret",
  refreshToken: "rft.secret",
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  scopes: ["video.publish"],
});

describe("TikTok connection helpers (OAuth callbacks)", () => {
  it("encrypt tokens, never return them, upsert, and audit", async () => {
    await expect(
      saveTikTokAdConnections(env.a.creative, {
        brandId,
        accessToken: "tt_ads_secret",
        advertisers: [{ advertiserId: "adv_1", name: "Main" }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const ads = await saveTikTokAdConnections(env.a.media_buyer, {
      brandId,
      accessToken: "tt_ads_secret",
      advertisers: [
        { advertiserId: "adv_1", name: "Main" },
        { advertiserId: "adv_2", name: "Test" },
      ],
    });
    expect(ads).toHaveLength(2);
    expect((await getTikTokAdsCredentials(env.system(env.wsA), ads[0].id)).accessToken).toBe(
      "tt_ads_secret",
    );

    // Reconnect reuses the rows.
    const again = await saveTikTokAdConnections(env.a.media_buyer, {
      brandId,
      accessToken: "tt_ads_rotated",
      advertisers: [{ advertiserId: "adv_1", name: "Main" }],
    });
    expect(again[0].id).toBe(ads[0].id);

    const profile = await saveTikTokProfileConnection(env.a.media_buyer, {
      brandId,
      token: profileToken(3600_000 * 48),
      displayName: "@demo",
    });
    expect(profile.health).toBe("green");
    expect((await getTikTokProfileTokens(env.system(env.wsA), profile.id)).refreshToken).toBe(
      "rft.secret",
    );

    await insertShopify();
    const listed = await listConnections(env.a.viewer, brandId);
    expect(listed.shopify).toHaveLength(1);
    expect(listed.shopify[0]).toMatchObject({ kind: "shopify", status: "active", health: "green" });
    expect(listed.tiktokAds).toHaveLength(2);
    expect(listed.tiktokProfiles).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toMatch(/secret|rotated/);

    const audits = await env.a.owner.db.select(auditLog);
    expect(audits.map((a) => a.action).sort()).toEqual([
      "brand.create",
      "connection.create",
      "connection.create",
      "connection.create",
      "connection.update",
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/secret|rotated/);
  });

  it("sets the Shopify template suffix (media buyer)", async () => {
    const shop = await insertShopify();
    await expect(
      setShopifyTemplate(env.a.creative, { connectionId: shop.id, templateSuffix: "trendcart" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const updated = await setShopifyTemplate(env.a.media_buyer, {
      connectionId: shop.id,
      templateSuffix: "trendcart",
    });
    expect(updated.templateSuffix).toBe("trendcart");
  });
});

describe("getShopifyCredentials (delegates to the Shopify token bundle owner)", () => {
  it("returns the bundle's access token without refreshing a fresh token", async () => {
    const shop = await insertShopify();
    const { client, refreshAccessToken } = fakeShopify();
    const result = await getShopifyCredentials(env.system(env.wsA), shop.id, { client });
    expect(result.creds).toEqual({ shopDomain: SHOP_DOMAIN, accessToken: "shpat_supersecret" });
    expect(result.app).toBeUndefined();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and persists the new bundle", async () => {
    const shop = await insertShopify(
      installToken({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    const { client, refreshAccessToken } = fakeShopify(
      installToken({ accessToken: "shpat_rotated", refreshToken: "shprt_rotated" }),
    );
    const first = await getShopifyCredentials(env.system(env.wsA), shop.id, { client });
    expect(first.creds.accessToken).toBe("shpat_rotated");
    expect(refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ shopDomain: SHOP_DOMAIN, refreshToken: "shprt_refresh_secret" }),
    );

    // Persisted: the next call uses the stored token, no second refresh.
    const second = await getShopifyCredentials(env.system(env.wsA), shop.id, { client });
    expect(second.creds.accessToken).toBe("shpat_rotated");
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    const [row] = await env.a.owner.db.select(shopifyConnection);
    expect(row.accessTokenEnc).not.toMatch(/shpat|shprt/);
  });

  it("an expired token without a refresh token marks the store needs_reauth", async () => {
    const shop = await insertShopify(
      installToken({ refreshToken: null, expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    const { client } = fakeShopify();
    await expect(
      getShopifyCredentials(env.system(env.wsA), shop.id, { client }),
    ).rejects.toMatchObject({ code: "auth_expired" });
    expect((await listConnections(env.a.viewer, brandId)).shopify[0]).toMatchObject({
      status: "needs_reauth",
      health: "red",
    });
  });
});

describe("health colours", () => {
  it("maps status and token state to green / orange / red", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(connectionHealth({ status: "active", hasToken: true, now }).health).toBe("green");
    expect(connectionHealth({ status: "pending", hasToken: false, now }).health).toBe("orange");
    expect(connectionHealth({ status: "needs_reauth", hasToken: true, now }).health).toBe("red");
    expect(connectionHealth({ status: "disconnected", hasToken: false, now }).health).toBe("red");
    expect(connectionHealth({ status: "active", hasToken: false, now }).health).toBe("red");
    expect(connectionHealth({ status: "revoked", hasToken: false, now })).toEqual({
      health: "red",
      healthReason: "Access was revoked. Reconnect.",
    });
    expect(connectionHealth({ status: "expiring", hasToken: true, now })).toEqual({
      health: "orange",
      healthReason: "Access expires soon. Reconnect to keep it working.",
    });
    expect(
      connectionHealth({
        status: "active",
        hasToken: true,
        expiresAt: new Date("2026-10-25T13:00:00Z"),
        now,
      }).health,
    ).toBe("orange");
  });

  it("turns red when a step reports auth_expired", async () => {
    const shop = await insertShopify();
    await markConnectionNeedsReauth(env.system(env.wsA), "shopify", shop.id, "401 from Shopify");
    const listed = await listConnections(env.a.viewer, brandId);
    expect(listed.shopify[0]).toMatchObject({ status: "needs_reauth", health: "red" });
    const { client } = fakeShopify();
    await expect(
      getShopifyCredentials(env.system(env.wsA), shop.id, { client }),
    ).rejects.toMatchObject({ code: "auth_expired" });
  });
});

describe("disconnect", () => {
  it("is owner only, wipes secrets, keeps the row, and audits", async () => {
    const profile = await saveTikTokProfileConnection(env.a.owner, {
      brandId,
      token: profileToken(3600_000 * 48),
      displayName: "@demo",
    });
    for (const role of ["viewer", "creative", "media_buyer"] as const) {
      await expect(
        disconnectConnection(env.a[role], { kind: "tiktok_profile", connectionId: profile.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const dto = await disconnectConnection(env.a.owner, {
      kind: "tiktok_profile",
      connectionId: profile.id,
    });
    expect(dto).toMatchObject({ status: "disconnected", health: "red" });
    const [row] = await env.a.owner.db.select(tiktokProfileConnection);
    expect(row.accessTokenEnc).toBeNull();
    expect(row.refreshTokenEnc).toBeNull();
    expect(row.refreshExpiresAt).toBeNull();

    const shop = await insertShopify();
    await disconnectConnection(env.a.owner, { kind: "shopify", connectionId: shop.id });
    const [shopRow] = await env.a.owner.db.select(shopifyConnection);
    expect(shopRow).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });

    const audits = await env.a.owner.db.select(auditLog);
    expect(audits.filter((a) => a.action === "connection.delete")).toHaveLength(2);
  });
});

describe("connection tenant isolation", () => {
  it("workspace B cannot list, save into, disconnect or read credentials of A", async () => {
    const shop = await insertShopify();
    const b = env.bOwner;
    await expect(listConnections(b, brandId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveTikTokAdConnections(b, {
        brandId,
        accessToken: "x",
        advertisers: [{ advertiserId: "adv_9", name: "B" }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveTikTokProfileConnection(b, { brandId, token: profileToken(3600_000), displayName: "@b" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      disconnectConnection(b, { kind: "shopify", connectionId: shop.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const { client } = fakeShopify();
    await expect(
      getShopifyCredentials(env.system(env.wsB), shop.id, { client }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setShopifyTemplate(b, { connectionId: shop.id, templateSuffix: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listConnections(env.a.viewer, brandId)).shopify[0].status).toBe("active");
  });
});

describe("TikTok reconnect keeps the original brand (QA N4)", () => {
  it("never moves an advertiser or profile to another brand, and audits with table names", async () => {
    const other = (await createBrand(env.a.owner, newBrandInput("Other"))).id;
    const [first] = await saveTikTokAdConnections(env.a.owner, {
      brandId,
      accessToken: "tok_1",
      advertisers: [{ advertiserId: "adv_keep", name: "Main" }],
      scopes: ["ads.read"],
    });
    expect(first).toMatchObject({ brandId, created: true });

    const [again] = await saveTikTokAdConnections(env.a.owner, {
      brandId: other,
      accessToken: "tok_2",
      advertisers: [{ advertiserId: "adv_keep", name: "Renamed" }],
    });
    expect(again).toMatchObject({ id: first.id, brandId, name: "Renamed", created: false });
    expect((await getTikTokAdsCredentials(env.system(env.wsA), first.id)).accessToken).toBe(
      "tok_2",
    );

    const p1 = await saveTikTokProfileConnection(env.a.owner, {
      brandId,
      token: profileToken(3600_000 * 48),
      displayName: "@demo",
      postingMode: "inbox",
    });
    const p2 = await saveTikTokProfileConnection(env.a.owner, {
      brandId: other,
      token: profileToken(3600_000 * 48),
      displayName: "@demo2",
    });
    expect(p2).toMatchObject({ id: p1.id, brandId, postingMode: "inbox", created: false });

    await disconnectConnection(env.a.owner, { kind: "tiktok_ads", connectionId: first.id });
    const types = new Set((await env.a.owner.db.select(auditLog)).map((a) => a.targetType));
    expect(types.has("tiktok_ad_connection")).toBe(true);
    expect(types.has("tiktok_profile_connection")).toBe(true);
    expect(types.has("tiktok_ads_connection")).toBe(false);
  });
});
