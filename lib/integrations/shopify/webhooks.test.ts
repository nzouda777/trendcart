import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encrypt } from "@/lib/crypto";
import { auditLog, brand, shopifyConnection } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { createSystemContext } from "@/lib/tenant/context";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import oauth from "./__fixtures__/oauth.json";
import { clientSecretAad, refreshTokenAad, tokenAad } from "./credentials";
import { signWebhookBody } from "./hmac";
import { createLiveShopifyClient } from "./live";
import { createShopifyTestWorld, insertWorkspace } from "./testing";
import {
  createWebhookDeduper,
  handleShopifyWebhook,
  MAX_CUSTOM_CANDIDATES,
  type ShopifyWebhookLookup,
} from "./webhooks";

const SHOP = "some-shop.myshopify.com";
const PUBLIC_SECRET = oauth.secret; // the fixture delivery is signed with it

let db: Database;
let close: () => Promise<void>;
let wsA: string;
let wsB: string;

const client = createLiveShopifyClient({
  apiKey: "k",
  apiSecret: PUBLIC_SECRET,
  fetch: async () => {
    throw new Error("no network in webhook tests");
  },
});

/** What foundation is asked to provide; implemented over the raw test db here. */
const lookup = (): ShopifyWebhookLookup => ({
  async findConnectionsByShop(shopDomain) {
    const rows = await db
      .select({ workspaceId: shopifyConnection.workspaceId, connectionId: shopifyConnection.id })
      .from(shopifyConnection)
      .where(eq(shopifyConnection.shopDomain, shopDomain));
    return rows;
  },
  systemContext: (workspaceId) => createSystemContext(db, { workspaceId, name: "webhook:shopify" }),
});

async function connect(workspaceId: string, appMode: "public" | "custom", secret?: string) {
  const scoped = createScopedDb(db, workspaceId);
  const b = await scoped.insert(brand, { name: "B", country: "FR", language: "fr" });
  const id = crypto.randomUUID();
  return scoped.insert(shopifyConnection, {
    id,
    brandId: b.id,
    shopDomain: SHOP,
    appMode,
    clientId: appMode === "custom" ? "cid" : null,
    clientSecretEnc: secret ? encrypt(secret, { aad: clientSecretAad(id) }) : null,
    accessTokenEnc: encrypt("shpat_live_token", { aad: tokenAad(id) }),
    refreshTokenEnc: encrypt("shprt_live_token", { aad: refreshTokenAad(id) }),
    tokenExpiresAt: new Date("2026-10-25T13:00:00.000Z"),
    refreshTokenExpiresAt: new Date("2027-01-23T12:00:00.000Z"),
    scopes: ["write_products"],
    status: "active",
  });
}

/** Like a real delivery: every one carries a fresh X-Shopify-Webhook-Id unless given. */
function headers(
  topic: string,
  hmac: string | null,
  shop = SHOP,
  webhookId: string | null = crypto.randomUUID(),
) {
  const h = new Headers({ "x-shopify-topic": topic, "x-shopify-shop-domain": shop });
  if (hmac !== null) h.set("x-shopify-hmac-sha256", hmac);
  if (webhookId !== null) h.set("x-shopify-webhook-id", webhookId);
  return h;
}

/** Wraps a lookup to count DB lookups and how many custom secrets get decrypted. */
function countingLookup() {
  const inner = lookup();
  const stats = { lookups: 0 };
  const wrapped: ShopifyWebhookLookup = {
    findConnectionsByShop: async (shop) => {
      stats.lookups++;
      return inner.findConnectionsByShop(shop);
    },
    systemContext: inner.systemContext,
  };
  return { lookup: wrapped, stats };
}

const rowOf = async (workspaceId: string, id: string) =>
  (
    await db
      .select()
      .from(shopifyConnection)
      .where(and(eq(shopifyConnection.workspaceId, workspaceId), eq(shopifyConnection.id, id)))
  )[0]!;

beforeAll(async () => {
  ({ db, close } = await createShopifyTestWorld());
  wsA = await insertWorkspace(db, "A");
  wsB = await insertWorkspace(db, "B");
}, 180_000);
afterAll(async () => close());
beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(shopifyConnection);
  await db.delete(brand);
});

