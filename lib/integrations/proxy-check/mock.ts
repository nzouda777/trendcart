import { proxyCheckResultSchema, type ProxyChecker } from "@/lib/domain/contracts";
import { fnv1a } from "@/lib/ai/sample-products";

import { proxyKind } from "../tiktok-data/http";

/**
 * Simulated proxy check: no network. It still reads the real CallContext, so
 * it shows exactly which path the brand's requests would take:
 * - proxy enabled -> route "proxy", an exit IP derived from the proxy host
 *   (stable for the same host, different for another one);
 * - no proxy or disabled -> route "direct", the server's own fake IP.
 *
 * IPs come from the RFC 5737 documentation ranges (203.0.113.0/24 and
 * 198.51.100.0/24), which never belong to anyone on the internet.
 */
export const MOCK_DIRECT_IP = "198.51.100.10";

export function createMockProxyChecker(): ProxyChecker {
  return {
    async check(ctx) {
      if (!ctx.proxyUrl) {
        return proxyCheckResultSchema.parse({
          route: "direct",
          proxyKind: null,
          exitIp: MOCK_DIRECT_IP,
          latencyMs: 40,
          simulated: true,
        });
      }
      const kind = proxyKind(ctx.proxyUrl);
      // Seed on host:port only, never on the credentials.
      const host = new URL(ctx.proxyUrl).host;
      const h = fnv1a(host);
      return proxyCheckResultSchema.parse({
        route: "proxy",
        proxyKind: kind,
        exitIp: `203.0.113.${1 + (h % 254)}`,
        latencyMs: 80 + (h % 220),
        simulated: true,
      });
    },
  };
}
