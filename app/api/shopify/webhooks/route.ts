import type { NextRequest } from "next/server";

import { getIntegrationsMode } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { handleShopifyWebhook } from "@/lib/integrations/shopify/webhooks";
import { findShopifyConnectionsByShopDomain, getSystemContext } from "@/lib/tenant/system";

/*
 * Shopify webhooks (app/uninstalled + compliance topics), one endpoint routed
 * by X-Shopify-Topic. Configure it in shopify.app.toml:
 *
 *   [webhooks]
 *   api_version = "2026-10"
 *   [[webhooks.subscriptions]]
 *   topics = ["app/uninstalled"]
 *   compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
 *   uri = "https://<site>/api/shopify/webhooks"
 *
 * HMAC is checked on the raw body (request.text(), never re-serialized JSON),
 * before the cross-workspace shop lookup runs.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const result = await handleShopifyWebhook(
    { rawBody, headers: request.headers },
    {
      client: createShopifyClient(getIntegrationsMode()),
      lookup: {
        findConnectionsByShop: (shop) => findShopifyConnectionsByShopDomain(shop),
        systemContext: (workspaceId) => getSystemContext(workspaceId, "webhook:shopify"),
      },
    },
  );
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
