import type { IntegrationsMode, SupplierFinder } from "@/lib/domain/contracts";

import { createLiveSupplierFinder, type LiveSupplierFinderOptions } from "./live";
import { createMockSupplierFinder } from "./mock";

export {
  calculateMargin,
  DEFAULT_FEES,
  DEFAULT_PRICING_RULE,
  FEE_PRESETS,
  feeScheduleSchema,
  marginInputSchema,
  minimumPriceForMargin,
  quoteSupplier,
  supplierQuoteInputSchema,
  type FeeSchedule,
  type MarginInput,
  type MarginResult,
  type SupplierQuote,
  type SupplierQuoteInput,
} from "./margin";
export { normalizeProductUrl, parseImportLink, type ImportLink } from "./links";
export { DEFAULT_SUPPLIER_LIMIT, MAX_SUPPLIER_LIMIT } from "./live";

/** Registry factory (see lib/integrations/index.ts). Live: SerpApi + Firecrawl. */
export function createSupplierFinder(
  mode: IntegrationsMode,
  options?: LiveSupplierFinderOptions,
): SupplierFinder {
  return mode === "live" ? createLiveSupplierFinder(options) : createMockSupplierFinder();
}
