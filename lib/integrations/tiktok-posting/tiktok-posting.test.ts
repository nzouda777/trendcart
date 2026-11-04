import { describe, expect, it, vi } from "vitest";

import {
  tiktokCreatorInfoSchema,
  tiktokProfileTokenSchema,
  tiktokPublishStatusSchema,
  type TikTokPrivacyLevel,
} from "@/lib/domain/contracts";

import { noopRateLimiter, type RateLimiter } from "../tiktok-ads/rate-limit";
import { UnsafeActionError } from "../tiktok-ads/safety";

import fx from "./__fixtures__/content-posting-v2.json";
import { contentRange, MB, planChunks } from "./chunks";
import { isPostingAudited, PUBLISH_CLAIM_STALE_MS, PUBLISH_LOCK_TTL_MS } from "./config";
import { mapPostingError } from "./http";
import { createLiveTikTokPostingClient } from "./live";
import { createMockTikTokPostingClient, MOCK_LOGIN_AUTH_CODE } from "./mock";

/*
 * The default source fetch is the SSRF-guarded client from tiktok-data/http.
 * Replaced here by a recorder: tests that inject `sourceFetch` never reach it.
 */
const guarded = vi.hoisted(() => ({
  ctxs: [] as unknown[],
  calls: [] as { url: string; method: string }[],
}));
vi.mock("@/lib/integrations/tiktok-data/http", () => ({
  createHttpClient: (ctx: unknown) => {
    guarded.ctxs.push(ctx);
    return async (url: string | URL, init?: { method?: string }) => {
      guarded.calls.push({ url: String(url), method: init?.method ?? "GET" });
      return new Response(null, { status: 404 });
    };
  },
}));

const oauth = {
  state: "s".repeat(32),
  redirectUri: "http://localhost:3000/api/tiktok/login/callback",
};
const fixedNow = () => new Date("2026-10-25T10:00:00.000Z");

describe("tiktok posting mock: contract conformance", () => {
  it("completes the login loop locally", async () => {
    const client = createMockTikTokPostingClient({ now: fixedNow });
    const url = new URL(client.buildAuthUrl(oauth));
    expect(url.searchParams.get("state")).toBe(oauth.state);
    const token = await client.exchangeAuthCode({
      code: url.searchParams.get("code")!,
      redirectUri: oauth.redirectUri,
    });
    tiktokProfileTokenSchema.parse(token);
    expect(token.expiresAt).toBe("2026-10-26T10:00:00.000Z");
    expect(token.scopes).toContain("video.publish");
  });

  it("refreshes, and fails like a revoked grant", async () => {
    const client = createMockTikTokPostingClient({ now: fixedNow });
    const t = await client.refreshToken({ refreshToken: "mock-refresh-abc" });
    tiktokProfileTokenSchema.parse(t);
    await expect(client.refreshToken({ refreshToken: "revoked-x" })).rejects.toMatchObject({
      code: "auth_expired",
    });
  });

  it("creator info, private publish and status polling parse with the contract", async () => {
    const client = createMockTikTokPostingClient();
    const token = await client.exchangeAuthCode({
      code: MOCK_LOGIN_AUTH_CODE,
      redirectUri: oauth.redirectUri,
    });
    tiktokCreatorInfoSchema.parse(await client.getCreatorInfo({ accessToken: token.accessToken }));

    const { publishId } = await client.publishVideoFromUrl({
      accessToken: token.accessToken,
      sourceUrl: "https://cdn.shopify.com/v.mp4",
      caption: "hello",
      privacyLevel: "SELF_ONLY",
    });
    expect(client.chunkPlanOf(publishId)?.totalChunkCount).toBe(2);
    const first = tiktokPublishStatusSchema.parse(
      await client.getPublishStatus({ accessToken: token.accessToken, publishId }),
    );
    const second = tiktokPublishStatusSchema.parse(
      await client.getPublishStatus({ accessToken: token.accessToken, publishId }),
    );
    expect([first.status, second.status]).toEqual(["PROCESSING_UPLOAD", "PUBLISH_COMPLETE"]);
    expect(second.postIds).toEqual([]);
  });
});

