import "server-only";

import type { IntegrationsMode } from "@/lib/domain/contracts";

import { createLiveShopifyClient } from "./live";
import { createMockShopifyClient } from "./mock";
import type { ShopifyAdapter } from "./types";

/**
 * Registry factory (see lib/integrations/index.ts). Returns a ShopifyClient;
 * the extra ShopifyAdapter methods (refreshAccessToken) are used by
 * ./credentials only.
 */
export function createShopifyClient(mode: IntegrationsMode): ShopifyAdapter {
  return mode === "live" ? createLiveShopifyClient() : createMockShopifyClient();
}

export { createLiveShopifyClient } from "./live";
export { createMockShopifyClient } from "./mock";
export { isShopifyNotImplemented, ShopifyNotImplementedError } from "./errors";
export {
  DEFAULT_SHOPIFY_API_VERSION,
  SHOPIFY_METAFIELD_DEFINITIONS,
  SHOPIFY_SCOPES,
} from "./config";
export { normalizeShopDomain } from "./hmac";
export { priceFromCost, roundToEnding, pricingRuleSchema, type PriceQuote } from "./pricing";
export { parseTemplateSuffixes } from "./templates";
export { draftProductInputFromPageCopy } from "./product-input";
export { TRENDCART_TEMPLATE_SUFFIX } from "./template-kit";
export type { ShopifyAdapter, ShopifyInstallToken } from "./types";
