import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decrypt, encrypt } from "@/lib/crypto";
import { brand, shopifyConnection } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { IntegrationError } from "@/lib/domain/contracts";
import { createSystemContext, type WorkspaceContext } from "@/lib/tenant/context";

import { loadShopifyCredentials, refreshTokenAad, tokenAad, tokenColumns } from "./credentials";
import { createMockShopifyClient } from "./mock";
import { createShopifyTestWorld, insertWorkspace } from "./testing";
import { serializeTokenBundle } from "./token-bundle";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const SHOP = "trendcart-demo.myshopify.com";

let db: Database;
let close: () => Promise<void>;
let ctx: WorkspaceContext;
let brandId: string;

beforeAll(async () => {
  ({ db, close } = await createShopifyTestWorld());
  ctx = createSystemContext(db, {
    workspaceId: await insertWorkspace(db, "W"),
    name: "workflow:test",
  });
}, 180_000);
afterAll(async () => close());
beforeEach(async () => {
  await db.delete(shopifyConnection);
  await db.delete(brand);
  brandId = (await ctx.db.insert(brand, { name: "B", country: "FR", language: "fr" })).id;
});

type TokenSpec = { expiresInMs: number | null; refreshToken: string | null };

const installToken = (t: TokenSpec) => ({
  shopDomain: SHOP,
  accessToken: "shpat_current",
  scopes: ["write_products"],
  refreshToken: t.refreshToken,
  expiresAt: t.expiresInMs === null ? null : new Date(NOW + t.expiresInMs).toISOString(),
  refreshTokenExpiresAt: t.refreshToken ? new Date(NOW + 90 * 86_400_000).toISOString() : null,
});

/** Current format: dedicated columns (migration 0001). */
async function connection(token: TokenSpec) {
  const id = crypto.randomUUID();
  return ctx.db.insert(shopifyConnection, {
    id,
    brandId,
    shopDomain: SHOP,
    ...tokenColumns(id, installToken(token)),
    scopes: ["write_products"],
    status: "active",
  });
}

/** M1 format: encrypted JSON bundle (or bare token) in access_token_enc, new columns null. */
async function legacyConnection(token: TokenSpec | string, shopDomain = SHOP) {
  const id = crypto.randomUUID();
  const plaintext = typeof token === "string" ? token : serializeTokenBundle(installToken(token));
  return ctx.db.insert(shopifyConnection, {
    id,
    brandId,
    accessTokenEnc: encrypt(plaintext, { aad: tokenAad(id) }),
    shopDomain,
    scopes: ["write_products"],
    status: "active",
  });
}

const deps = { client: createMockShopifyClient({ now: () => NOW }), now: () => NOW };

