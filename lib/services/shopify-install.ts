import "server-only";

import { requirePermission } from "@/lib/auth/guards";
import { getIntegrationsMode } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import {
  claimShopifyInstall,
  claimInputSchema,
  pendingClaimShop,
} from "@/lib/integrations/shopify/app-store-install";
import type { WorkspaceContext } from "@/lib/tenant/context";

import type { z } from "zod";

/*
 * Stores installed from Shopify (public app, App Store or install link),
 * as seen by app pages. The install itself runs in app/api/shopify/launch and
 * callback; see lib/integrations/shopify/app-store-install.
 */

/**
 * Shop domain of the store this browser installed from Shopify and that no
 * workspace claimed yet, or null. Readable by every member (role: connection:read).
 */
export async function getPendingShopifyClaim(ctx: WorkspaceContext): Promise<string | null> {
  requirePermission(ctx, "connection:read");
  return pendingClaimShop();
}

/** Connects that store to a brand of the workspace (role: connection:create). */
export async function claimShopifyStore(
  ctx: WorkspaceContext,
  input: z.input<typeof claimInputSchema>,
): Promise<{ connectionId: string; shopDomain: string; metafieldsReady: boolean }> {
  requirePermission(ctx, "connection:create");
  const saved = await claimShopifyInstall(ctx, input, {
    client: createShopifyClient(getIntegrationsMode()),
  });
  return {
    connectionId: saved.connectionId,
    shopDomain: saved.shopDomain,
    metafieldsReady: saved.metafieldsReady,
  };
}
