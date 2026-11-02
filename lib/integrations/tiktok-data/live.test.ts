import { afterEach, describe, expect, it } from "vitest";
import { ProxyAgent, Socks5ProxyAgent, type RequestInit } from "undici";

import { resolvedTikTokVideoSchema } from "@/lib/domain/contracts";

import { SC_EXPIRES, SC_VIDEO_ID, scAweme, scSearchResponse, scVideoResponse } from "./fixtures";
import {
  createHttpClient,
  proxyKind,
  resetDispatcherCache,
  selectDispatcher,
  type HttpFetch,
} from "./http";
import { createLiveTikTokDataProvider } from "./live";
import { guardedDispatcher } from "./net-guard";
import { mapResolvedVideo, mediaExpiry } from "./scrapecreators";

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  handler: (url: URL, init?: RequestInit) => Response,
): HttpFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(new URL(String(input)), init);
  }) as unknown as HttpFetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => resetDispatcherCache());

describe("proxy agent selection", () => {
  it("goes direct without a proxy", () => {
    expect(selectDispatcher(undefined)).toBeUndefined();
  });

  it("uses ProxyAgent for http(s) proxies and caches it per URL", () => {
    const a = selectDispatcher("http://user:pass@proxy.example:8080");
    expect(a).toBeInstanceOf(ProxyAgent);
    expect(selectDispatcher("http://user:pass@proxy.example:8080")).toBe(a);
    expect(selectDispatcher("https://proxy.example:8443")).not.toBe(a);
  });

  it("uses Socks5ProxyAgent for socks5 proxies", () => {
    expect(selectDispatcher("socks5://u:p@proxy.example:1080")).toBeInstanceOf(Socks5ProxyAgent);
    expect(proxyKind("socks://proxy.example:1080")).toBe("socks5");
    expect(selectDispatcher("socks5h://u:p@proxy.example:1080")).toBeInstanceOf(Socks5ProxyAgent);
  });

  it("rejects unsupported schemes", () => {
    expect(() => selectDispatcher("ftp://proxy.example")).toThrow(/Unsupported proxy scheme/);
    expect(() => selectDispatcher("::nope")).toThrow(/not a valid URL/);
  });

  it("passes the dispatcher and a timeout signal to fetch", async () => {
    const base = fakeFetch(() => new Response("ok"));
    await createHttpClient(
      { proxyUrl: "http://proxy.example:8080" },
      { fetch: base },
    )("https://api.example/x");
    await createHttpClient({}, { fetch: base })("https://api.example/y");
    expect(base.calls[0]!.init?.dispatcher).toBeInstanceOf(ProxyAgent);
    expect(base.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    // Direct calls use the SSRF-guarded agent, never the global dispatcher.
    expect(base.calls[1]!.init?.dispatcher).toBe(guardedDispatcher());
  });
});

describe("ScrapeCreators mapping", () => {
  it("maps a video payload to the contract, preferring the no-watermark rendition", () => {
    const video = mapResolvedVideo(scAweme());
    expect(resolvedTikTokVideoSchema.parse(video)).toEqual(video);
    expect(video).toMatchObject({
      tiktokVideoId: SC_VIDEO_ID,
      tiktokUrl: `https://www.tiktok.com/@homefinds.daily/video/${SC_VIDEO_ID}`,
      author: { username: "homefinds.daily", displayName: "Home Finds Daily" },
      stats: { views: 355_687, likes: 44_855, comments: 270, shares: 3_100 },
      durationSec: 15.48,
      width: 1080,
      height: 1920,
      mediaUrlExpiresAt: new Date(SC_EXPIRES * 1000).toISOString(),
    });
    expect(video.mediaUrl).toContain("nwm-");
  });

  it("falls back to the highest bitrate rendition", () => {
    const aweme = scAweme();
    delete (aweme.video as Record<string, unknown>).download_no_watermark_addr;
    const video = mapResolvedVideo(aweme);
    expect(video.mediaUrl).toContain("low-");
    expect([video.width, video.height]).toEqual([540, 960]);
  });

  it("fails cleanly without playable media", () => {
    expect(() => mapResolvedVideo(scAweme(SC_VIDEO_ID, { video: { duration: 1000 } }))).toThrow(
      /no playable video/,
    );
  });

  it("reads x-expires", () => {
    expect(mediaExpiry("https://cdn.example/v.mp4?x-expires=1700000000")).toBe(
      "2023-11-14T22:13:20.000Z",
    );
    expect(mediaExpiry("https://cdn.example/v.mp4")).toBeUndefined();
  });
});

describe("live TikTokDataProvider (ScrapeCreators)", () => {
  const env = { TIKTOK_DATA_PROVIDER: "scrapecreators", TIKTOK_DATA_PROVIDER_KEY: "test-key" };
  const ctx = { workspaceId: "ws_1", proxyUrl: "http://u:p@proxy.example:8080" };

  it("resolves a short link through the proxy, then fetches the video", async () => {
    const fetch = fakeFetch((url) => {
      if (url.hostname === "vm.tiktok.com") {
        return new Response(null, {
          status: 301,
          headers: {
            location: `https://www.tiktok.com/@homefinds.daily/video/${SC_VIDEO_ID}?_t=x`,
          },
        });
      }
      if (url.pathname === "/v2/tiktok/video") return json(scVideoResponse);
      return new Response("unexpected", { status: 500 });
    });
    const provider = createLiveTikTokDataProvider({ env, fetch });
    const video = await provider.resolveVideo(ctx, "https://vm.tiktok.com/ZMh7Abc12/");

    expect(video.tiktokVideoId).toBe(SC_VIDEO_ID);
    const api = fetch.calls[1]!;
    expect(new URL(api.url).searchParams.get("url")).toBe(
      `https://www.tiktok.com/@homefinds.daily/video/${SC_VIDEO_ID}`,
    );
    expect((api.init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    for (const call of fetch.calls) expect(call.init?.dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it("maps provider errors", async () => {
    const provider = createLiveTikTokDataProvider({
      env,
      fetch: fakeFetch(() => json({ success: false, message: "rate limit" }, 429)),
    });
    await expect(
      provider.resolveVideo(
        { workspaceId: "ws_1" },
        `https://www.tiktok.com/@a/video/${SC_VIDEO_ID}`,
      ),
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("fails without an API key, before any request", async () => {
    const fetch = fakeFetch(() => json(scVideoResponse));
    const provider = createLiveTikTokDataProvider({
      env: { TIKTOK_DATA_PROVIDER: "scrapecreators" },
      fetch,
    });
    await expect(
      provider.resolveVideo(
        { workspaceId: "ws_1" },
        `https://www.tiktok.com/@a/video/${SC_VIDEO_ID}`,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("pages search results, dedupes and honours the limit", async () => {
    const ids = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => `74632503635592${String(from + i).padStart(5, "0")}`);
    const fetch = fakeFetch((url) => {
      const cursor = url.searchParams.get("cursor");
      if (!cursor) return json(scSearchResponse(ids(0, 4), 4));
      return json(scSearchResponse([...ids(3, 1), ...ids(4, 4)], 8));
    });
    const provider = createLiveTikTokDataProvider({ env, fetch });
    const results = await provider.searchVideos(
      { workspaceId: "ws_1" },
      { query: "sunset lamp", country: "fr", limit: 6 },
    );

    expect(results).toHaveLength(6);
    expect(new Set(results.map((r) => r.tiktokVideoId)).size).toBe(6);
    expect(new URL(fetch.calls[0]!.url).searchParams.get("region")).toBe("FR");
    expect(fetch.calls).toHaveLength(2);
  });
});