describe("Shopify webhooks", () => {
  it("app/uninstalled (recorded delivery) revokes the public connection and audits", async () => {
    const conn = await connect(wsA, "public");
    const res = await handleShopifyWebhook(
      { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", oauth.webhook.hmac) },
      { client, lookup: lookup() },
    );
    expect(res.status).toBe(200);

    const row = await rowOf(wsA, conn.id);
    expect(row).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scopes: [],
    });
    const audits = await createScopedDb(db, wsA).select(auditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "connection.update",
      targetId: conn.id,
      actorUserId: null,
    });
    expect(audits[0]!.metadata).toMatchObject({
      change: "app_uninstalled",
      system: "webhook:shopify",
    });

    // Idempotent: a redelivery changes nothing and writes no second audit.
    await handleShopifyWebhook(
      { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", oauth.webhook.hmac) },
      { client, lookup: lookup() },
    );
    expect(await createScopedDb(db, wsA).count(auditLog)).toBe(1);
  });

  it("returns 401 on an invalid or missing signature and changes nothing", async () => {
    const conn = await connect(wsA, "public");
    for (const hmac of [
      null,
      "",
      signWebhookBody(oauth.webhook.body, "wrong"),
      oauth.webhook.hmac.slice(4),
    ]) {
      const res = await handleShopifyWebhook(
        { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", hmac) },
        { client, lookup: lookup() },
      );
      expect(res.status).toBe(401);
    }
    // Tampered body with the original signature.
    const res = await handleShopifyWebhook(
      {
        rawBody: oauth.webhook.body.replace("Some Shop", "Evil"),
        headers: headers("app/uninstalled", oauth.webhook.hmac),
      },
      { client, lookup: lookup() },
    );
    expect(res.status).toBe(401);
    expect((await rowOf(wsA, conn.id)).status).toBe("active");
  });

  it("acknowledges the customer compliance topics (no customer data stored)", async () => {
    for (const topic of ["customers/data_request", "customers/redact"]) {
      const body = JSON.stringify({
        shop_domain: SHOP,
        customer: { id: 1, email: "a@example.test" },
      });
      const res = await handleShopifyWebhook(
        { rawBody: body, headers: headers(topic, signWebhookBody(body, PUBLIC_SECRET)) },
        { client }, // works even without the lookup
      );
      expect(res.status).toBe(200);
    }
  });

  it("compliance topics require a valid HMAC (401)", async () => {
    const body = JSON.stringify({ shop_domain: SHOP });
    const res = await handleShopifyWebhook(
      { rawBody: body, headers: headers("customers/redact", signWebhookBody(body, "attacker")) },
      { client },
    );
    expect(res.status).toBe(401);
  });

  it("shop/redact also drops the custom app secret", async () => {
    const conn = await connect(wsA, "custom", "store-secret");
    const body = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
    const res = await handleShopifyWebhook(
      { rawBody: body, headers: headers("shop/redact", signWebhookBody(body, "store-secret")) },
      { client, lookup: lookup() },
    );
    expect(res.status).toBe(200);
    expect(await rowOf(wsA, conn.id)).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      clientSecretEnc: null,
    });
  });

  it("a custom-app delivery only affects the connection whose secret signed it", async () => {
    const pub = await connect(wsA, "public");
    const custom = await connect(wsB, "custom", "store-secret");
    const body = JSON.stringify({ myshopify_domain: SHOP });
    const res = await handleShopifyWebhook(
      { rawBody: body, headers: headers("app/uninstalled", signWebhookBody(body, "store-secret")) },
      { client, lookup: lookup() },
    );
    expect(res.status).toBe(200);
    expect((await rowOf(wsB, custom.id)).status).toBe("disconnected");
    expect((await rowOf(wsA, pub.id)).status).toBe("active");
  });

  it("a public-app delivery does not touch custom-mode connections", async () => {
    const pub = await connect(wsA, "public");
    const custom = await connect(wsB, "custom", "store-secret");
    await handleShopifyWebhook(
      { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", oauth.webhook.hmac) },
      { client, lookup: lookup() },
    );
    expect((await rowOf(wsA, pub.id)).status).toBe("disconnected");
    expect((await rowOf(wsB, custom.id)).status).toBe("active");
  });

  it("asks Shopify to retry (503) when the cross-workspace lookup is not wired", async () => {
    const res = await handleShopifyWebhook(
      { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", oauth.webhook.hmac) },
      { client },
    );
    expect(res.status).toBe(503);
  });

  it("acknowledges unknown topics after verification", async () => {
    const body = "{}";
    const res = await handleShopifyWebhook(
      { rawBody: body, headers: headers("products/update", signWebhookBody(body, PUBLIC_SECRET)) },
      { client },
    );
    expect(res).toEqual({ status: 200, body: "ignored" });
  });

  describe("hardening (QA N2)", () => {
    const spyClient = () => {
      const custom: string[] = [];
      const wrapped = {
        ...client,
        verifyWebhook: (input: Parameters<typeof client.verifyWebhook>[0]) => {
          if (input.app) custom.push(input.app.clientId);
          return client.verifyWebhook(input);
        },
      };
      return { client: wrapped, custom };
    };

    it("an unsigned request without a webhook id never reaches the DB", async () => {
      await connect(wsA, "custom", "store-secret");
      const { lookup: l, stats } = countingLookup();
      const body = JSON.stringify({ myshopify_domain: SHOP });
      const res = await handleShopifyWebhook(
        {
          rawBody: body,
          headers: headers("app/uninstalled", signWebhookBody(body, "attacker"), SHOP, null),
        },
        { client, lookup: l },
      );
      expect(res.status).toBe(401);
      expect(stats.lookups).toBe(0);
    });

    it("a body shop that differs from the header is rejected before any lookup", async () => {
      await connect(wsA, "custom", "store-secret");
      const { lookup: l, stats } = countingLookup();
      const body = JSON.stringify({ myshopify_domain: "other-shop.myshopify.com" });
      const res = await handleShopifyWebhook(
        { rawBody: body, headers: headers("app/uninstalled", signWebhookBody(body, "attacker")) },
        { client, lookup: l },
      );
      expect(res.status).toBe(401);
      expect(stats.lookups).toBe(0);
    });

    it("unhandled topics and non-JSON bodies never reach the DB unless public-signed", async () => {
      const { lookup: l, stats } = countingLookup();
      for (const [topic, body] of [
        ["products/update", "{}"],
        ["app/uninstalled", "not json"],
      ] as const) {
        const res = await handleShopifyWebhook(
          { rawBody: body, headers: headers(topic, signWebhookBody(body, "attacker")) },
          { client, lookup: l },
        );
        expect(res.status).toBe(401);
      }
      expect(stats.lookups).toBe(0);
    });

    it("a public-signed delivery whose body names another shop is refused", async () => {
      const conn = await connect(wsA, "public");
      const body = JSON.stringify({ myshopify_domain: "other-shop.myshopify.com" });
      const res = await handleShopifyWebhook(
        {
          rawBody: body,
          headers: headers("app/uninstalled", signWebhookBody(body, PUBLIC_SECRET)),
        },
        { client, lookup: lookup() },
      );
      expect(res.status).toBe(400);
      expect((await rowOf(wsA, conn.id)).status).toBe("active");
    });

    it(`tries at most ${MAX_CUSTOM_CANDIDATES} custom secrets per request`, async () => {
      for (let i = 0; i < MAX_CUSTOM_CANDIDATES + 2; i++) {
        await connect(await insertWorkspace(db, `cap-${i}`), "custom", `secret-${i}`);
      }
      const spy = spyClient();
      const body = JSON.stringify({ myshopify_domain: SHOP });
      const res = await handleShopifyWebhook(
        { rawBody: body, headers: headers("app/uninstalled", signWebhookBody(body, "attacker")) },
        { client: spy.client, lookup: lookup() },
      );
      expect(res.status).toBe(401);
      expect(spy.custom).toHaveLength(MAX_CUSTOM_CANDIDATES);
    });

    it("public-signed deliveries skip custom secrets entirely", async () => {
      await connect(wsB, "custom", "store-secret");
      await connect(wsA, "public");
      const spy = spyClient();
      await handleShopifyWebhook(
        { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", oauth.webhook.hmac) },
        { client: spy.client, lookup: lookup() },
      );
      expect(spy.custom).toHaveLength(0);
    });

    it("dedupes on X-Shopify-Webhook-Id after a verified, handled delivery only", async () => {
      await connect(wsA, "public");
      const deduper = createWebhookDeduper();
      const { lookup: l, stats } = countingLookup();
      const id = crypto.randomUUID();
      const send = (hmac: string) =>
        handleShopifyWebhook(
          { rawBody: oauth.webhook.body, headers: headers("app/uninstalled", hmac, SHOP, id) },
          { client, lookup: l, deduper },
        );

      // A forged replay of the id before the real one is not recorded.
      expect((await send(signWebhookBody(oauth.webhook.body, "attacker"))).status).toBe(401);
      expect(await send(oauth.webhook.hmac)).toEqual({ status: 200, body: "ok" });
      const lookupsAfterFirst = stats.lookups;
      expect(await send(oauth.webhook.hmac)).toEqual({ status: 200, body: "duplicate" });
      expect(stats.lookups).toBe(lookupsAfterFirst);
      // An unsigned request reusing a handled id still gets 401, not "duplicate".
      expect((await send(signWebhookBody(oauth.webhook.body, "attacker"))).status).toBe(401);
    });

    it("rejects oversized bodies", async () => {
      const body = JSON.stringify({ myshopify_domain: SHOP, pad: "x".repeat(300 * 1024) });
      const res = await handleShopifyWebhook(
        {
          rawBody: body,
          headers: headers("app/uninstalled", signWebhookBody(body, PUBLIC_SECRET)),
        },
        { client, lookup: lookup() },
      );
      expect(res.status).toBe(413);
    });
  });
});
