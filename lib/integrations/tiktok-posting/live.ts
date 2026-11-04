import "server-only";

import { z } from "zod";

import {
  oauthStartSchema,
  tiktokCreatorInfoSchema,
  tiktokPrivacyLevelSchema,
  tiktokProfileTokenSchema,
  tiktokPublishStatusSchema,
  IntegrationError,
  type OAuthStart,
  type TikTokCreatorInfo,
  type TikTokPostingClient,
  type TikTokProfileToken,
  type TikTokPublishStatus,
} from "@/lib/domain/contracts";

import { createHttpClient } from "@/lib/integrations/tiktok-data/http";

import { getRateLimiter, keyForSecret, type RateLimiter } from "../tiktok-ads/rate-limit";
import { assertNotUnderTest, realSleep, type Env } from "../tiktok-ads/safety";

import {
  assertPrivacyAllowed,
  LOGIN_AUTHORIZE_URL,
  LOGIN_SCOPES,
  OPEN_API_BASE,
  PUBLISH_LOCK_TTL_MS,
  readLoginConfig,
  TIKTOK_POSTING_PROVIDER,
} from "./config";
import { planChunks } from "./chunks";
import { oauthForm, postingJson } from "./http";
import { assertSafeSourceUrl, probeSource, transferChunks } from "./upload";

export type LiveTikTokPostingOptions = {
  /** TikTok API calls and upload_url PUTs. */
  fetch?: typeof fetch;
  /**
   * Source video reads (HEAD and Range GETs). Defaults to the SSRF-guarded
   * client (lib/integrations/tiktok-data/http, as the Shopify video upload
   * uses), never to `fetch`: tests inject both.
   */
  sourceFetch?: typeof fetch;
  env?: Env;
  rateLimiter?: RateLimiter;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Test-only: lets publishVideoFromUrl run under vitest when `fetch` is an
   * injected stub (never the global fetch). SELF_ONLY only: the app never
   * counts as audited under test. Ignored outside tests.
   */
  allowStubbedSideEffectsUnderTest?: boolean;
};

const publishInputSchema = z.object({
  accessToken: z.string().min(1),
  sourceUrl: z.url(),
  /** TikTok title: at most 2200 UTF-16 code units. */
  caption: z.string().max(2200),
  privacyLevel: tiktokPrivacyLevelSchema,
});

const initDataSchema = z.object({
  publish_id: z.string().min(1).max(64),
  upload_url: z.url(),
});

const statusDataSchema = z.object({
  status: z.enum([
    "PROCESSING_UPLOAD",
    "PROCESSING_DOWNLOAD",
    "SEND_TO_USER_INBOX",
    "PUBLISH_COMPLETE",
    "FAILED",
  ]),
  fail_reason: z.string().nullish(),
  publicaly_available_post_id: z
    .array(z.union([z.string(), z.number()]))
    .nullish()
    .transform((v) => v ?? []),
});

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

/** Long enough for one 10 MB chunk on a slow CDN; the probe is tiny. */
const SOURCE_TIMEOUT_MS = 60_000;

/**
 * No brand proxy here: publishVideoFromUrl's contract input carries none.
 * The guarded agent refuses non-public addresses on every hop.
 */
function guardedSourceFetch(): typeof fetch {
  const http = createHttpClient({ proxyUrl: undefined }, { timeoutMs: SOURCE_TIMEOUT_MS });
  // undici's Response is the platform Response at runtime.
  return ((url: string | URL | Request, init?: RequestInit) =>
    http(
      url instanceof Request ? url.url : url,
      init as Parameters<typeof http>[1],
    )) as unknown as typeof fetch;
}

