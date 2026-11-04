import { z } from "zod";

import {
  shopDomainSchema,
  shopifyTokenSchema,
  type ShopifyAppCredentials,
  type ShopifyClient,
  type ShopifyCredentials,
  type ShopifyMediaRef,
  type ShopifyToken,
} from "@/lib/domain/contracts";

/**
 * Shopify now issues EXPIRING offline tokens to public apps (1 h access token
 * + 90-day rotating refresh token; required for new public apps, and for all
 * public apps from 2027-01-01). The contract's ShopifyToken only carries the
 * access token, so the adapter returns this superset.
 */
export const shopifyInstallTokenSchema = shopifyTokenSchema.extend({
  refreshToken: z.string().min(1).nullable(),
  /** ISO time the access token expires; null for non-expiring tokens. */
  expiresAt: z.iso.datetime().nullable(),
  refreshTokenExpiresAt: z.iso.datetime().nullable(),
});
export type ShopifyInstallToken = z.infer<typeof shopifyInstallTokenSchema>;

/**
 * attachVideoFromUrl input: the contract's fields plus two optional ones the
 * contract does not carry yet (reported for lib/domain/contracts.ts):
 * - `idempotencyKey`: the Trendcart video id. A re-run with the same key never
 *   adds a second Shopify video. Without it the key is the source URL's origin
 *   and path, which changes when the provider re-signs the URL.
 * - `proxyUrl`: decrypted brand proxy for the source download (else the
 *   SSRF-guarded direct agent).
 */
export type AttachVideoInput = {
  productId: string;
  sourceUrl: string;
  alt?: string;
  idempotencyKey?: string;
  proxyUrl?: string;
};

/** ShopifyClient plus the token-lifecycle methods the contract does not cover yet. */
export interface ShopifyAdapter extends ShopifyClient {
  readonly mode: "mock" | "live";
  attachVideoFromUrl(creds: ShopifyCredentials, input: AttachVideoInput): Promise<ShopifyMediaRef>;
  completeInstall(input: {
    query: Record<string, string>;
    expectedState: string;
    app?: ShopifyAppCredentials;
  }): Promise<ShopifyInstallToken>;
  /** Exchanges a refresh token for a new access + refresh token pair. */
  refreshAccessToken(input: {
    shopDomain: string;
    refreshToken: string;
    app?: ShopifyAppCredentials;
  }): Promise<ShopifyInstallToken>;
}

export type { ShopifyToken };

/** Shopify's token endpoint response (authorization code and refresh grants). */
export const shopifyTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().default(""),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

export function tokenFromResponse(
  shopDomain: string,
  raw: unknown,
  now: number = Date.now(),
): ShopifyInstallToken {
  const r = shopifyTokenResponseSchema.parse(raw);
  return shopifyInstallTokenSchema.parse({
    shopDomain: shopDomainSchema.parse(shopDomain),
    accessToken: r.access_token,
    scopes: r.scope
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    refreshToken: r.refresh_token ?? null,
    expiresAt: r.expires_in ? new Date(now + r.expires_in * 1000).toISOString() : null,
    refreshTokenExpiresAt: r.refresh_token_expires_in
      ? new Date(now + r.refresh_token_expires_in * 1000).toISOString()
      : null,
  });
}

/** Granted scopes cover the required ones (write_x implies read_x). */
export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const set = new Set(granted);
  return required.filter((scope) => {
    if (set.has(scope)) return false;
    if (scope.startsWith("read_") && set.has(`write_${scope.slice(5)}`)) return false;
    return true;
  });
}
