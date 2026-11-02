import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import {
  OAuthStateError,
  openOAuthState,
  sealOAuthState,
  type OAuthFlow,
} from "@/lib/auth/oauth-state";
import { decrypt } from "@/lib/crypto";
import { auditLog, brand, shopifyConnection } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { IntegrationError } from "@/lib/domain/contracts";
import type { UserWorkspaceContext } from "@/lib/tenant/context";

import { MOCK_SHOP_DOMAIN } from "./config";
import { clientSecretAad, refreshTokenAad, tokenAad } from "./credentials";
import { completeShopifyInstall, startShopifyInstall, type InstallFlowData } from "./install";
import { createMockShopifyClient } from "./mock";
import { createShopifyTestWorld, insertWorkspace, memberContext } from "./testing";

let db: Database;
let close: () => Promise<void>;
let owner: UserWorkspaceContext;
let viewer: UserWorkspaceContext;
let otherWorkspaceOwner: UserWorkspaceContext;
let brandId: string;

const redirectUri = "http://localhost:3000/api/shopify/callback";

beforeAll(async () => {
  ({ db, close } = await createShopifyTestWorld());
  const ws = await insertWorkspace(db, "Shop WS");
  const other = await insertWorkspace(db, "Other WS");
  owner = await memberContext(db, ws, "owner");
  viewer = await memberContext(db, ws, "viewer");
  otherWorkspaceOwner = await memberContext(db, other, "owner");
}, 180_000);

afterAll(async () => close());

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(shopifyConnection);
  await db.delete(brand);
  brandId = (await owner.db.insert(brand, { name: "Acme", country: "FR", language: "fr" })).id;
});

/** Runs start, captures the sealed state cookie, returns what the callback receives. */
async function runStart(
  ctx: UserWorkspaceContext,
  input: Parameters<typeof startShopifyInstall>[1],
  client = createMockShopifyClient(),
) {
  let sealed = "";
  const { url } = await startShopifyInstall(ctx, input, {
    client,
    redirectUri,
    beginState: async (s) => {
      const out = sealOAuthState("shopify", s);
      sealed = out.sealed;
      return out.state;
    },
  });
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  return { url, query, sealed, client };
}

