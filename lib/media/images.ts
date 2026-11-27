/**
 * Uploaded images (image search, product photos): limits, type detection and
 * signed URLs. Pure apart from `imageUrlSecret()` reading the env.
 *
 * Trendcart keeps no files: an uploaded image waits in `pending_image` until
 * it reaches Shopify, then its row is deleted. While it waits, a signed,
 * expiring URL lets outside services fetch it (SerpApi's reverse image search,
 * the AI analyzer through the brand proxy) without a session.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { siteConfig } from "@/config/site";

/**
 * Largest image accepted. Vercel caps a function request body at 4.5 MB, and
 * the upload goes through a server action, so stay under it.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Product photos waiting for Shopify, per product. */
export const MAX_PENDING_GALLERY_IMAGES = 10;
/** Images per upload request. */
export const MAX_IMAGES_PER_UPLOAD = 5;
/** Pending images older than this are purged by the cron (product never reached Shopify). */
export const PENDING_IMAGE_TTL_DAYS = 14;
/** Signed image URLs stay valid this long (sourcing can run days after the import). */
export const SIGNED_IMAGE_URL_TTL_SEC = PENDING_IMAGE_TTL_DAYS * 24 * 60 * 60;

export const IMAGE_ROUTE_PREFIX = "/api/images/";

export type ImageType = { mimeType: string; extension: string };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/**
 * The image type from the file's magic bytes (never from the client's
 * declared type or file name). JPEG, PNG, WebP and GIF only: what Shopify and
 * the AI providers accept. Null for anything else.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", extension: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { mimeType: "image/gif", extension: "gif" };
  return null;
}

export const extensionForMime = (mimeType: string): string =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[
    mimeType
  ] ?? "jpg";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* ------------------------------- Signed URLs ------------------------------ */

/** HMAC key for image URLs, derived from BETTER_AUTH_SECRET (never used raw). */
export function imageUrlSecret(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.BETTER_AUTH_SECRET?.trim();
  if (!base) throw new Error("BETTER_AUTH_SECRET is not set (needed to sign image URLs).");
  return createHmac("sha256", base).update("trendcart:image-url:v1").digest("hex");
}

function signature(id: string, expires: number, secret: string): string {
  return createHmac("sha256", secret).update(`${id}.${expires}`).digest("base64url");
}

/** Absolute, expiring URL that serves one pending image without a session. */
export function signedImageUrl(
  input: { origin: string; imageId: string },
  options: { secret?: string; now?: number; ttlSec?: number } = {},
): string {
  const now = options.now ?? Date.now();
  const expires = Math.floor(now / 1000) + (options.ttlSec ?? SIGNED_IMAGE_URL_TTL_SEC);
  const secret = options.secret ?? imageUrlSecret();
  const url = new URL(
    `${IMAGE_ROUTE_PREFIX}${encodeURIComponent(input.imageId)}`,
    input.origin.replace(/\/+$/, ""),
  );
  url.searchParams.set("exp", String(expires));
  url.searchParams.set("sig", signature(input.imageId, expires, secret));
  return url.toString();
}

/** Signed URL of a pending image on this deployment (NEXT_PUBLIC_SITE_URL). */
export const publicImageUrl = (imageId: string) =>
  signedImageUrl({ origin: siteConfig.url, imageId });

/** Whether `sig` signs (id, exp) and has not expired. Constant-time compare. */
export function verifyImageSignature(
  input: { imageId: string; exp: string | null; sig: string | null },
  options: { secret?: string; now?: number } = {},
): boolean {
  const { imageId, exp, sig } = input;
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const expires = Number(exp);
  if (expires * 1000 <= (options.now ?? Date.now())) return false;
  const expected = Buffer.from(signature(imageId, expires, options.secret ?? imageUrlSecret()));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Whether a URL points at our own pending-image route (it vanishes once the image is on Shopify). */
export function isPendingImageUrl(url: string | null | undefined, origin?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith(IMAGE_ROUTE_PREFIX)) return false;
    return origin ? parsed.origin === new URL(origin).origin : parsed.searchParams.has("sig");
  } catch {
    return false;
  }
}

/** Source URL stored on a product imported from an uploaded image (dedupes re-uploads). */
export const uploadSourceUrl = (sha256: string) => `upload:image:${sha256}`;
export const isUploadSourceUrl = (url: string) => url.startsWith("upload:image:");