describe("safety: tests can never publish publicly", () => {
  const publics: TikTokPrivacyLevel[] = [
    "PUBLIC_TO_EVERYONE",
    "FOLLOWER_OF_CREATOR",
    "MUTUAL_FOLLOW_FRIENDS",
  ];

  it("the mock refuses every non-private privacy level", async () => {
    const client = createMockTikTokPostingClient();
    for (const privacyLevel of publics) {
      await expect(
        client.publishVideoFromUrl({
          accessToken: "mock-access-x",
          sourceUrl: "https://cdn.shopify.com/v.mp4",
          caption: "c",
          privacyLevel,
        }),
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
  });

  it("the app is never considered audited under test, even if the env says so", () => {
    expect(
      isPostingAudited({ ...process.env, TIKTOK_POSTING_AUDITED: "true", TIKTOK_SANDBOX: "false" }),
    ).toBe(false);
  });

  it("live publish is blocked before any request, private or not", async () => {
    const fetch = vi.fn();
    const client = createLiveTikTokPostingClient({
      env: {
        ...process.env,
        TIKTOK_LOGIN_CLIENT_KEY: "k",
        TIKTOK_LOGIN_CLIENT_SECRET: "s",
        TIKTOK_POSTING_AUDITED: "true",
        TIKTOK_SANDBOX: "false",
      },
      fetch,
      rateLimiter: noopRateLimiter,
    });
    const input = { accessToken: "a", sourceUrl: "https://cdn.shopify.com/v.mp4", caption: "c" };
    await expect(
      client.publishVideoFromUrl({ ...input, privacyLevel: "PUBLIC_TO_EVERYONE" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      client.publishVideoFromUrl({ ...input, privacyLevel: "SELF_ONLY" }),
    ).rejects.toBeInstanceOf(UnsafeActionError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("tiktok posting live (stubbed fetch, no network)", () => {
  const env = { TIKTOK_LOGIN_CLIENT_KEY: "ck", TIKTOK_LOGIN_CLIENT_SECRET: "cs" };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("builds the v2 authorize url with publish scopes", () => {
    const client = createLiveTikTokPostingClient({
      env,
      fetch: vi.fn(),
      rateLimiter: noopRateLimiter,
    });
    const url = new URL(client.buildAuthUrl(oauth));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("ck");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload");
  });

  it("exchanges the code with a form post and computes expiry", async () => {
    const fetch = vi.fn(async () =>
      json({
        open_id: "oid",
        scope: "user.info.basic,video.publish",
        access_token: "act",
        expires_in: 86400,
        refresh_token: "rft",
        refresh_expires_in: 31536000,
        token_type: "Bearer",
      }),
    );
    const client = createLiveTikTokPostingClient({
      env,
      fetch,
      rateLimiter: noopRateLimiter,
      now: fixedNow,
    });
    const token = await client.exchangeAuthCode({ code: "c0de", redirectUri: oauth.redirectUri });
    expect(token).toMatchObject({
      openId: "oid",
      accessToken: "act",
      refreshToken: "rft",
      expiresAt: "2026-10-26T10:00:00.000Z",
      scopes: ["user.info.basic", "video.publish"],
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(oauth.redirectUri);
  });

  it("maps invalid_grant on refresh to auth_expired", async () => {
    const fetch = vi.fn(async () =>
      json(
        { error: "invalid_grant", error_description: "Refresh token is invalid", log_id: "l" },
        400,
      ),
    );
    const client = createLiveTikTokPostingClient({ env, fetch, rateLimiter: noopRateLimiter });
    await expect(client.refreshToken({ refreshToken: "r" })).rejects.toMatchObject({
      code: "auth_expired",
    });
  });

  it("maps creator info and drops unknown privacy levels", async () => {
    const fetch = vi.fn(async () =>
      json({
        data: {
          creator_nickname: "Nick",
          creator_avatar_url: "https://p16.tiktokcdn.com/a.jpg",
          privacy_level_options: ["SELF_ONLY", "SOMETHING_NEW"],
          comment_disabled: false,
          duet_disabled: true,
          stitch_disabled: true,
          max_video_post_duration_sec: 300,
        },
        error: { code: "ok", message: "", log_id: "l" },
      }),
    );
    const client = createLiveTikTokPostingClient({ env, fetch, rateLimiter: noopRateLimiter });
    expect(await client.getCreatorInfo({ accessToken: "a" })).toEqual({
      displayName: "Nick",
      avatarUrl: "https://p16.tiktokcdn.com/a.jpg",
      privacyLevelOptions: ["SELF_ONLY"],
      maxVideoPostDurationSec: 300,
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: true,
    });
  });
});

describe("chunk plan (Media Transfer Guide)", () => {
  it("uses one chunk under the chunk size", () => {
    const p = planChunks(3 * MB);
    expect(p).toMatchObject({ chunkSize: 3 * MB, totalChunkCount: 1 });
    expect(contentRange(p.chunks[0], p.videoSize)).toBe(`bytes 0-${3 * MB - 1}/${3 * MB}`);
  });

  it("floors the count and lets the last chunk absorb the tail", () => {
    const size = 25 * MB + 7;
    const p = planChunks(size);
    expect(p.totalChunkCount).toBe(2);
    expect(p.chunks[1]).toMatchObject({ first: 10 * MB, last: size - 1 });
    expect(p.chunks.reduce((n, c) => n + c.size, 0)).toBe(size);
  });

  it("rejects bad sizes", () => {
    expect(() => planChunks(0)).toThrow();
    expect(() => planChunks(10 * MB, 1 * MB)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Live publish and status: recorded fixtures, stubbed transport              */
/* -------------------------------------------------------------------------- */

const SOURCE = "https://cdn.shopify.com/s/files/1/0001/videos/clip.mp4";
const UPLOAD = fx.video_init.data.upload_url;
const API = "https://open.tiktokapis.com/v2";

type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodySize?: number;
  body?: unknown;
};

/**
 * One stub for TikTok and the Shopify CDN. The source honours Range like
 * Shopify's CDN; TikTok's upload_url answers 206 then 201.
 */
function postingStub(opts: {
  size?: number;
  creator?: unknown;
  status?: unknown;
  head?: "ok" | "405";
  ranges?: boolean;
  put?: (chunkIndex: number, attempt: number) => number;
}) {
  const size = opts.size ?? 21 * MB + 7;
  const video = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) video[i] = i % 251;
  const calls: Call[] = [];
  const putAttempts = new Map<string, number>();
  const plan = planChunks(size);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = init?.method ?? "GET";
    const call: Call = { method, url, headers };
    calls.push(call);
    if (url === SOURCE) {
      if (method === "HEAD") {
        return opts.head === "405"
          ? new Response(null, { status: 405 })
          : new Response(null, {
              headers: { "content-length": String(size), "content-type": "video/mp4" },
            });
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.range ?? "");
      if (range && opts.ranges !== false) {
        const [a, b] = [Number(range[1]), Number(range[2])];
        return new Response(video.slice(a, b + 1), {
          status: 206,
          headers: { "content-range": `bytes ${a}-${b}/${size}`, "content-type": "video/mp4" },
        });
      }
      return new Response(video, { headers: { "content-type": "video/mp4" } });
    }
    if (url === UPLOAD) {
      const range = headers["content-range"]!;
      const index = plan.chunks.findIndex((c) => range === contentRange(c, size));
      const attempt = (putAttempts.get(range) ?? 0) + 1;
      putAttempts.set(range, attempt);
      call.bodySize = (init?.body as ArrayBuffer).byteLength;
      const status = opts.put?.(index, attempt) ?? (index === plan.totalChunkCount - 1 ? 201 : 206);
      return new Response(null, { status });
    }
    call.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url === `${API}/post/publish/creator_info/query/`) {
      return json(opts.creator ?? fx.creator_info_private);
    }
    if (url === `${API}/post/publish/video/init/`) return json(fx.video_init);
    if (url === `${API}/post/publish/status/fetch/`) {
      const st = opts.status ?? fx.status_processing;
      if (typeof st === "string") return new Response(st);
      return json(st, (st as { error?: { code: string } }).error?.code === "ok" ? 200 : 400);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  return { fetch, calls, plan, size };
}

function postingLive(
  fetch: typeof globalThis.fetch,
  extra: { rateLimiter?: RateLimiter; optIn?: boolean } = {},
) {
  return createLiveTikTokPostingClient({
    env: { TIKTOK_LOGIN_CLIENT_KEY: "ck", TIKTOK_LOGIN_CLIENT_SECRET: "cs" },
    fetch,
    sourceFetch: fetch,
    rateLimiter: extra.rateLimiter ?? noopRateLimiter,
    sleep: async () => {},
    allowStubbedSideEffectsUnderTest: extra.optIn ?? true,
  });
}

const publishInput = {
  accessToken: "act",
  sourceUrl: SOURCE,
  caption: "From trend to cart",
  privacyLevel: "SELF_ONLY" as const,
};

describe("tiktok posting live: publishVideoFromUrl (stubbed transport)", () => {
  it("queries creator info, inits FILE_UPLOAD and streams every chunk by Range", async () => {
    const { fetch, calls, plan, size } = postingStub({});
    expect(await postingLive(fetch).publishVideoFromUrl(publishInput)).toEqual({
      publishId: fx.video_init.data.publish_id,
    });
    const order = calls.map(
      (c) =>
        `${c.method} ${c.url.replace(API, "").replace(SOURCE, "source").replace(UPLOAD, "upload")}`,
    );
    expect(order).toEqual([
      "POST /post/publish/creator_info/query/",
      "HEAD source",
      "POST /post/publish/video/init/",
      "GET source",
      "PUT upload",
      "GET source",
      "PUT upload",
    ]);
    const init = calls.find((c) => c.url.endsWith("/video/init/"))!;
    expect(init.headers.authorization).toBe("Bearer act");
    expect(init.body).toEqual({
      post_info: {
        title: "From trend to cart",
        privacy_level: "SELF_ONLY",
        disable_comment: false,
        disable_duet: true,
        disable_stitch: true,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: 10 * MB,
        total_chunk_count: 2,
      },
    });
    const gets = calls.filter((c) => c.url === SOURCE && c.method === "GET");
    expect(gets.map((c) => c.headers.range)).toEqual([
      `bytes=0-${10 * MB - 1}`,
      `bytes=${10 * MB}-${size - 1}`,
    ]);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(
      puts.map((c) => [c.headers["content-range"], c.headers["content-length"], c.bodySize]),
    ).toEqual(plan.chunks.map((ch) => [contentRange(ch, size), String(ch.size), ch.size]));
    expect(puts.every((c) => c.headers["content-type"] === "video/mp4")).toBe(true);
  });

  it("a small video goes up as one whole chunk", async () => {
    const { fetch, calls } = postingStub({ size: 3 * MB });
    await postingLive(fetch).publishVideoFromUrl(publishInput);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.headers["content-range"])).toEqual([
      `bytes 0-${3 * MB - 1}/${3 * MB}`,
    ]);
  });

  it("falls back to a one-byte Range probe when HEAD is not supported", async () => {
    const { fetch, calls } = postingStub({ head: "405", size: 3 * MB });
    await postingLive(fetch).publishVideoFromUrl(publishInput);
    expect(calls.find((c) => c.url === SOURCE && c.headers.range === "bytes=0-0")).toBeTruthy();
  });

  it("retries a chunk on 5xx and stops on an expired upload URL", async () => {
    const retry = postingStub({
      put: (i, attempt) => (attempt === 1 ? 502 : i === 1 ? 201 : 206),
    });
    await postingLive(retry.fetch).publishVideoFromUrl(publishInput);
    expect(retry.calls.filter((c) => c.method === "PUT")).toHaveLength(4);

    const expired = postingStub({ put: () => 403 });
    await expect(
      postingLive(expired.fetch).publishVideoFromUrl(publishInput),
    ).rejects.toMatchObject({ code: "provider_error", retryable: false });
  });

  it("refuses a source that ignores Range on a multi-chunk upload", async () => {
    const { fetch } = postingStub({ ranges: false });
    await expect(postingLive(fetch).publishVideoFromUrl(publishInput)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("stops before init when the creator does not offer the privacy level", async () => {
    const { fetch, calls } = postingStub({ creator: fx.creator_info_no_private });
    await expect(postingLive(fetch).publishVideoFromUrl(publishInput)).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(calls.some((c) => c.url.endsWith("/video/init/"))).toBe(false);
  });

  it("stops when the creator cannot post right now (daily cap)", async () => {
    const { fetch, calls } = postingStub({ creator: fx.creator_info_spam });
    await expect(postingLive(fetch).publishVideoFromUrl(publishInput)).rejects.toMatchObject({
      code: "quota_exceeded",
    });
    expect(calls).toHaveLength(1);
  });

  it("never publishes publicly under test, even with the stub opt-in", async () => {
    const { fetch } = postingStub({});
    for (const privacyLevel of [
      "PUBLIC_TO_EVERYONE",
      "FOLLOWER_OF_CREATOR",
      "MUTUAL_FOLLOW_FRIENDS",
    ] as const) {
      await expect(
        postingLive(fetch).publishVideoFromUrl({ ...publishInput, privacyLevel }),
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is blocked without the opt-in, and the opt-in is ignored with the global fetch", async () => {
    const { fetch } = postingStub({});
    await expect(
      postingLive(fetch, { optIn: false }).publishVideoFromUrl(publishInput),
    ).rejects.toBeInstanceOf(UnsafeActionError);
    const globalFetchClient = createLiveTikTokPostingClient({
      env: { TIKTOK_LOGIN_CLIENT_KEY: "ck", TIKTOK_LOGIN_CLIENT_SECRET: "cs" },
      rateLimiter: noopRateLimiter,
      allowStubbedSideEffectsUnderTest: true,
    });
    await expect(globalFetchClient.publishVideoFromUrl(publishInput)).rejects.toBeInstanceOf(
      UnsafeActionError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a concurrent publish of the same video to the same profile", async () => {
    const { fetch, calls } = postingStub({});
    const busy: RateLimiter = { take: async () => {}, withLock: async () => null };
    await expect(
      postingLive(fetch, { rateLimiter: busy }).publishVideoFromUrl(publishInput),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls.some((c) => c.url.endsWith("/video/init/"))).toBe(false);
  });

  it("takes the creator_info and init rate buckets per token", async () => {
    const take = vi.fn(async () => {});
    const { fetch } = postingStub({ size: 3 * MB });
    await postingLive(fetch, {
      rateLimiter: { take, withLock: async (_k, _t, fn) => fn() },
    }).publishVideoFromUrl(publishInput);
    expect(take.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "posting.creator_info",
      "posting.init",
    ]);
  });
});

describe("tiktok posting live: source fetch safety (N2) and lock TTL (N10)", () => {
  it("refuses a non-https source or one with credentials before any request", async () => {
    for (const sourceUrl of [
      "http://cdn.shopify.com/v.mp4",
      "http://169.254.169.254/latest/meta-data/v.mp4",
      "file:///etc/passwd",
      "https://user:pass@cdn.shopify.com/v.mp4",
    ]) {
      const { fetch } = postingStub({});
      const sourceFetch = vi.fn();
      await expect(
        createLiveTikTokPostingClient({
          env: { TIKTOK_LOGIN_CLIENT_KEY: "ck", TIKTOK_LOGIN_CLIENT_SECRET: "cs" },
          fetch,
          sourceFetch,
          rateLimiter: noopRateLimiter,
          allowStubbedSideEffectsUnderTest: true,
        }).publishVideoFromUrl({ ...publishInput, sourceUrl }),
      ).rejects.toMatchObject({ code: "invalid_input", retryable: false });
      expect(fetch).not.toHaveBeenCalled();
      expect(sourceFetch).not.toHaveBeenCalled();
    }
  });

  it("reads the source through the SSRF-guarded client by default, never the TikTok fetch", async () => {
    guarded.ctxs.length = 0;
    guarded.calls.length = 0;
    const { fetch, calls } = postingStub({});
    const client = createLiveTikTokPostingClient({
      env: { TIKTOK_LOGIN_CLIENT_KEY: "ck", TIKTOK_LOGIN_CLIENT_SECRET: "cs" },
      fetch,
      rateLimiter: noopRateLimiter,
      sleep: async () => {},
      allowStubbedSideEffectsUnderTest: true,
    });
    // The recorder answers 404: the publish stops at the probe, before init.
    await expect(client.publishVideoFromUrl(publishInput)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(guarded.ctxs).toEqual([{ proxyUrl: undefined }]);
    expect(guarded.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `HEAD ${SOURCE}`,
      `GET ${SOURCE}`,
    ]);
    expect(calls.some((c) => c.url === SOURCE)).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/video/init/"))).toBe(false);
  });

  it("holds the publish lock for PUBLISH_LOCK_TTL_MS, shorter than the stale claim", async () => {
    // Longer than any function running a publish (maxDuration 300 s), and
    // expired before the service may take a pending claim over.
    expect(PUBLISH_LOCK_TTL_MS).toBeGreaterThan(300_000);
    expect(PUBLISH_LOCK_TTL_MS).toBeLessThan(PUBLISH_CLAIM_STALE_MS);
    const ttls: number[] = [];
    const { fetch } = postingStub({ size: 3 * MB });
    await postingLive(fetch, {
      rateLimiter: {
        take: async () => {},
        withLock: async (_k, ttl, fn) => {
          ttls.push(ttl);
          return fn();
        },
      },
    }).publishVideoFromUrl(publishInput);
    expect(ttls).toEqual([PUBLISH_LOCK_TTL_MS]);
  });
});

describe("tiktok posting live: getPublishStatus", () => {
  it("maps the status and fail reason", async () => {
    const processing = postingStub({});
    expect(
      await postingLive(processing.fetch).getPublishStatus({ accessToken: "a", publishId: "p" }),
    ).toEqual({ status: "PROCESSING_UPLOAD", postIds: [] });
    expect(processing.calls[0]!.body).toEqual({ publish_id: "p" });

    const failed = postingStub({ status: fx.status_failed });
    expect(
      await postingLive(failed.fetch).getPublishStatus({ accessToken: "a", publishId: "p" }),
    ).toEqual({ status: "FAILED", failReason: "duration_check_failed", postIds: [] });
  });

  it("keeps int64 public post ids exact", async () => {
    const raw =
      '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7431234567890123456]},"error":{"code":"ok","message":"","log_id":"l"}}';
    const { fetch } = postingStub({ status: raw });
    const st = tiktokPublishStatusSchema.parse(
      await postingLive(fetch).getPublishStatus({ accessToken: "a", publishId: "p" }),
    );
    expect(st.postIds).toEqual(["7431234567890123456"]);
  });

  it("maps an unknown publish id to not_found", async () => {
    const { fetch } = postingStub({ status: fx.status_invalid });
    await expect(
      postingLive(fetch).getPublishStatus({ accessToken: "a", publishId: "p" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mapPostingError("privacy_level_option_mismatch", 403)).toBe("permission_denied");
  });
});

describe("tiktok posting mock: mirrors live checks", () => {
  it("only accepts a privacy level the creator offers", async () => {
    const audited = createMockTikTokPostingClient({ audited: true });
    const base = { ...publishInput, accessToken: "mock-access-x" };
    await expect(
      audited.publishVideoFromUrl({ ...base, privacyLevel: "FOLLOWER_OF_CREATOR" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      audited.publishVideoFromUrl({ ...base, privacyLevel: "PUBLIC_TO_EVERYONE" }),
    ).resolves.toHaveProperty("publishId");
  });
});
