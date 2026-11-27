import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { brand, shopifyConnection, shopifyPendingInstall } from "@/lib/db/schema";
import { createBrand } from "@/lib/services/brands";
import { newBrandInput, setupTestEnv, type TestEnv } from "@/lib/services/__tests__/helpers";

import {
  beginAppStoreInstall,
  claimShopifyInstall,
  completeAppStoreInstall,
  isAppStoreCallback,
  pendingClaimShop,
  verifyLaunch,
} from "./app-store-install";
import { MOCK_SHOPIFY_API_SECRET, MOCK_SHOP_DOMAIN } from "./config";
import { signOAuthQuery } from "./hmac";
import { createMockShopifyClient } from "./mock";

// In-memory cookie jar standing in for next/headers.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const client = createMockShopifyClient();
const REDIRECT = "https://app.example.com/api/shopify/callback";

let env: TestEnv;
let brandId: string;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  jar.clear();
  await env.db.delete(shopifyPendingInstall);
  await env.db.delete(brand);
  brandId = (await createBrand(env.a.owner, newBrandInput())).id;
});

function launchQuery(overrides: Record<string, string> = {}) {
  const query: Record<string, string> = {
    shop: MOCK_SHOP_DOMAIN,
    timestamp: String(Math.floor(Date.now() / 1000)),
    host: "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvdHJlbmRjYXJ0",
    ...overrides,
  };
  query.hmac = signOAuthQuery(query, MOCK_SHOPIFY_API_SECRET);
  return query;
}

/** Shopify opens the app URL, OAuth runs, the callback parks the token. */
async function installFromShopify() {
  const url = await beginAppStoreInstall(MOCK_SHOP_DOMAIN, { client, redirectUri: REDIRECT });
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  expect(await isAppStoreCallback(query)).toBe(true);
  await completeAppStoreInstall(query, { client, db: env.db });
}

describe("Shopify-started install (public app)", () => {
  it("verifies the launch signature and its age", () => {
    expect(verifyLaunch(launchQuery(), client)).toBe(true);
    expect(verifyLaunch({ ...launchQuery(), shop: "other.myshopify.com" }, client)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3 * 24 * 3600);
    expect(verifyLaunch(launchQuery({ timestamp: old }), client)).toBe(false);
  });

  it("parks the token without a workspace, then the signed-in user claims it", async () => {
    await installFromShopify();
    const [parked] = await env.db.select().from(shopifyPendingInstall);
    expect(parked).toMatchObject({ shopDomain: MOCK_SHOP_DOMAIN });
    expect(parked!.accessTokenEnc).not.toContain("mock");
    expect(await pendingClaimShop({ db: env.db })).toBe(MOCK_SHOP_DOMAIN);

    const result = await claimShopifyInstall(env.a.owner, { brandId }, { client, db: env.db });
    expect(result).toMatchObject({ shopDomain: MOCK_SHOP_DOMAIN, created: true });

    const connections = await env.db.select().from(shopifyConnection);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      workspaceId: env.wsA,
      brandId,
      appMode: "public",
      status: "active",
    });
    expect(await env.db.select().from(shopifyPendingInstall)).toHaveLength(0);
    expect(await pendingClaimShop({ db: env.db })).toBeNull();
  });

  it("refuses roles without connection:create and browsers without the claim cookie", async () => {
    await installFromShopify();
    await expect(
      claimShopifyInstall(env.a.viewer, { brandId }, { client, db: env.db }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    jar.clear(); // another browser
    await expect(
      claimShopifyInstall(env.a.owner, { brandId }, { client, db: env.db }),
    ).rejects.toThrow(/No Shopify store is waiting/);
    expect(await env.db.select().from(shopifyPendingInstall)).toHaveLength(1);
  });

  it("does not treat an in-app callback as a Shopify-started one", async () => {
    expect(await isAppStoreCallback({ state: "x".repeat(43), shop: MOCK_SHOP_DOMAIN })).toBe(false);
  });
});
