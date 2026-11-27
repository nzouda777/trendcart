"use server";

import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import { claimShopifyStore } from "@/lib/services";

import { runAction } from "../../_lib/action";

/**
 * Connects the store this browser just installed from Shopify to a brand of
 * the workspace (role: connection:create), then opens the connections page.
 */
export async function claimShopifyStoreAction(input: {
  brandId: string;
}): Promise<ActionResult<{ connectionId: string }>> {
  const result = await runAction((ctx) => claimShopifyStore(ctx, input));
  if (!result.ok) return result;
  const params = new URLSearchParams({
    shopify: "connected",
    connection: result.data.connectionId,
  });
  if (!result.data.metafieldsReady) params.set("shopify_warning", "metafields_pending");
  redirect(`/app/connections?${params.toString()}`);
}
