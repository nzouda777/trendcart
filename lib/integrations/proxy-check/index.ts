import type { IntegrationsMode, ProxyChecker } from "@/lib/domain/contracts";

import { createLiveProxyChecker, type LiveProxyCheckerOptions } from "./live";
import { createMockProxyChecker } from "./mock";

export { IP_ECHO_URL } from "./live";
export { MOCK_DIRECT_IP } from "./mock";

/** Registry factory (see lib/integrations/index.ts). */
export function createProxyChecker(
  mode: IntegrationsMode,
  options?: LiveProxyCheckerOptions,
): ProxyChecker {
  return mode === "live" ? createLiveProxyChecker(options) : createMockProxyChecker();
}
