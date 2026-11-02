/**
 * M1 isolation suite: two workspaces owned by two different people, each with
 * its own brand, Shopify store (different shop, different Shopify account),
 * TikTok ad account and an imported product, all through the real mock
 * adapters. Every M1 entry point is then called by workspace B with
 * workspace A's ids (the "foreign id in the URL / action payload" attack).
 * Nothing of A may be readable or mutable, and A's data must be unchanged.
 */
import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { OAuthStateError, openOAuthState, sealOAuthState } from "@/lib/auth/oauth-state";
import {
  approval,
  auditLog,
  brand,
  product,
  proxy,
  shopifyConnection,
  tiktokAdConnection,
  video,
} from "@/lib/db/schema";
import { MOCK_SHOPIFY_API_SECRET } from "@/lib/integrations/shopify/config";
import { completeShopifyInstall, startShopifyInstall } from "@/lib/integrations/shopify/install";
import { handleShopifyWebhook } from "@/lib/integrations/shopify/webhooks";
import {
  clearBrandProxy,
  confirmProduct,
  deleteBrand,
  disconnectConnection,
  getBrand,
  getProduct,
  getUsage,
  importFromProductLink,
  importFromTikTok,
  listBrands,
  listConnections,
  listProducts,
  listUsage,
  retryStep,
  setBrandProxy,
  setShopifyTemplate,
  toggleBrandProxy,
  updateBrand,
} from "@/lib/services";
import {
  getShopifyCredentials,
  getTikTokAdsCredentials,
  markConnectionNeedsReauth,
} from "@/lib/services/internal/credentials";
import { listWorkspaceMembers } from "@/lib/tenant/members";
import { findShopifyConnectionsByShopDomain, getSystemContext } from "@/lib/tenant/system";
import { assertCanConnect, completeAdsConnection } from "@/app/api/tiktok/_lib/connect";

import {
  adsFlow,
  connectShopifyMock,
  connectTikTokAdsMock,
  createTwoTenantWorld,
  mockDeps,
  SHOPIFY_REDIRECT_URI,
  type TwoTenantWorld,
} from "../helpers/world";

const SHOP_A = "alpha-store.myshopify.com";
const SHOP_B = "bravo-store.myshopify.com";
const TIKTOK_A = "https://www.tiktok.com/@alpha/video/7350000000000000011";
const TIKTOK_B = "https://www.tiktok.com/@bravo/video/7350000000000000022";

let w: TwoTenantWorld;
let ids: {
  shopA: string;
  shopB: string;
  adsA: string;
  adsB: string;
  productA: string;
  productB: string;
};

/** Snapshot of everything workspace A owns, to prove nothing changed. */
async function snapshotA() {
  const db = w.a.owner.db;
  const strip = <T extends { updatedAt?: Date }>(rows: T[]) =>
    rows.map((row) => {
      const rest = { ...row };
      delete rest.updatedAt;
      return rest;
    });
  return {
    brands: strip(await db.select(brand)),
    proxies: strip(await db.select(proxy)),
    shops: strip(await db.select(shopifyConnection)),
    ads: strip(await db.select(tiktokAdConnection)),
    products: strip(await db.select(product)),
    videos: strip(await db.select(video)),
    approvals: await db.select(approval),
    audits: await db.select(auditLog),
  };
}

beforeAll(async () => {
  w = await createTwoTenantWorld();
  const deps = mockDeps(w.integrations);

  const shopA = await connectShopifyMock(w.a.owner, w.shopify, {
    appMode: "public",
    brandId: w.a.brandId,
    shop: SHOP_A,
  });
  const shopB = await connectShopifyMock(w.b.owner, w.shopify, {
    appMode: "public",
    brandId: w.b.brandId,
    shop: SHOP_B,
  });
  const adsA = await connectTikTokAdsMock(w.a.owner, w.integrations, w.a.brandId);
  const adsB = await connectTikTokAdsMock(w.b.owner, w.integrations, w.b.brandId);
  await setBrandProxy(w.a.owner, w.a.brandId, { url: "http://alpha:secret@proxy.example:8080" });

  const pA = await importFromTikTok(w.a.creative, { url: TIKTOK_A, brandId: w.a.brandId }, deps);
  const pB = await importFromTikTok(w.b.creative, { url: TIKTOK_B, brandId: w.b.brandId }, deps);

  ids = {
    shopA: shopA.result.connectionId,
    shopB: shopB.result.connectionId,
    adsA: adsA.connections[0]!.id,
    adsB: adsB.connections[0]!.id,
    productA: pA.product.id,
    productB: pB.product.id,
  };
}, 240_000);

afterAll(async () => w.close());

