import type { Copywriter, IntegrationsMode, ProductAnalyzer } from "@/lib/domain/contracts";

import { createLiveProductAnalyzer, type LiveAnalyzerOptions } from "./analyzer-live";
import { createLiveCopywriter, type LiveCopywriterOptions } from "./copywriter-live";
import { createMockCopywriter, createMockProductAnalyzer } from "./mock";

export {
  assertAiBudget,
  DEFAULT_AI_MONTHLY_CAP_USD,
  getAiBudget,
  getAiMonthlyCapUsd,
  getMonthlyUsage,
  meteredCall,
  monthKey,
  recordAiUsage,
  totalCostUsd,
  type BudgetStatus,
  type MonthlyUsage,
} from "./metering";
export {
  DEFAULT_MODELS,
  firecrawlUsage,
  modelIds,
  REQUEST_PRICES,
  serpApiUsage,
  tokenCostUsd,
  tokenUsage,
} from "./pricing";
export { findUnsafeClaims, sanitizeDescriptionHtml, type UnsafeClaim } from "./copy-safety";

/** Registry factory (see lib/integrations/index.ts). */
export function createProductAnalyzer(
  mode: IntegrationsMode,
  options?: LiveAnalyzerOptions,
): ProductAnalyzer {
  return mode === "live" ? createLiveProductAnalyzer(options) : createMockProductAnalyzer();
}

/** Registry factory. Live: Claude (AI_COPYWRITING_MODEL, default claude-opus-5-5). */
export function createCopywriter(
  mode: IntegrationsMode,
  options?: LiveCopywriterOptions,
): Copywriter {
  return mode === "live" ? createLiveCopywriter(options) : createMockCopywriter();
}