describe("Shopify install (mock mode, end to end)", () => {
  it("connects a store: verifies, stores the token encrypted, audits", async () => {
    const { url, query, sealed, client } = await runStart(owner, {
      appMode: "public",
      brandId,
      shop: "Trendcart-Demo",
    });
    expect(url.startsWith(redirectUri)).toBe(true);

    const flow = openOAuthState("shopify", sealed, query.state);
    expect(flow.data).toMatchObject({ brandId, shopDomain: MOCK_SHOP_DOMAIN, appMode: "public" });

    const result = await completeShopifyInstall(owner, { query, flow }, { client });
    expect(result).toMatchObject({
      shopDomain: MOCK_SHOP_DOMAIN,
      created: true,
      metafieldsReady: true,
    });

    const row = await owner.db.getById(shopifyConnection, result.connectionId);
    expect(row).toMatchObject({
      brandId,
      shopDomain: MOCK_SHOP_DOMAIN,
      appMode: "public",
      status: "active",
    });
    expect(row.scopes).toContain("read_themes");
    expect(row.accessTokenEnc).not.toContain("shpat_");
    // Dedicated columns: bare access token, refresh token and expiries.
    expect(decrypt(row.accessTokenEnc!, { aad: tokenAad(row.id) })).toMatch(/^shpat_mock_/);
    expect(decrypt(row.refreshTokenEnc!, { aad: refreshTokenAad(row.id) })).toMatch(/^shprt_mock_/);
    expect(row.tokenExpiresAt).toBeInstanceOf(Date);
    expect(row.refreshTokenExpiresAt).toBeInstanceOf(Date);
    // AAD binds the ciphertext to this row and column.
    expect(() => decrypt(row.accessTokenEnc!, { aad: tokenAad("other-row") })).toThrow();

    const audits = await owner.db.select(auditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "connection.create",
      targetType: "shopify_connection",
      targetId: row.id,
      actorUserId: owner.actor.userId,
    });
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain("shpat_");

    // Reconnecting updates the same row and audits an update.
    const again = await runStart(owner, { appMode: "public", brandId, shop: MOCK_SHOP_DOMAIN });
    const flow2 = openOAuthState("shopify", again.sealed, again.query.state);
    const result2 = await completeShopifyInstall(
      owner,
      { query: again.query, flow: flow2 },
      { client },
    );
    expect(result2).toMatchObject({ connectionId: row.id, created: false });
    expect((await owner.db.select(auditLog)).map((a) => a.action).sort()).toEqual([
      "connection.create",
      "connection.update",
    ]);
  });

  it("custom app mode keeps the per-store secret encrypted and uses it", async () => {
    const { query, sealed, client } = await runStart(owner, {
      appMode: "custom",
      brandId,
      shop: MOCK_SHOP_DOMAIN,
      clientId: "custom-client-id",
      clientSecret: "custom-client-secret",
    });
    const pending = await owner.db.findFirst(shopifyConnection, (t) =>
      eq(t.shopDomain, MOCK_SHOP_DOMAIN),
    );
    expect(pending).toMatchObject({
      status: "pending",
      appMode: "custom",
      clientId: "custom-client-id",
    });
    expect(decrypt(pending!.clientSecretEnc!, { aad: clientSecretAad(pending!.id) })).toBe(
      "custom-client-secret",
    );

    const flow = openOAuthState("shopify", sealed, query.state);
    const result = await completeShopifyInstall(owner, { query, flow }, { client });
    expect(result.connectionId).toBe(pending!.id);
    const row = await owner.db.getById(shopifyConnection, pending!.id);
    expect(row).toMatchObject({
      status: "active",
      appMode: "custom",
      clientId: "custom-client-id",
    });
    expect(row.clientSecretEnc).toBe(pending!.clientSecretEnc);
  });

  it("rejects a bad state: no connection written", async () => {
    const { query, sealed } = await runStart(owner, {
      appMode: "public",
      brandId,
      shop: MOCK_SHOP_DOMAIN,
    });
    expect(() => openOAuthState("shopify", sealed, "x".repeat(43))).toThrow(OAuthStateError);
    expect(() => openOAuthState("shopify", undefined, query.state)).toThrow(OAuthStateError);
    expect(await owner.db.count(shopifyConnection)).toBe(0);
  });

  it("rejects a state that does not match the signed callback", async () => {
    const a = await runStart(owner, { appMode: "public", brandId, shop: MOCK_SHOP_DOMAIN });
    const b = await runStart(owner, { appMode: "public", brandId, shop: MOCK_SHOP_DOMAIN });
    // Flow from attempt B, callback from attempt A.
    const flowB = openOAuthState("shopify", b.sealed, b.query.state);
    await expect(
      completeShopifyInstall(owner, { query: a.query, flow: flowB }, { client: a.client }),
    ).rejects.toThrow(/state/);
    expect(await owner.db.count(shopifyConnection)).toBe(0);
    expect(await owner.db.count(auditLog)).toBe(0);
  });

  it("rejects a bad HMAC: no connection written", async () => {
    const { query, sealed, client } = await runStart(owner, {
      appMode: "public",
      brandId,
      shop: MOCK_SHOP_DOMAIN,
    });
    const flow = openOAuthState("shopify", sealed, query.state);
    const forged = { ...query, hmac: "0".repeat(64) };
    const error = await completeShopifyInstall(owner, { query: forged, flow }, { client }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.message).toMatch(/signature/);
    expect(await owner.db.count(shopifyConnection)).toBe(0);
  });

  it("rejects a callback for another shop than requested", async () => {
    const { query, sealed, client } = await runStart(owner, {
      appMode: "public",
      brandId,
      shop: MOCK_SHOP_DOMAIN,
    });
    const flow = openOAuthState("shopify", sealed, query.state);
    await expect(
      completeShopifyInstall(
        owner,
        { query: { ...query, shop: "other.myshopify.com" }, flow },
        { client },
      ),
    ).rejects.toThrow(/does not match/);
  });

  it("checks role and session binding", async () => {
    await expect(
      runStart(viewer, { appMode: "public", brandId, shop: MOCK_SHOP_DOMAIN }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const { query, sealed, client } = await runStart(owner, {
      appMode: "public",
      brandId,
      shop: MOCK_SHOP_DOMAIN,
    });
    const flow = openOAuthState("shopify", sealed, query.state);
    await expect(
      completeShopifyInstall(viewer, { query, flow }, { client }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      completeShopifyInstall(otherWorkspaceOwner, { query, flow }, { client }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // A brand from another workspace is invisible.
    await expect(
      runStart(otherWorkspaceOwner, { appMode: "public", brandId, shop: MOCK_SHOP_DOMAIN }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an invalid shop domain at start", async () => {
    await expect(
      runStart(owner, { appMode: "public", brandId, shop: "acme.myshopify.com.evil.test" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses a tampered flow payload", async () => {
    const { query, sealed, client } = await runStart(owner, {
      appMode: "public",
      brandId,
      shop: MOCK_SHOP_DOMAIN,
    });
    const flow = openOAuthState("shopify", sealed, query.state);
    const tampered: OAuthFlow = {
      ...flow,
      data: { ...(flow.data as InstallFlowData), appMode: "nope" },
    };
    await expect(
      completeShopifyInstall(owner, { query, flow: tampered }, { client }),
    ).rejects.toThrow();
  });
});
