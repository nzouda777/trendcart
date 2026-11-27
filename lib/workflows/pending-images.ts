import "server-only";

import { asc, eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import type { Integrations } from "@/lib/domain/contracts";
import { pendingImage, product } from "@/lib/db/schema";
import { isPendingImageUrl } from "@/lib/media/images";
import { getShopifyCredentialsFor } from "@/lib/services/internal/credentials";
import type { WorkspaceContext } from "@/lib/tenant/context";

/**
 * Sends every waiting image of a product to its Shopify draft, deleting each
 * row as soon as Shopify has it. Called by the build step once the draft
 * exists (no role check: the step runs as a system actor, the user who
 * approved GATE 2 started it). An image-search photo also becomes a product
 * photo, and the analysis' reference image moves to its Shopify URL.
 * Idempotent: a retry after a partial run only sends what is left.
 */
export async function pushPendingImages(
  ctx: WorkspaceContext,
  integrations: Integrations,
  input: { productId: string; connectionId: string; shopifyProductId: string },
): Promise<number> {
  const rows = await ctx.db.select(pendingImage, {
    where: eq(pendingImage.productId, input.productId),
    orderBy: (t) => [asc(t.purpose), asc(t.position), asc(t.createdAt)],
  });
  if (rows.length === 0) return 0;
  const row = await ctx.db.getById(product, input.productId);
  const { creds } = await getShopifyCredentialsFor(ctx, integrations, input.connectionId);

  for (const image of rows) {
    const attached = await integrations.shopify.attachImage(creds, {
      productId: input.shopifyProductId,
      data: new Uint8Array(Buffer.from(image.dataBase64, "base64")),
      mimeType: image.mimeType,
      idempotencyKey: image.sha256,
      ...(row.name ? { alt: row.name } : {}),
    });
    if (image.purpose === "search" && isPendingImageUrl(row.analysis?.referenceImageUrl)) {
      // The signed URL dies with the row: point the analysis at Shopify's copy.
      await ctx.db.update(
        product,
        { analysis: { ...row.analysis!, referenceImageUrl: attached.url } },
        eq(product.id, row.id),
      );
    }
    await ctx.db.delete(pendingImage, eq(pendingImage.id, image.id));
  }
  await writeAudit(ctx, {
    action: "page.media_upload",
    targetType: "product",
    targetId: input.productId,
    metadata: { shopifyProductId: input.shopifyProductId, images: rows.length },
  });
  return rows.length;
}
