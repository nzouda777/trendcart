"use server";

import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import { importFromProductLink, importFromTikTok } from "@/lib/services";

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