describe("loadShopifyCredentials", () => {
  it("stores the bare token and refresh token encrypted under separate AADs", async () => {
    const row = await connection({ expiresInMs: 30 * 60_000, refreshToken: "shprt_mock_a" });
    expect(decrypt(row.accessTokenEnc!, { aad: tokenAad(row.id) })).toBe("shpat_current");
    expect(decrypt(row.refreshTokenEnc!, { aad: refreshTokenAad(row.id) })).toBe("shprt_mock_a");
    expect(() => decrypt(row.refreshTokenEnc!, { aad: tokenAad(row.id) })).toThrow();
    expect(row.tokenExpiresAt?.getTime()).toBe(NOW + 30 * 60_000);
  });

  it("returns a still-valid token without refreshing", async () => {
    const row = await connection({ expiresInMs: 30 * 60_000, refreshToken: "shprt_mock_a" });
    expect(await loadShopifyCredentials(ctx, row.id, deps)).toEqual({
      shopDomain: SHOP,
      accessToken: "shpat_current",
    });
  });

  it("refreshes and persists a token close to expiry", async () => {
    const row = await connection({ expiresInMs: 60_000, refreshToken: "shprt_mock_a" });
    const creds = await loadShopifyCredentials(ctx, row.id, deps);
    expect(creds.accessToken).toMatch(/^shpat_mock_/);

    const stored = await ctx.db.getById(shopifyConnection, row.id);
    expect(decrypt(stored.accessTokenEnc!, { aad: tokenAad(row.id) })).toBe(creds.accessToken);
    const refresh = decrypt(stored.refreshTokenEnc!, { aad: refreshTokenAad(row.id) });
    expect(refresh).toMatch(/^shprt_mock_/);
    expect(refresh).not.toBe("shprt_mock_a");
    expect(stored.tokenExpiresAt!.getTime()).toBe(NOW + 3600_000);
    expect(stored.refreshTokenExpiresAt).not.toBeNull();
  });

  it("reads a legacy bundle, and rewrites it in the column format on its first refresh", async () => {
    const valid = await legacyConnection({
      expiresInMs: 30 * 60_000,
      refreshToken: "shprt_mock_a",
    });
    expect((await loadShopifyCredentials(ctx, valid.id, deps)).accessToken).toBe("shpat_current");

    const due = await legacyConnection(
      { expiresInMs: 60_000, refreshToken: "shprt_mock_a" },
      "trendcart-other.myshopify.com",
    );
    const creds = await loadShopifyCredentials(ctx, due.id, deps);
    const stored = await ctx.db.getById(shopifyConnection, due.id);
    expect(decrypt(stored.accessTokenEnc!, { aad: tokenAad(due.id) })).toBe(creds.accessToken);
    expect(stored.refreshTokenEnc).not.toBeNull();
    expect(stored.tokenExpiresAt).not.toBeNull();
    // And the rewritten row reads through the new path.
    expect((await loadShopifyCredentials(ctx, due.id, deps)).accessToken).toBe(creds.accessToken);
  });

  it("accepts a bare legacy token (non-expiring)", async () => {
    const row = await legacyConnection("shpat_legacy");
    expect((await loadShopifyCredentials(ctx, row.id, deps)).accessToken).toBe("shpat_legacy");
  });

  it("marks needs_reauth when the refresh token is rejected", async () => {
    const row = await connection({ expiresInMs: -1, refreshToken: "shprt_revoked" });
    const error = await loadShopifyCredentials(ctx, row.id, deps).catch((e) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.code).toBe("auth_expired");
    expect((await ctx.db.getById(shopifyConnection, row.id)).status).toBe("needs_reauth");
  });

  it("marks needs_reauth when an expired token has no refresh token", async () => {
    const row = await connection({ expiresInMs: -1, refreshToken: null });
    await expect(loadShopifyCredentials(ctx, row.id, deps)).rejects.toMatchObject({
      code: "auth_expired",
    });
    expect((await ctx.db.getById(shopifyConnection, row.id)).status).toBe("needs_reauth");
  });

  it("loads an expiring connection, and refuses every status without a usable token", async () => {
    const row = await connection({ expiresInMs: 30 * 60_000, refreshToken: "shprt_mock_a" });
    await ctx.db.update(shopifyConnection, { status: "expiring" }, undefined);
    expect((await loadShopifyCredentials(ctx, row.id, deps)).accessToken).toBe("shpat_current");

    for (const status of ["pending", "needs_reauth", "revoked", "disconnected"] as const) {
      await ctx.db.update(shopifyConnection, { status }, undefined);
      await expect(loadShopifyCredentials(ctx, row.id, deps)).rejects.toMatchObject({
        code: "auth_expired",
        retryable: false,
      });
    }
  });

  it("refuses disconnected connections", async () => {
    const row = await connection({ expiresInMs: null, refreshToken: null });
    await ctx.db.update(shopifyConnection, { status: "disconnected" }, undefined);
    await expect(loadShopifyCredentials(ctx, row.id, deps)).rejects.toMatchObject({
      code: "auth_expired",
    });
  });
});
