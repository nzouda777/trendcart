import { describe, expect, it, vi } from "vitest";

import {
  tiktokCreatorInfoSchema,
  tiktokProfileTokenSchema,
  tiktokPublishStatusSchema,
  type TikTokPrivacyLevel,
} from "@/lib/domain/contracts";

import { noopRateLimiter } from "../tiktok-ads/rate-limit";
import { UnsafeActionError } from "../tiktok-ads/safety";

import { contentRange, MB, planChunks } from "./chunks";
import { isPostingAudited } from "./config";
import { createLiveTikTokPostingClient } from "./live";
import { createMockTikTokPostingClient, MOCK_LOGIN_AUTH_CODE } from "./mock";

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
