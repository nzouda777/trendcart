import "server-only";

import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { shopifyConnection } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { appCredentialsFor, clearedTokenColumns } from "./credentials";
import { isValidShopDomain } from "./hmac";
import type { ShopifyAdapter } from "./types";

/*
 * Shopify webhooks: app/uninstalled + the mandatory compliance topics
 * (customers/data_request, customers/redact, shop/redact).
 *
 * Every delivery is HMAC-verified on the raw body before anything else;
 * invalid signatures get 401 (required by Shopify for compliance topics).
 * The public app secret is tried first (no I/O). Only if it fails do we try
 * custom-app secrets, and only for a request that already looks like a real
 * delivery: well-formed 32-byte signature, a topic we handle, a webhook id,
 * and a body shop (myshopify_domain / shop_domain, when present) equal to the
 * X-Shopify-Shop-Domain header. At most MAX_CUSTOM_CANDIDATES secrets are
 * decrypted per request.
 *
 * Deliveries are deduped on X-Shopify-Webhook-Id after successful handling,
 * in memory per instance (best effort: every handler is idempotent anyway,
 * so a cross-instance store like Upstash is not needed for correctness).
 */

/** Max custom-app secrets decrypted and tried for one unverified request. */
export const MAX_CUSTOM_CANDIDATES = 3;
/** Shopify webhook payloads for our topics are tiny; refuse anything big. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_MAX = 5000;

/** In-memory, per-instance set of handled webhook ids (insertion-ordered for eviction). */
export function createWebhookDeduper(now: () => number = Date.now) {
  const seen = new Map<string, number>();
  return {
    has(id: string): boolean {
      const at = seen.get(id);
      if (at === undefined) return false;
      if (now() - at > DEDUPE_TTL_MS) {
        seen.delete(id);
        return false;
      }
      return true;
    },
    add(id: string): void {
      seen.delete(id);
      seen.set(id, now());
      while (seen.size > DEDUPE_MAX) {
        const oldest = seen.keys().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
    },
  };
}
export type WebhookDeduper = ReturnType<typeof createWebhookDeduper>;

const defaultDeduper = createWebhookDeduper();

/** Shop named inside the payload, if any (app/uninstalled: myshopify_domain; compliance: shop_domain). */
export function bodyShopDomain(rawBody: string): string | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null; // not JSON: never a valid delivery for our topics
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const value = record.myshopify_domain ?? record.shop_domain;
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

const SIGNATURE = /^[A-Za-z0-9+/]{43}=$/; // base64 of a 32-byte SHA-256 digest

export const SHOPIFY_WEBHOOK_TOPICS = [
  "app/uninstalled",
  "customers/data_request",
  "customers/redact",
  "shop/redact",
] as const;

export type ShopConnectionRef = { workspaceId: string; connectionId: string };

/**
 * Cross-workspace lookup a webhook needs (no session). Must come from the
 * foundation layer: lib/tenant has no such helper yet, see the M1 report.
 */
export type ShopifyWebhookLookup = {
  findConnectionsByShop(shopDomain: string): Promise<ShopConnectionRef[]>;
  /** createSystemContext(db, { workspaceId, name: "webhook:shopify" }). */
  systemContext(workspaceId: string): WorkspaceContext;
};

export type ShopifyWebhookDeps = {
  client: ShopifyAdapter;
  lookup?: ShopifyWebhookLookup;
  /** Defaults to a module-level in-memory deduper. */
  deduper?: WebhookDeduper;
};

export type WebhookResult = { status: number; body: string };

const ok = (body = "ok"): WebhookResult => ({ status: 200, body });

type Target = { ctx: WorkspaceContext; connectionId: string };

export async function handleShopifyWebhook(
  input: { rawBody: string; headers: Headers },
  deps: ShopifyWebhookDeps,
): Promise<WebhookResult> {
  const hmac = input.headers.get("x-shopify-hmac-sha256")?.trim();
  const topic = input.headers.get("x-shopify-topic") ?? "";
  const shop = input.headers.get("x-shopify-shop-domain");
  const webhookId = input.headers.get("x-shopify-webhook-id")?.trim() || null;
  const deduper = deps.deduper ?? defaultDeduper;

  if (!hmac || !SIGNATURE.test(hmac)) return { status: 401, body: "invalid signature" };
  if (Buffer.byteLength(input.rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return { status: 413, body: "payload too large" };
  }

  // 1. Public app secret first: pure HMAC, no I/O.
  const publicOk = deps.client.verifyWebhook({ rawBody: input.rawBody, hmacHeader: hmac });

  // 2. Custom-app secrets only for requests that look like a real delivery.
  const bodyShop = bodyShopDomain(input.rawBody);
  const shopsAgree = bodyShop === undefined || bodyShop === shop;
  let matched: Target[] | null = null;
  if (!publicOk) {
    const plausible =
      isValidShopDomain(shop) &&
      (SHOPIFY_WEBHOOK_TOPICS as readonly string[]).includes(topic) &&
      webhookId !== null &&
      bodyShop !== null &&
      shopsAgree;
    if (!plausible || !deps.lookup) return { status: 401, body: "invalid signature" };
    matched = await verifyCustomCandidates(deps.lookup, shop, input.rawBody, hmac, deps.client);
    if (matched.length === 0) return { status: 401, body: "invalid signature" };
  }

  // Authentic from here on.
  if (!isValidShopDomain(shop)) return { status: 400, body: "invalid shop" };
  if (!shopsAgree) return { status: 400, body: "shop mismatch" };
  if (webhookId && deduper.has(webhookId)) return ok("duplicate");

  const result = await dispatch(topic, shop, matched, deps);
  if (webhookId && result.status === 200) deduper.add(webhookId);
  return result;
}

/** Custom-mode connections of `shop` whose own secret signed the body (at most MAX_CUSTOM_CANDIDATES tried). */
async function verifyCustomCandidates(
  lookup: ShopifyWebhookLookup,
  shop: string,
  rawBody: string,
  hmac: string,
  client: ShopifyAdapter,
): Promise<Target[]> {
  const refs = await lookup.findConnectionsByShop(shop);
  const hits: Target[] = [];
  let tried = 0;
  for (const ref of refs) {
    if (tried >= MAX_CUSTOM_CANDIDATES) break;
    const ctx = lookup.systemContext(ref.workspaceId);
    const row = await ctx.db.findById(shopifyConnection, ref.connectionId);
    if (!row || row.appMode !== "custom" || !row.clientSecretEnc || !row.clientId) continue;
    tried++;
    let app;
    try {
      app = appCredentialsFor(row);
    } catch {
      continue;
    }
    if (client.verifyWebhook({ rawBody, hmacHeader: hmac, app })) {
      hits.push({ ctx, connectionId: ref.connectionId });
    }
  }
  return hits;
}

async function dispatch(
  topic: string,
  shop: string,
  matched: Target[] | null,
  deps: ShopifyWebhookDeps,
): Promise<WebhookResult> {
  switch (topic) {
    case "customers/data_request":
    case "customers/redact":
      // Trendcart never requests customer or order scopes and stores no
      // customer data: nothing to export or erase. Acknowledge.
      return ok();
    case "app/uninstalled":
    case "shop/redact": {
      let targets = matched;
      if (!targets) {
        if (!deps.lookup) {
          // Not wired: let Shopify retry rather than drop the event.
          return { status: 503, body: "webhook store unavailable" };
        }
        // Signed by the public app: only public-mode connections are affected.
        targets = [];
        for (const ref of await deps.lookup.findConnectionsByShop(shop)) {
          const ctx = deps.lookup.systemContext(ref.workspaceId);
          const row = await ctx.db.findById(shopifyConnection, ref.connectionId);
          if (row && row.appMode === "public")
            targets.push({ ctx, connectionId: ref.connectionId });
        }
      }
      for (const target of targets) {
        await revokeConnection(target, topic === "shop/redact");
      }
      return ok();
    }
    default:
      // Unknown or unsubscribed topic: acknowledge so Shopify stops retrying.
      return ok("ignored");
  }
}

/**
 * app/uninstalled: the token is dead, mark the connection disconnected
 * ("revoked") and drop it. shop/redact (48 h after uninstall): also drop the
 * custom app secret. Idempotent.
 */
async function revokeConnection(target: Target, redact: boolean): Promise<void> {
  const { ctx, connectionId } = target;
  const row = await ctx.db.findById(shopifyConnection, connectionId);
  if (!row) return;
  const alreadyRevoked =
    row.status === "disconnected" &&
    row.accessTokenEnc === null &&
    (!redact || !row.clientSecretEnc);
  if (alreadyRevoked) return;

  await ctx.db.transaction(async (tx) => {
    await tx.update(
      shopifyConnection,
      {
        status: "disconnected",
        ...clearedTokenColumns,
        scopes: [],
        ...(redact ? { clientSecretEnc: null } : {}),
      },
      eq(shopifyConnection.id, connectionId),
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "connection.update",
        targetType: "shopify_connection",
        targetId: connectionId,
        metadata: {
          provider: "shopify",
          shopDomain: row.shopDomain,
          change: redact ? "shop_redact" : "app_uninstalled",
          status: "disconnected",
        },
      },
    );
  });
}
