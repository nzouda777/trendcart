import "server-only";

import { type Integrations, type IntegrationsMode } from "@/lib/domain/contracts";
import { createCopywriter, createProductAnalyzer } from "@/lib/ai";
import { createComplianceChecker } from "@/lib/compliance";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { createTikTokAdsClient } from "@/lib/integrations/tiktok-ads";
import { createTikTokDataProvider } from "@/lib/integrations/tiktok-data";
import { createTikTokPostingClient } from "@/lib/integrations/tiktok-posting";
import { createSupplierFinder } from "@/lib/sourcing";

import { resolveIntegrationsMode } from "./mode";

/*
 * Integration registry: resolves every adapter for INTEGRATIONS_MODE (mock by
 * default). Services call `getIntegrations()`; nothing else imports an adapter
 * directly. Tests pass their own `Integrations` to services instead.
 *
 * Each adapter folder exports one factory taking the mode:
 *   lib/integrations/shopify        createShopifyClient
 *   lib/integrations/tiktok-ads     createTikTokAdsClient
 *   lib/integrations/tiktok-posting createTikTokPostingClient
 *   lib/integrations/tiktok-data    createTikTokDataProvider
 *   lib/ai                          createProductAnalyzer, createCopywriter
 *   lib/sourcing                    createSupplierFinder
 *   lib/compliance                  createComplianceChecker
 */

/** Throws in Vercel production unless INTEGRATIONS_MODE=live (see ./mode). */
export function getIntegrationsMode(): IntegrationsMode {
  return resolveIntegrationsMode();
}

let cached: Integrations | undefined;

export function createIntegrations(mode: IntegrationsMode): Integrations {
  return {
    mode,
    shopify: createShopifyClient(mode),
    tiktokAds: createTikTokAdsClient(mode),
    tiktokPosting: createTikTokPostingClient(mode),
    tiktokData: createTikTokDataProvider(mode),
    productAnalyzer: createProductAnalyzer(mode),
    supplierFinder: createSupplierFinder(mode),
    complianceChecker: createComplianceChecker(mode),
    copywriter: createCopywriter(mode),
  };
}

export function getIntegrations(): Integrations {
  cached ??= createIntegrations(getIntegrationsMode());
  return cached;
}
