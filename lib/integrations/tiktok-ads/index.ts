import type { IntegrationsMode, TikTokAdsClient } from "@/lib/domain/contracts";

import { createLiveTikTokAdsClient, type LiveTikTokAdsOptions } from "./live";
import { createMockTikTokAdsClient } from "./mock";

export { NotImplementedIntegrationError, UnsafeActionError } from "./safety";
export { MARKETING_API_VERSION } from "./config";
export {
  CURRENCY_DECIMALS,
  currencyDecimals,
  MIN_DAILY_BUDGET,
  minimumBudget,
  type MinDailyBudget,
} from "./budget";
export { TimeBudgetError } from "./http";
export { STATS_CALL_BUDGET_MS, STATS_MAX_WINDOW_HOURS } from "./limits";

/** Registry factory (see lib/integrations/index.ts). */
export function createTikTokAdsClient(
  mode: IntegrationsMode,
  options?: LiveTikTokAdsOptions,
): TikTokAdsClient {
  return mode === "live" ? createLiveTikTokAdsClient(options) : createMockTikTokAdsClient();
}
