import "server-only";

import { type Integrations, type IntegrationsMode } from "@/lib/domain/contracts";
import { createCopywriter, createProductAnalyzer } from "@/lib/ai";
import { createComplianceChecker } from "@/lib/compliance";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { createTikTokAdsClient } from "@/lib/integrations/tiktok-ads";
import { createTikTokDataProvider } from "@/lib/integrations/tiktok-data";
import { createTikTokPostingClient } from "@/lib/integrations/tiktok-posting";
import { createProxyChecker } from "@/lib/integrations/proxy-check";
import { createSupplierFinder } from "@/lib/sourcing";

import { resolveAiMode, resolveIntegrationsMode } from "./mode";

/*
 * Integration registry: resolves every adapter for INTEGRATIONS_MODE (mock by
 * default). AI_MODE overrides it for the read-only analysis adapters
 * (tiktokData, productAnalyzer, supplierFinder, copywriter), see ./mode. Services call `getIntegrations()`; nothing else imports an adapter
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
 *   lib/integrations/proxy-check    createProxyChecker
 */

/** Throws in Vercel production unless INTEGRATIONS_MODE=live (see ./mode). */
export function getIntegrationsMode(): IntegrationsMode {
  return resolveIntegrationsMode();
}

let cached: Integrations | undefined;

/** Throws in Vercel production when AI_MODE=mock (see ./mode). */
export function getAiMode(): IntegrationsMode {
  return resolveAiMode();
}

export function createIntegrations(
  mode: IntegrationsMode,
  aiMode: IntegrationsMode = mode,
): Integrations {
  return {
    mode,
    shopify: createShopifyClient(mode),
    tiktokAds: createTikTokAdsClient(mode),
    tiktokPosting: createTikTokPostingClient(mode),
    tiktokData: createTikTokDataProvider(aiMode),
    productAnalyzer: createProductAnalyzer(aiMode),
    supplierFinder: createSupplierFinder(aiMode),
    // No live LLM checker yet (M2): stays on INTEGRATIONS_MODE.
    complianceChecker: createComplianceChecker(mode),
    copywriter: createCopywriter(aiMode),
    // Same network path as the read-only sourcing adapters.
    proxyChecker: createProxyChecker(aiMode),
  };
}

export function getIntegrations(): Integrations {
  cached ??= createIntegrations(getIntegrationsMode(), getAiMode());
  return cached;
}
