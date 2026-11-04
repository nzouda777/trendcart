import "server-only";

import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { decrypt, decryptNullable } from "@/lib/crypto";
import type {
  Integrations,
  ShopifyAppCredentials,
  ShopifyCredentials,
  TikTokAdsCredentials,
} from "@/lib/domain/contracts";
import { shopifyConnection, tiktokAdConnection, tiktokProfileConnection } from "@/lib/db/schema";
import { getIntegrations } from "@/lib/integrations";
import type { ShopifyAdapter } from "@/lib/integrations/shopify";
import { appCredentialsFor, loadShopifyCredentials } from "@/lib/integrations/shopify/credentials";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { CONNECTION_TARGET_TYPE, connectionAad } from "../connections";
import { ServiceError } from "../errors";
import type { ConnectionKind } from "../types";

/*
 * Internal helpers for workflow steps and integration routes: decrypt the
 * credentials of a connection in the context's workspace. They do NOT check
 * roles (workflow steps run as system actors); the service that started the
 * work did. Never return their results to a client.
 */

/**
 * Connection statuses whose token still works: "expiring" only prompts a
 * reconnect soon (same rule as Shopify stores), so services that accept it
 * up front can also load its credentials.
 */
export const USABLE_CONNECTION_STATUSES: ReadonlySet<string> = new Set(["active", "expiring"]);

function inactive(kind: string): never {
  throw new ServiceError(
    "precondition_failed",
    `The ${kind} connection is not active. Reconnect it.`,
  );
}

/** The registry's Shopify client is a ShopifyAdapter (it can refresh tokens). */
function isShopifyAdapter(client: unknown): client is ShopifyAdapter {
  return typeof (client as Partial<ShopifyAdapter> | null)?.refreshAccessToken === "function";
}

function defaultShopifyAdapter(): ShopifyAdapter {
  const client = getIntegrations().shopify;
  if (!isShopifyAdapter(client)) {
    throw new Error("The registry's Shopify client cannot refresh tokens.");
  }
  return client;
}

/**
 * Shopify credentials for steps. Delegates to loadShopifyCredentials
 * (lib/integrations/shopify/credentials), the single owner of the encrypted
 * token bundle: it refreshes expiring offline tokens, persists the new
 * bundle, and marks the connection needs_reauth when the refresh fails.
 */
export async function getShopifyCredentials(
  ctx: WorkspaceContext,
  connectionId: string,
  deps: { client?: ShopifyAdapter; now?: () => number } = {},
): Promise<{
  creds: ShopifyCredentials;
  app?: ShopifyAppCredentials;
  templateSuffix: string | null;
}> {
  const client = deps.client ?? defaultShopifyAdapter();
  const creds = await loadShopifyCredentials(ctx, connectionId, { client, now: deps.now });
  const row = await ctx.db.getById(shopifyConnection, connectionId);
  const app = appCredentialsFor(row);
  return { creds, ...(app ? { app } : {}), templateSuffix: row.templateSuffix };
}

/**
 * Same, using the Shopify adapter of the given integrations (so services and
 * steps called with injected integrations refresh tokens through them).
 */
export async function getShopifyCredentialsFor(
  ctx: WorkspaceContext,
  integrations: Integrations,
  connectionId: string,
  deps: { now?: () => number } = {},
) {
  const client = isShopifyAdapter(integrations.shopify) ? integrations.shopify : undefined;
  return getShopifyCredentials(ctx, connectionId, { ...(client ? { client } : {}), ...deps });
}

export async function getTikTokAdsCredentials(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<TikTokAdsCredentials> {
  const row = await ctx.db.getById(tiktokAdConnection, connectionId);
  if (!USABLE_CONNECTION_STATUSES.has(row.status) || !row.accessTokenEnc) inactive("TikTok Ads");
  return {
    advertiserId: row.advertiserId,
    accessToken: decrypt(row.accessTokenEnc, { aad: connectionAad.tiktokAdsAccessToken(row.id) }),
  };
}

export async function getTikTokProfileTokens(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<{
  openId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}> {
  const row = await ctx.db.getById(tiktokProfileConnection, connectionId);
  if (!USABLE_CONNECTION_STATUSES.has(row.status) || !row.accessTokenEnc) {
    inactive("TikTok profile");
  }
  return {
    openId: row.openId,
    accessToken: decrypt(row.accessTokenEnc, {
      aad: connectionAad.tiktokProfileAccessToken(row.id),
    }),
    refreshToken: decryptNullable(row.refreshTokenEnc, {
      aad: connectionAad.tiktokProfileRefreshToken(row.id),
    }),
    expiresAt: row.expiresAt,
  };
}

/** Called when an adapter throws IntegrationError("auth_expired"): shows the connection red. */
export async function markConnectionNeedsReauth(
  ctx: WorkspaceContext,
  kind: ConnectionKind,
  connectionId: string,
  reason: string,
): Promise<void> {
  const table =
    kind === "shopify"
      ? shopifyConnection
      : kind === "tiktok_ads"
        ? tiktokAdConnection
        : tiktokProfileConnection;
  await ctx.db.transaction(async (tx) => {
    const updated = await tx.update(table, { status: "needs_reauth" }, eq(table.id, connectionId));
    if (updated.length === 0) return;
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "connection.update",
        targetType: CONNECTION_TARGET_TYPE[kind],
        targetId: connectionId,
        metadata: { status: "needs_reauth", reason: reason.slice(0, 200) },
      },
    );
  });
}
