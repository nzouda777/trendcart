"use server";

import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import { importFromImage, importFromProductLink, importFromTikTok } from "@/lib/services";

import { runAction } from "../_lib/action";

export type ImportKind = "tiktok" | "link";

/**
 * Imports a TikTok video or product link for a brand, then opens the
 * product. Re-importing the same source opens the existing product.
 */
export async function importAction(input: {
  kind: ImportKind;
  url: string;
  brandId: string;
}): Promise<ActionResult<{ productId: string }>> {
  const result = await runAction(async (ctx) => {
    const args = { url: input.url, brandId: input.brandId };
    const { product, created } =
      input.kind === "tiktok"
        ? await importFromTikTok(ctx, args)
        : await importFromProductLink(ctx, args);
    return { productId: product.id, created };
  });
  if (!result.ok) return result;
  redirect(
    `/app/products/${encodeURIComponent(result.data.productId)}${result.data.created ? "" : "?existing=1"}`,
  );
}

/**
 * Image search: imports a product from an uploaded photo (`image` file) or a
 * direct image link (`imageUrl`), then opens the product.
 */
export async function importImageAction(
  formData: FormData,
): Promise<ActionResult<{ productId: string }>> {
  const brandId = String(formData.get("brandId") ?? "");
  const file = formData.get("image");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const result = await runAction(async (ctx) => {
    const { product, created } =
      file instanceof File && file.size > 0
        ? await importFromImage(ctx, { brandId, image: new Uint8Array(await file.arrayBuffer()) })
        : await importFromImage(ctx, { brandId, imageUrl });
    return { productId: product.id, created };
  });
  if (!result.ok) return result;
  redirect(
    `/app/products/${encodeURIComponent(result.data.productId)}${result.data.created ? "" : "?existing=1"}`,
  );
}