describe("two tenants are set up through the real mock flows", () => {
  it("each workspace has its own store, ad account and analysed product", async () => {
    expect(ids.shopA).not.toBe(ids.shopB);
    // The mock grants the same advertiser to both: it must still be two rows.
    expect(ids.adsA).not.toBe(ids.adsB);
    const a = await getProduct(w.a.viewer, ids.productA);
    const b = await getProduct(w.b.viewer, ids.productB);
    expect(a.status).toBe("awaiting_product_confirmation");
    expect(b.status).toBe("awaiting_product_confirmation");
  });
});

describe("reads: workspace B never sees workspace A", () => {
  it("lists only its own brands, products, connections, usage and members", async () => {
    const brandsB = await listBrands(w.b.owner);
    expect(brandsB.map((x) => x.id)).toEqual([w.b.brandId]);

    const productsB = await listProducts(w.b.owner);
    expect(productsB.items.map((p) => p.id)).toEqual([ids.productB]);
    expect(productsB.total).toBe(1);
    // Filtering on a foreign brand id returns nothing rather than A's rows.
    expect(await listProducts(w.b.owner, { brandId: w.a.brandId })).toEqual({
      items: [],
      total: 0,
    });

    const membersB = await listWorkspaceMembers(w.b.owner, w.db);
    expect(membersB.every((m) => !m.name.startsWith("Alpha"))).toBe(true);

    // Usage rows are per workspace: B's history holds exactly B's month.
    const usageB = await getUsage(w.b.owner);
    const historyB = await listUsage(w.b.owner);
    expect(historyB.length).toBeLessThanOrEqual(1);
    expect(historyB.every((u) => u.aiCostUsd === usageB.aiCostUsd)).toBe(true);
  });

  it("foreign ids are 404, never 403 (no existence oracle)", async () => {
    await expect(getBrand(w.b.owner, w.a.brandId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProduct(w.b.owner, ids.productA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listConnections(w.b.owner, w.a.brandId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assertCanConnect(w.b.owner, w.a.brandId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("internal credential loaders cannot decrypt another workspace's tokens", async () => {
    await expect(
      getShopifyCredentials(w.b.owner, ids.shopA, { client: w.shopify }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTikTokAdsCredentials(w.b.owner, ids.adsA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // A system context bound to B is just as blind.
    await expect(getTikTokAdsCredentials(w.system(w.b.workspaceId), ids.adsA)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("writes: workspace B cannot mutate workspace A", () => {
  it("brand, proxy, connection and product mutations with A's ids all fail and change nothing", async () => {
    const before = await snapshotA();
    const deps = mockDeps(w.integrations);
    const owner = w.b.owner;

    const attempts: [string, () => Promise<unknown>][] = [
      ["updateBrand", () => updateBrand(owner, w.a.brandId, { name: "pwned" })],
      ["deleteBrand", () => deleteBrand(owner, w.a.brandId)],
      ["setBrandProxy", () => setBrandProxy(owner, w.a.brandId, { url: "http://evil:1@x.io:1" })],
      ["toggleBrandProxy", () => toggleBrandProxy(owner, w.a.brandId, false)],
      ["clearBrandProxy", () => clearBrandProxy(owner, w.a.brandId)],
      [
        "disconnect shopify",
        () => disconnectConnection(owner, { kind: "shopify", connectionId: ids.shopA }),
      ],
      [
        "disconnect tiktok_ads",
        () => disconnectConnection(owner, { kind: "tiktok_ads", connectionId: ids.adsA }),
      ],
      [
        "setShopifyTemplate",
        () => setShopifyTemplate(owner, { connectionId: ids.shopA, templateSuffix: "evil" }),
      ],
      [
        "importFromTikTok into A's brand",
        () => importFromTikTok(owner, { url: TIKTOK_B, brandId: w.a.brandId }, deps),
      ],
      [
        "importFromProductLink into A's brand",
        () =>
          importFromProductLink(
            owner,
            { url: "https://shop.example.com/p/lamp", brandId: w.a.brandId },
            deps,
          ),
      ],
      [
        "confirmProduct (GATE 1) on A's product",
        () => confirmProduct(owner, { productId: ids.productA }, deps),
      ],
      ["retryStep on A's product", () => retryStep(owner, ids.productA, deps)],
      [
        "startShopifyInstall for A's brand",
        () =>
          startShopifyInstall(
            owner,
            { appMode: "public", brandId: w.a.brandId, shop: "evil.myshopify.com" },
            {
              client: w.shopify,
              redirectUri: SHOPIFY_REDIRECT_URI,
              beginState: async () => "x".repeat(43),
            },
          ),
      ],
    ];

    for (const [name, attempt] of attempts) {
      const error = await attempt().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, `${name} must be refused`).not.toBeNull();
      // toggleBrandProxy looks the proxy up by brand in B's scope: "no proxy" is fine too.
      const refused =
        error instanceof NotFoundError ||
        (name === "toggleBrandProxy" &&
          (error as { code?: string }).code === "precondition_failed");
      expect(refused, `${name} threw ${String(error)}`).toBe(true);
    }

    // The background marker is scoped too: it reports "nothing updated".
    await markConnectionNeedsReauth(owner, "shopify", ids.shopA, "qa");

    expect(await snapshotA()).toEqual(before);
  });

  it("an OAuth flow started in A cannot be completed by a session of B", async () => {
    // Ads: flow sealed for A's workspace/user, replayed with B's session.
    const flowA = adsFlow(w.a.owner, w.a.brandId);
    await expect(
      completeAdsConnection(w.b.owner, {
        flow: flowA,
        code: "mock-ads-auth-code",
        client: w.integrations.tiktokAds,
      }),
    ).rejects.toBeInstanceOf(OAuthStateError);

    // Shopify: same idea; the shop/state/HMAC are valid, the session is not.
    let sealedState = "";
    const { url } = await startShopifyInstall(
      w.a.owner,
      { appMode: "public", brandId: w.a.brandId, shop: "alpha-second.myshopify.com" },
      {
        client: w.shopify,
        redirectUri: SHOPIFY_REDIRECT_URI,
        beginState: async (s) => {
          const out = sealOAuthState("shopify", s);
          sealedState = out.sealed;
          return out.state;
        },
      },
    );
    const query = Object.fromEntries(new URL(url).searchParams.entries());
    const flow = openOAuthState("shopify", sealedState, query.state);
    await expect(
      completeShopifyInstall(w.b.owner, { query, flow }, { client: w.shopify }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Even another member of A (not the starter) cannot finish it.
    await expect(
      completeShopifyInstall(w.a.mediaBuyer, { query, flow }, { client: w.shopify }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // The half-finished flow left no connection behind.
    expect(await w.a.owner.db.count(shopifyConnection)).toBe(1);
  });

  it("a B flow that smuggles A's brand id is refused by B's scope", async () => {
    const flow = adsFlow(w.b.owner, w.a.brandId);
    await expect(
      completeAdsConnection(w.b.owner, {
        flow,
        code: "mock-ads-auth-code",
        client: w.integrations.tiktokAds,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("cross-workspace system helpers (webhooks, crons)", () => {
  it("return ids only, never secrets", async () => {
    const refs = await findShopifyConnectionsByShopDomain(SHOP_A, w.db);
    expect(refs).toEqual([{ workspaceId: w.a.workspaceId, connectionId: ids.shopA }]);
    for (const ref of refs)
      expect(Object.keys(ref).sort()).toEqual(["connectionId", "workspaceId"]);
  });

  it("a verified app/uninstalled for B's shop only disconnects B's store", async () => {
    const body = JSON.stringify({ myshopify_domain: SHOP_B, domain: SHOP_B });
    const hmac = createHmac("sha256", MOCK_SHOPIFY_API_SECRET).update(body).digest("base64");
    const headers = new Headers({
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": "app/uninstalled",
      "x-shopify-shop-domain": SHOP_B,
    });
    const result = await handleShopifyWebhook(
      { rawBody: body, headers },
      {
        client: w.shopify,
        lookup: {
          findConnectionsByShop: (shop) => findShopifyConnectionsByShopDomain(shop, w.db),
          systemContext: (workspaceId) => getSystemContext(workspaceId, "webhook:shopify", w.db),
        },
      },
    );
    expect(result.status).toBe(200);
    const a = await w.a.owner.db.getById(shopifyConnection, ids.shopA);
    const b = await w.b.owner.db.getById(shopifyConnection, ids.shopB);
    expect(a.status).toBe("active");
    expect(a.accessTokenEnc).not.toBeNull();
    expect(b.status).toBe("disconnected");
    expect(b.accessTokenEnc).toBeNull();
  });

  it("an unsigned or mis-signed webhook is 401 before any lookup", async () => {
    let looked = false;
    const lookup = {
      findConnectionsByShop: async () => {
        looked = true;
        return [];
      },
      systemContext: (workspaceId: string) =>
        getSystemContext(workspaceId, "webhook:shopify", w.db),
    };
    const body = JSON.stringify({ myshopify_domain: SHOP_A });
    const unsigned = await handleShopifyWebhook(
      {
        rawBody: body,
        headers: new Headers({
          "x-shopify-topic": "app/uninstalled",
          "x-shopify-shop-domain": SHOP_A,
        }),
      },
      { client: w.shopify, lookup },
    );
    expect(unsigned.status).toBe(401);
    expect(looked).toBe(false);

    const wrong = createHmac("sha256", "not-the-secret").update(body).digest("base64");
    const forged = await handleShopifyWebhook(
      {
        rawBody: body,
        headers: new Headers({
          "x-shopify-hmac-sha256": wrong,
          "x-shopify-topic": "app/uninstalled",
          "x-shopify-shop-domain": SHOP_A,
        }),
      },
      { client: w.shopify, lookup },
    );
    expect(forged.status).toBe(401);
    const a = await w.a.owner.db.getById(shopifyConnection, ids.shopA);
    expect(a.status).toBe("active");
  });
});
