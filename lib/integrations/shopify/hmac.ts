/**
 * Shopify signature checks (pure, no env).
 *
 * - OAuth callback / app proxy query: remove `hmac` (and legacy `signature`),
 *   sort the rest by key, join `key=value` with `&` using decoded values,
 *   HMAC-SHA256 with the client secret, hex digest.
 * - Webhooks: HMAC-SHA256 of the RAW request body with the client secret,
 *   base64 digest, sent in X-Shopify-Hmac-Sha256.
 *
 * Every comparison is constant time over fixed-length digests.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { shopDomainSchema } from "@/lib/domain/contracts";

/** Builds the message Shopify signs for an OAuth query. Exported for tests. */
export function oauthHmacMessage(query: Record<string, string>): string {
  return Object.keys(query)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join("&");
}

export function signOAuthQuery(query: Record<string, string>, secret: string): string {
  return createHmac("sha256", secret).update(oauthHmacMessage(query)).digest("hex");
}

/** Constant-time compare of two digests in the same encoding. */
function safeEqual(expected: Buffer, actual: Buffer): boolean {
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function verifyOAuthQuery(query: Record<string, string>, secret: string): boolean {
  const provided = query.hmac;
  if (!secret || typeof provided !== "string" || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = Buffer.from(signOAuthQuery(query, secret), "hex");
  return safeEqual(expected, Buffer.from(provided, "hex"));
}

export function signWebhookBody(rawBody: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

export function verifyWebhookBody(
  rawBody: string | Buffer,
  hmacHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!secret || !hmacHeader) return false;
  const header = hmacHeader.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return safeEqual(expected, Buffer.from(header, "base64"));
}

/**
 * Normalizes a merchant-typed shop ("Acme", "acme.myshopify.com",
 * "https://acme.myshopify.com/admin") to `acme.myshopify.com`, or null.
 */
export function normalizeShopDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? "";
  if (value && !value.includes(".")) value = `${value}.myshopify.com`;
  return shopDomainSchema.safeParse(value).success ? value : null;
}

/** Strict check for a shop value Shopify sent us (no normalization). */
export function isValidShopDomain(value: string | null | undefined): value is string {
  return typeof value === "string" && shopDomainSchema.safeParse(value).success;
}
