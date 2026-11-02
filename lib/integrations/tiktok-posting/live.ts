import "server-only";

import { z } from "zod";

import {
  oauthStartSchema,
  tiktokCreatorInfoSchema,
  tiktokPrivacyLevelSchema,
  tiktokProfileTokenSchema,
  type OAuthStart,
  type TikTokCreatorInfo,
  type TikTokPostingClient,
  type TikTokProfileToken,
  type TikTokPublishStatus,
} from "@/lib/domain/contracts";

import { getRateLimiter, keyForSecret, type RateLimiter } from "../tiktok-ads/rate-limit";
import { assertNotUnderTest, NotImplementedIntegrationError, type Env } from "../tiktok-ads/safety";

import {
  assertPrivacyAllowed,
  LOGIN_AUTHORIZE_URL,
  LOGIN_SCOPES,
  OPEN_API_BASE,
  readLoginConfig,
  TIKTOK_POSTING_PROVIDER,
} from "./config";
import { oauthForm, postingJson } from "./http";

export type LiveTikTokPostingOptions = {
  fetch?: typeof fetch;
  env?: Env;
  rateLimiter?: RateLimiter;
  now?: () => Date;
};

const tokenResponseSchema = z.object({
  open_id: z.string().min(1),
  scope: z.string().default(""),
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  refresh_expires_in: z.number().int().positive().optional(),
  token_type: z.string().optional(),
});

const creatorInfoDataSchema = z.object({
  creator_avatar_url: z.string().optional(),
  creator_username: z.string().optional(),
  creator_nickname: z.string().optional(),
  privacy_level_options: z.array(z.string()).default([]),
  comment_disabled: z.boolean().default(false),
  duet_disabled: z.boolean().default(false),
  stitch_disabled: z.boolean().default(false),
  max_video_post_duration_sec: z.number().int().positive().default(60),
});

export function createLiveTikTokPostingClient(
  options: LiveTikTokPostingOptions = {},
): TikTokPostingClient {
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const limiter = () => options.rateLimiter ?? getRateLimiter(TIKTOK_POSTING_PROVIDER);
  const config = () => readLoginConfig(env);

  function toProfileToken(raw: z.infer<typeof tokenResponseSchema>): TikTokProfileToken {
    const t = now().getTime();
    return tiktokProfileTokenSchema.parse({
      openId: raw.open_id,
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: new Date(t + raw.expires_in * 1000).toISOString(),
      refreshExpiresAt: raw.refresh_expires_in
        ? new Date(t + raw.refresh_expires_in * 1000).toISOString()
        : undefined,
      scopes: raw.scope
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  return {
    buildAuthUrl(oauth: OAuthStart): string {
      const { state, redirectUri } = oauthStartSchema.parse(oauth);
      const url = new URL(LOGIN_AUTHORIZE_URL);
      url.searchParams.set("client_key", config().clientKey);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", LOGIN_SCOPES.join(","));
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeAuthCode({ code, redirectUri }) {
      const cfg = config();
      await limiter().take("login.oauth", `app:${cfg.clientKey}`);
      const raw = await oauthForm(
        fetchImpl,
        `${OPEN_API_BASE}/oauth/token/`,
        {
          client_key: cfg.clientKey,
          client_secret: cfg.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        },
        tokenResponseSchema,
      );
      return toProfileToken(raw);
    },

    async refreshToken({ refreshToken }) {
      const cfg = config();
      await limiter().take("login.oauth", `app:${cfg.clientKey}`);
      const raw = await oauthForm(
        fetchImpl,
        `${OPEN_API_BASE}/oauth/token/`,
        {
          client_key: cfg.clientKey,
          client_secret: cfg.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
        tokenResponseSchema,
      );
      // TikTok may rotate the refresh token: the caller must store the returned one.
      return toProfileToken(raw);
    },

    async getCreatorInfo({ accessToken }): Promise<TikTokCreatorInfo> {
      await limiter().take("posting.creator_info", `token:${keyForSecret(accessToken)}`);
      const data = await postingJson(
        fetchImpl,
        `${OPEN_API_BASE}/post/publish/creator_info/query/`,
        accessToken,
        {},
        creatorInfoDataSchema,
      );
      const avatar = z.url().safeParse(data.creator_avatar_url);
      return tiktokCreatorInfoSchema.parse({
        displayName: data.creator_nickname || data.creator_username || "TikTok creator",
        avatarUrl: avatar.success ? avatar.data : undefined,
        privacyLevelOptions: data.privacy_level_options.flatMap((p) => {
          const level = tiktokPrivacyLevelSchema.safeParse(p);
          return level.success ? [level.data] : [];
        }),
        maxVideoPostDurationSec: data.max_video_post_duration_sec,
        commentDisabled: data.comment_disabled,
        duetDisabled: data.duet_disabled,
        stitchDisabled: data.stitch_disabled,
      });
    },

    async publishVideoFromUrl(input): Promise<{ publishId: string }> {
      const privacy = tiktokPrivacyLevelSchema.parse(input.privacyLevel);
      // Never post publicly while unaudited, and never post at all from tests.
      assertPrivacyAllowed(privacy, config().audited);
      assertNotUnderTest(TIKTOK_POSTING_PROVIDER, "publishVideoFromUrl", env);
      // TODO(M3): HEAD sourceUrl for the size → planChunks() → POST
      // /post/publish/video/init/ (source FILE_UPLOAD, video_size, chunk_size,
      // total_chunk_count, post_info.privacy_level) → stream each Range of
      // sourceUrl and PUT it to upload_url with contentRange().
      throw new NotImplementedIntegrationError(TIKTOK_POSTING_PROVIDER, "publishVideoFromUrl");
    },

    async getPublishStatus(): Promise<TikTokPublishStatus> {
      // TODO(M3): POST /post/publish/status/fetch/ { publish_id } (rate bucket posting.status);
      // map publicaly_available_post_id (sic) to postIds.
      throw new NotImplementedIntegrationError(TIKTOK_POSTING_PROVIDER, "getPublishStatus");
    },
  };
}
