import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import { pendingImage, product, shopifyProduct } from "@/lib/db/schema";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_UPLOAD,
  MAX_PENDING_GALLERY_IMAGES,
  sha256Hex,
  sniffImageType,
} from "@/lib/media/images";
import { actorUserId, type WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";
import { loadSupplierChoice } from "@/lib/workflows/gate-payloads";

import { idSchema } from "./brands";
import { resolveIntegrations, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import { getShopifyCredentialsFor } from "./internal/credentials";

/*
 * Images users upload: the photo of an image search, and product photos for
 * the Shopify page. Trendcart stores no files, so an image only waits in
 * `pending_image` until it is on the Shopify product, then its row is deleted:
 * - uploaded before the Shopify draft exists: pushed by the build step right
 *   after the draft is created (lib/workflows/pending-images);
 * - uploaded once the draft exists: sent to Shopify straight away and never
 *   stored.
 * Rows of products that never reach Shopify are purged by the cron after
 * PENDING_IMAGE_TTL_DAYS (and cascade when the product is deleted).
 */

export type PendingImageDTO = {
  id: string;
  purpose: "search" | "gallery";
  mimeType: string;
  byteSize: number;
  createdAt: string;
  /** Session-checked preview URL (same origin). */
  previewUrl: string;
};

export type UploadImagesResult = {
  /** Images sent to the Shopify product right away (the draft already exists). */
  sentToShopify: number;
  /** Images held until the Shopify draft is created. */
  pending: number;
  /** Images skipped because they were already uploaded for this product. */
  duplicates: number;
};

export type ValidImage = { bytes: Uint8Array; mimeType: string; sha256: string };

/** Checks size and real type (magic bytes). Throws ServiceError invalid_input. */
export function validateImage(bytes: Uint8Array, label = "The image"): ValidImage {
  if (bytes.byteLength === 0) throw new ServiceError("invalid_input", `${label} is empty.`);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ServiceError(
      "invalid_input",
      `${label} is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
    );
  }
  const type = sniffImageType(bytes);
  if (!type) {
    throw new ServiceError("invalid_input", `${label} must be a JPEG, PNG, WebP or GIF image.`);
  }
  return { bytes, mimeType: type.mimeType, sha256: sha256Hex(bytes) };
}

const toDTO = (row: Row<typeof pendingImage>): PendingImageDTO => ({
  id: row.id,
  purpose: row.purpose,
  mimeType: row.mimeType,
  byteSize: row.byteSize,
  createdAt: row.createdAt.toISOString(),
  previewUrl: `/api/images/${encodeURIComponent(row.id)}`,
});

/** Stores an image-search photo for a product (called by importFromImage, same request). */
export async function storeSearchImage(
  ctx: WorkspaceContext,
  productId: string,
  image: ValidImage,
): Promise<Row<typeof pendingImage>> {
  return ctx.db.upsert(
    pendingImage,
    {
      productId,
      purpose: "search",
      mimeType: image.mimeType,
      byteSize: image.bytes.byteLength,
      sha256: image.sha256,
      dataBase64: Buffer.from(image.bytes).toString("base64"),
      createdByUserId: actorUserId(ctx),
    },
    { target: (t) => [t.productId, t.purpose, t.sha256], set: { productId } },
  );
}

/** The Shopify draft the page builds on (store chosen at GATE 2), when it exists. */
async function targetShopifyProduct(
  ctx: WorkspaceContext,
  productId: string,
): Promise<Row<typeof shopifyProduct> | null> {
  const choice = await loadSupplierChoice(ctx.db, productId);
  if (!choice) return null;
  const page = await ctx.db.findFirst(
    shopifyProduct,
    and(
      eq(shopifyProduct.productId, productId),
      eq(shopifyProduct.connectionId, choice.shopifyConnectionId),
    ),
  );
  return page?.shopifyProductId ? page : null;
}

const uploadSchema = z.object({
  productId: idSchema,
  files: z
    .array(z.instanceof(Uint8Array))
    .min(1, "Choose at least one image.")
    .max(MAX_IMAGES_PER_UPLOAD, `Upload at most ${MAX_IMAGES_PER_UPLOAD} images at a time.`),
});

/**
 * Adds product photos (role: product:update). Sent to the Shopify draft right
 * away when it exists, else held until the build step creates it.
 */
export async function uploadProductImages(
  ctx: WorkspaceContext,
  input: z.input<typeof uploadSchema>,
  deps: ServiceDeps = {},
): Promise<UploadImagesResult> {
  requirePermission(ctx, "product:update");
  const v = uploadSchema.parse(input);
  const row = await ctx.db.getById(product, v.productId);
  const images = v.files.map((bytes, i) => validateImage(bytes, `Image ${i + 1}`));
  const unique = [...new Map(images.map((img) => [img.sha256, img])).values()];

  const page = await targetShopifyProduct(ctx, row.id);
  if (page) {
    const integrations = resolveIntegrations(deps);
    const { creds } = await getShopifyCredentialsFor(ctx, integrations, page.connectionId);
    for (const image of unique) {
      await integrations.shopify.attachImage(creds, {
        productId: page.shopifyProductId!,
        data: image.bytes,
        mimeType: image.mimeType,
        idempotencyKey: image.sha256,
        ...(row.name ? { alt: row.name } : {}),
      });
    }
    await writeAudit(ctx, {
      action: "page.media_upload",
      targetType: "product",
      targetId: row.id,
      metadata: { shopifyProductId: page.shopifyProductId, images: unique.length },
    });
    return { sentToShopify: unique.length, pending: 0, duplicates: images.length - unique.length };
  }

  const existing = await ctx.db.select(pendingImage, {
    where: and(eq(pendingImage.productId, row.id), eq(pendingImage.purpose, "gallery")),
  });
  const known = new Set(existing.map((e) => e.sha256));
  const fresh = unique.filter((img) => !known.has(img.sha256));
  if (existing.length + fresh.length > MAX_PENDING_GALLERY_IMAGES) {
    throw new ServiceError(
      "invalid_input",
      `A product can hold at most ${MAX_PENDING_GALLERY_IMAGES} photos before its Shopify page is created.`,
    );
  }
  for (const [i, image] of fresh.entries()) {
    await ctx.db.insert(pendingImage, {
      productId: row.id,
      purpose: "gallery",
      mimeType: image.mimeType,
      byteSize: image.bytes.byteLength,
      sha256: image.sha256,
      dataBase64: Buffer.from(image.bytes).toString("base64"),
      position: existing.length + i,
      createdByUserId: actorUserId(ctx),
    });
  }
  return {
    sentToShopify: 0,
    pending: fresh.length,
    duplicates: images.length - fresh.length,
  };
}

/** Images of a product still waiting for Shopify (metadata only). */
export async function listPendingImages(
  ctx: WorkspaceContext,
  productId: string,
): Promise<PendingImageDTO[]> {
  requirePermission(ctx, "product:read");
  const id = idSchema.parse(productId);
  const rows = await ctx.db.select(pendingImage, {
    where: eq(pendingImage.productId, id),
    orderBy: (t) => [asc(t.purpose), asc(t.position), asc(t.createdAt)],
  });
  return rows.map(toDTO);
}

const deleteSchema = z.object({ productId: idSchema, imageId: idSchema });

/** Removes a waiting product photo before it reaches Shopify (role: product:update). */
export async function deletePendingImage(
  ctx: WorkspaceContext,
  input: z.input<typeof deleteSchema>,
): Promise<void> {
  requirePermission(ctx, "product:update");
  const v = deleteSchema.parse(input);
  const row = await ctx.db.getById(pendingImage, v.imageId);
  if (row.productId !== v.productId || row.purpose !== "gallery") {
    throw new ServiceError("invalid_input", "This image cannot be removed.");
  }
  await ctx.db.delete(pendingImage, eq(pendingImage.id, row.id));
}

/** Bytes of a pending image for the session-checked preview route. */
export async function readPendingImage(
  ctx: WorkspaceContext,
  imageId: string,
): Promise<{ mimeType: string; bytes: Buffer }> {
  requirePermission(ctx, "product:read");
  const row = await ctx.db.getById(pendingImage, idSchema.parse(imageId));
  return { mimeType: row.mimeType, bytes: Buffer.from(row.dataBase64, "base64") };
}
