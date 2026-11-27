"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/components/app/action-result";
import { deletePendingImage, uploadProductImages, type UploadImagesResult } from "@/lib/services";

import { runAction } from "../../_lib/action";

/*
 * Product photos uploaded by users. Each action calls one service (which
 * checks the role and workspace again) and refreshes the route on success.
 */

/** FormData: `productId` and one or more `images` files. */
export async function uploadProductImagesAction(
  formData: FormData,
): Promise<ActionResult<UploadImagesResult>> {
  const productId = String(formData.get("productId") ?? "");
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  const result = await runAction(async (ctx) =>
    uploadProductImages(ctx, {
      productId,
      files: await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))),
    }),
  );
  if (result.ok) refresh();
  if (!result.ok && result.code === "forbidden") {
    return { ...result, error: "Your role cannot add product photos. Ask a Creative or higher." };
  }
  return result;
}

export async function deletePendingImageAction(
  productId: string,
  imageId: string,
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await deletePendingImage(ctx, { productId, imageId });
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}
