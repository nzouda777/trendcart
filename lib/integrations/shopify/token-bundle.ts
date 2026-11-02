/**
 * What `shopify_connection.access_token_enc` holds once decrypted.
 *
 * Expiring offline tokens come with a refresh token and expiry times, and the
 * table has a single encrypted token column. Until dedicated columns exist
 * (refresh_token_enc, token_expires_at: requested from foundation), the
 * plaintext is a small versioned JSON bundle. A bare token string (legacy or
 * non-expiring custom-app tokens) is still accepted on read.
 *
 * Never decrypt this column yourself: use `loadShopifyCredentials()`
 * (./credentials), which also refreshes expiring tokens.
 */
import { z } from "zod";

import type { ShopifyInstallToken } from "./types";

const bundleSchema = z.object({
  v: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  refreshTokenExpiresAt: z.iso.datetime().nullable(),
});
export type ShopifyTokenBundle = z.infer<typeof bundleSchema>;

export function serializeTokenBundle(token: ShopifyInstallToken): string {
  const bundle: ShopifyTokenBundle = {
    v: 1,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
  };
  return JSON.stringify(bundle);
}

export function parseTokenBundle(plaintext: string): ShopifyTokenBundle {
  const value = plaintext.trim();
  if (!value.startsWith("{")) {
    return {
      v: 1,
      accessToken: value,
      refreshToken: null,
      expiresAt: null,
      refreshTokenExpiresAt: null,
    };
  }
  return bundleSchema.parse(JSON.parse(value));
}

/** True when the access token expires within `marginMs` (never for non-expiring tokens). */
export function bundleNeedsRefresh(
  bundle: ShopifyTokenBundle,
  now: number,
  marginMs: number,
): boolean {
  if (!bundle.expiresAt) return false;
  return Date.parse(bundle.expiresAt) - now <= marginMs;
}
