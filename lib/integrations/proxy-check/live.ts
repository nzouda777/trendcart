import { z } from "zod";

import {
  IntegrationError,
  proxyCheckResultSchema,
  type ProxyChecker,
} from "@/lib/domain/contracts";

import { createHttpClient, proxyKind, type HttpFetch } from "../tiktok-data/http";

/** Returns the caller's public IP as JSON: {"ip":"..."}. */
export const IP_ECHO_URL = "https://api.ipify.org?format=json";
const TIMEOUT_MS = 10_000;

export type LiveProxyCheckerOptions = { fetch?: HttpFetch };

/**
 * One GET to a public IP echo service through the same HTTP client the
 * sourcing adapters use (brand proxy when enabled, SSRF-guarded direct
 * otherwise). The IP it returns is the one target sites see.
 */
export function createLiveProxyChecker(options: LiveProxyCheckerOptions = {}): ProxyChecker {
  return {
    async check(ctx) {
      const http = createHttpClient(ctx, { fetch: options.fetch, timeoutMs: TIMEOUT_MS });
      const started = Date.now();
      let body: unknown;
      try {
        const res = await http(IP_ECHO_URL, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`IP echo answered ${res.status}`);
        body = await res.json();
      } catch (cause) {
        throw new IntegrationError(
          "proxy",
          "provider_error",
          ctx.proxyUrl
            ? "The request through the proxy failed. Check the host, port and credentials."
            : "The direct test request failed.",
          { cause },
        );
      }
      const parsed = z.object({ ip: z.string().min(1).max(64) }).safeParse(body);
      if (!parsed.success) {
        throw new IntegrationError("proxy", "provider_error", "Unexpected IP echo response.");
      }
      return proxyCheckResultSchema.parse({
        route: ctx.proxyUrl ? "proxy" : "direct",
        proxyKind: ctx.proxyUrl ? proxyKind(ctx.proxyUrl) : null,
        exitIp: parsed.data.ip,
        latencyMs: Date.now() - started,
        simulated: false,
      });
    },
  };
}
