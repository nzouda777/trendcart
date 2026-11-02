import type { IntegrationsMode, TikTokPostingClient } from "@/lib/domain/contracts";

import { createLiveTikTokPostingClient, type LiveTikTokPostingOptions } from "./live";
import { createMockTikTokPostingClient } from "./mock";

export { isPostingAudited, LOGIN_SCOPES } from "./config";
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
