import type { IntegrationsMode, TikTokAdsClient } from "@/lib/domain/contracts";

import { createLiveTikTokAdsClient, type LiveTikTokAdsOptions } from "./live";
import { createMockTikTokAdsClient } from "./mock";

export { NotImplementedIntegrationError, UnsafeActionError } from "./safety";
export { MARKETING_API_VERSION } from "./config";

/** Registry factory (see lib/integrations/index.ts). */
export function createTikTokAdsClient(
  mode: IntegrationsMode,
  options?: LiveTikTokAdsOptions,
): TikTokAdsClient {
  return mode === "live" ? createLiveTikTokAdsClient(options) : createMockTikTokAdsClient();
}