export function createLiveTikTokPostingClient(
  options: LiveTikTokPostingOptions = {},
): TikTokPostingClient {
  const fetchImpl = options.fetch ?? fetch;
  const sourceFetch = options.sourceFetch ?? guardedSourceFetch();
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? realSleep;
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

  const client: TikTokPostingClient = {
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

    async publishVideoFromUrl(rawInput): Promise<{ publishId: string }> {
      const input = publishInputSchema.parse(rawInput);
      // Before any request (N2): https only, no credentials.
      assertSafeSourceUrl(input.sourceUrl);
      const privacy = input.privacyLevel;
      // Never post publicly while unaudited, and never post at all from tests
      // (a test may opt in only with an injected fetch stub).
      assertPrivacyAllowed(privacy, config().audited);
      assertNotUnderTest(TIKTOK_POSTING_PROVIDER, "publishVideoFromUrl", env, {
        injectedFetch: options.fetch,
        allowStubbedSideEffectsUnderTest: options.allowStubbedSideEffectsUnderTest,
      });
      const tokenKey = keyForSecret(input.accessToken);

      // 1. Creator info right before posting (Direct Post UX rules): the
      //    creator must be able to post now and offer the privacy level.
      const creator = await client.getCreatorInfo({ accessToken: input.accessToken });
      if (!creator.privacyLevelOptions.includes(privacy)) {
        throw new IntegrationError(
          TIKTOK_POSTING_PROVIDER,
          "permission_denied",
          `This TikTok account does not offer ${privacy}${privacy === "SELF_ONLY" ? "" : " (unaudited apps need a private account)"}.`,
          { retryable: false },
        );
      }

      // 2. Size and type of the Shopify file, then the chunk plan.
      const source = await probeSource(sourceFetch, input.sourceUrl);
      const plan = planChunks(source.size);

      // One publish per (profile, source) at a time: a double click or a
      // concurrent retry must not post the same video twice. The TTL is
      // shorter than the service's stale post claim (PUBLISH_CLAIM_STALE_MS),
      // so a claim taken over as stale never meets this lock still held.
      const result = await limiter().withLock(
        `tiktok:publish:${tokenKey}:${keyForSecret(input.sourceUrl)}`,
        PUBLISH_LOCK_TTL_MS,
        async () => {
          // 3. Init. Not retried on ambiguous errors: it is not idempotent.
          await limiter().take("posting.init", `token:${tokenKey}`);
          const init = await postingJson(
            fetchImpl,
            `${OPEN_API_BASE}/post/publish/video/init/`,
            input.accessToken,
            {
              post_info: {
                title: input.caption,
                privacy_level: privacy,
                disable_comment: creator.commentDisabled,
                disable_duet: creator.duetDisabled,
                disable_stitch: creator.stitchDisabled,
              },
              source_info: {
                source: "FILE_UPLOAD",
                video_size: plan.videoSize,
                chunk_size: plan.chunkSize,
                total_chunk_count: plan.totalChunkCount,
              },
            },
            initDataSchema,
          );
          // 4. Stream the chunks from the source to TikTok.
          await transferChunks({
            fetchImpl,
            sourceFetch,
            sourceUrl: input.sourceUrl,
            uploadUrl: init.upload_url,
            plan,
            contentType: source.contentType,
            sleep,
          });
          return { publishId: init.publish_id };
        },
      );
      if (!result) {
        throw new IntegrationError(
          TIKTOK_POSTING_PROVIDER,
          "invalid_input",
          "This video is already being published to this profile.",
          { retryable: false },
        );
      }
      return result;
    },

    async getPublishStatus({ accessToken, publishId }): Promise<TikTokPublishStatus> {
      z.string().min(1).max(64).parse(publishId);
      await limiter().take("posting.status", `token:${keyForSecret(accessToken)}`);
      const data = await postingJson(
        fetchImpl,
        `${OPEN_API_BASE}/post/publish/status/fetch/`,
        accessToken,
        { publish_id: publishId },
        statusDataSchema,
      );
      return tiktokPublishStatusSchema.parse({
        status: data.status,
        failReason: data.fail_reason || undefined,
        // Only public posts that passed moderation get ids (sic: "publicaly").
        postIds: data.publicaly_available_post_id.map(String),
      });
    },
  };
  return client;
}
