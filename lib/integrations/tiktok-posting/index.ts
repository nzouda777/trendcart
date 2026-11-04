import type { IntegrationsMode, TikTokPostingClient } from "@/lib/domain/contracts";

import { createLiveTikTokPostingClient, type LiveTikTokPostingOptions } from "./live";
import { createMockTikTokPostingClient } from "./mock";

export {
  isPostingAudited,
  LOGIN_SCOPES,
  PUBLISH_CLAIM_STALE_MS,
  PUBLISH_LOCK_TTL_MS,
} from "./config";
export { planChunks } from "./chunks";

/** Registry factory (see lib/integrations/index.ts). */
export function createTikTokPostingClient(
  mode: IntegrationsMode,
  options?: LiveTikTokPostingOptions,
): TikTokPostingClient {
  return mode === "live"
    ? createLiveTikTokPostingClient(options)
    : createMockTikTokPostingClient({ now: options?.now });
}
