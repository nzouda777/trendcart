import "server-only";

import { eq } from "drizzle-orm";

import { aadFor, decrypt, encrypt } from "@/lib/crypto";
import { shopifyConnection } from "@/lib/db/schema";
import {
  IntegrationError,
  type ShopifyAppCredentials,
  type ShopifyCredentials,
} from "@/lib/domain/contracts";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";

import { TOKEN_REFRESH_MARGIN_MS } from "./config";
import { shopifyError } from "./errors";
import { parseTokenBundle } from "./token-bundle";
import type { ShopifyAdapter, ShopifyInstallToken } from "./types";

/*
 * The one place that turns a shopify_connection row into usable credentials.
 * Services and workflow steps call `loadShopifyCredentials(ctx, connectionId)`
 * and pass the result to the ShopifyClient. Expiring offline tokens are
 * refreshed here (and persisted) when they have < 5 minutes left.
 *
 * Storage (migration 0001): access_token_enc holds the bare access token,
 * refresh_token_enc the refresh token, token_expires_at /
 * refresh_token_expires_at the expiries. Legacy M1 rows have those columns
 * null and an encrypted JSON bundle in access_token_enc (./token-bundle);
 * they are still read, and rewritten in the new format on their first refresh.
 *
 * Internal plumbing: callers check the role/permission for the action they
 * perform; never return these credentials to a client.
 */

export type ShopifyConnectionRow = Row<typeof shopifyConnection>;

export const tokenAad = (connectionId: string) =>
  aadFor("shopify_connection", connectionId, "access_token");
export const refreshTokenAad = (connectionId: string) =>
  aadFor("shopify_connection", connectionId, "refresh_token");
export const clientSecretAad = (connectionId: string) =>
  aadFor("shopify_connection", connectionId, "client_secret");

/** Column values that store a token for this connection (install and refresh). */
export function tokenColumns(connectionId: string, token: ShopifyInstallToken) {
  return {
    accessTokenEnc: encrypt(token.accessToken, { aad: tokenAad(connectionId) }),
    refreshTokenEnc: token.refreshToken
      ? encrypt(token.refreshToken, { aad: refreshTokenAad(connectionId) })
      : null,
    tokenExpiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt
      ? new Date(token.refreshTokenExpiresAt)
      : null,
  };
}

/** Column values that drop every stored token (uninstall, disconnect). */
export const clearedTokenColumns = {
  accessTokenEnc: null,
  refreshTokenEnc: null,
  tokenExpiresAt: null,
  refreshTokenExpiresAt: null,
} as const;

type StoredToken = { accessToken: string; refreshToken: string | null; expiresAt: number | null };

/** Decrypts the stored token, from the dedicated columns or a legacy bundle. */
export function readStoredToken(row: ShopifyConnectionRow): StoredToken {
  const access = decrypt(row.accessTokenEnc!, { aad: tokenAad(row.id) });
  if (row.refreshTokenEnc !== null || row.tokenExpiresAt !== null) {
    return {
      accessToken: access,
      refreshToken: row.refreshTokenEnc
        ? decrypt(row.refreshTokenEnc, { aad: refreshTokenAad(row.id) })
        : null,
      expiresAt: row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : null,
    };
  }
  const bundle = parseTokenBundle(access);
  return {
    accessToken: bundle.accessToken,
    refreshToken: bundle.refreshToken,
    expiresAt: bundle.expiresAt ? Date.parse(bundle.expiresAt) : null,
  };
}

/** Per-store app credentials for app_mode "custom"; undefined for the public app. */
export function appCredentialsFor(row: ShopifyConnectionRow): ShopifyAppCredentials | undefined {
  if (row.appMode !== "custom") return undefined;
  if (!row.clientId || !row.clientSecretEnc) {
    throw shopifyError("permission_denied", "Custom app credentials are missing for this store.", {
      retryable: false,
    });
  }
  return {
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecretEnc, { aad: clientSecretAad(row.id) }),
  };
}

/** Connection statuses whose token may be used. */
export const USABLE_STATUSES: ReadonlySet<ShopifyConnectionRow["status"]> = new Set([
  "active",
  "expiring",
]);

export async function loadShopifyCredentials(
  ctx: WorkspaceContext,
  connectionId: string,
  deps: { client: ShopifyAdapter; now?: () => number },
): Promise<ShopifyCredentials> {
  const now = deps.now ?? Date.now;
  const row = await ctx.db.getById(shopifyConnection, connectionId);
  // "expiring" still works (it only prompts a reconnect soon); pending,
  // needs_reauth, revoked and disconnected have no usable token.
  if (!USABLE_STATUSES.has(row.status) || !row.accessTokenEnc) {
    throw shopifyError("auth_expired", "This Shopify store needs to be reconnected.", {
      retryable: false,
    });
  }

  const stored = readStoredToken(row);
  if (stored.expiresAt === null || stored.expiresAt - now() > TOKEN_REFRESH_MARGIN_MS) {
    return { shopDomain: row.shopDomain, accessToken: stored.accessToken };
  }

  const markNeedsReauth = () =>
    ctx.db.update(shopifyConnection, { status: "needs_reauth" }, eq(shopifyConnection.id, row.id));

  if (!stored.refreshToken) {
    await markNeedsReauth();
    throw shopifyError("auth_expired", "Shopify token expired; reconnect the store.", {
      retryable: false,
    });
  }

  try {
    const token = await deps.client.refreshAccessToken({
      shopDomain: row.shopDomain,
      refreshToken: stored.refreshToken,
      app: appCredentialsFor(row),
    });
    await ctx.db.update(
      shopifyConnection,
      {
        ...tokenColumns(row.id, token),
        scopes: token.scopes.length > 0 ? token.scopes : row.scopes,
      },
      eq(shopifyConnection.id, row.id),
    );
    return { shopDomain: row.shopDomain, accessToken: token.accessToken };
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "auth_expired") {
      await markNeedsReauth();
    }
    throw error;
  }
}
