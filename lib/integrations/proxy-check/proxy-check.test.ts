import { ProxyAgent, Response, type RequestInit } from "undici";
import { describe, expect, it } from "vitest";

import type { HttpFetch } from "../tiktok-data/http";

import { createLiveProxyChecker, IP_ECHO_URL } from "./live";
import { createMockProxyChecker, MOCK_DIRECT_IP } from "./mock";

const ctx = { workspaceId: "ws_1" };
const PROXY = "http://alice:s3cret@proxy.example.net:8080";

describe("mock proxy checker", () => {
  const checker = createMockProxyChecker();

  it("reports a direct route without a proxy", async () => {
    expect(await checker.check(ctx)).toEqual({
      route: "direct",
      proxyKind: null,
      exitIp: MOCK_DIRECT_IP,
      latencyMs: 40,
      simulated: true,
    });
  });

  it("derives a stable documentation-range exit IP from the proxy host only", async () => {
    const a = await checker.check({ ...ctx, proxyUrl: PROXY });
    expect(a).toMatchObject({ route: "proxy", proxyKind: "http", simulated: true });
    expect(a.exitIp).toMatch(/^203\.0\.113\.\d{1,3}$/);
    // Same host, other credentials: same IP. Other host: other IP.
    const b = await checker.check({ ...ctx, proxyUrl: "http://bob:x@proxy.example.net:8080" });
    expect(b.exitIp).toBe(a.exitIp);
    const c = await checker.check({ ...ctx, proxyUrl: "socks5://u:p@other.example.org:1080" });
    expect(c).toMatchObject({ route: "proxy", proxyKind: "socks5" });
    expect(c.exitIp).not.toBe(a.exitIp);
  });
});

describe("live proxy checker", () => {
  function echo(ip: string) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ip }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as HttpFetch;
    return { fetch, calls };
  }

  it("calls the IP echo through the brand proxy", async () => {
    const { fetch, calls } = echo("192.0.2.44");
    const result = await createLiveProxyChecker({ fetch }).check({ ...ctx, proxyUrl: PROXY });
    expect(result).toMatchObject({
      route: "proxy",
      proxyKind: "http",
      exitIp: "192.0.2.44",
      simulated: false,
    });
    expect(calls[0]!.url).toBe(IP_ECHO_URL);
    expect(calls[0]!.init?.dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it("maps network failures to a provider error without leaking the URL", async () => {
    const fetch = (async () => {
      throw new Error(`connect ECONNREFUSED ${PROXY}`);
    }) as unknown as HttpFetch;
    const err: Error = await createLiveProxyChecker({ fetch })
      .check({ ...ctx, proxyUrl: PROXY })
      .then(
        () => new Error("expected a failure"),
        (e: unknown) => e as Error,
      );
    expect(err).toMatchObject({ name: "IntegrationError", code: "provider_error" });
    expect(err.message).not.toContain("s3cret");
  });
});
