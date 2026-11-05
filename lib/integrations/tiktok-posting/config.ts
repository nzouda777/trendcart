import { IntegrationError, type TikTokPrivacyLevel } from "@/lib/domain/contracts";

import { isSandbox } from "../tiktok-ads/config";
import { isTestEnvironment, MissingConfigError, type Env } from "../tiktok-ads/safety";

/*
 * TikTok for Developers: Login Kit (web) + Content Posting API (v2).
 * Verified against developers.tiktok.com docs:
 * - Authorize:     https://www.tiktok.com/v2/auth/authorize/  (scope comma-separated)
 * - Token/refresh: POST https://open.tiktokapis.com/v2/oauth/token/  (form-urlencoded)
 *                  access token 24h, refresh token 365d, refresh may rotate.
 * - Creator info:  POST /v2/post/publish/creator_info/query/  (20/min per token)
 * - Direct Post:   POST /v2/post/publish/video/init/           (6/min per token)
 * - Inbox upload:  POST /v2/post/publish/inbox/video/init/
 * - Status:        POST /v2/post/publish/status/fetch/         (30/min per token)
 *
 * Unaudited clients may only post SELF_ONLY (private) content, to at most
 * 5 users per 24h, from private accounts. TIKTOK_SANDBOX=true (the default)
 * always counts as unaudited.
 */

export const TIKTOK_POSTING_PROVIDER = "tiktok_posting";
export const LOGIN_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const OPEN_API_BASE = "https://open.tiktokapis.com/v2";

/** user.info.basic: profile; video.publish: Direct Post + creator info; video.upload: inbox drafts. */
export const LOGIN_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;

/*
 * Publish concurrency (N10). One value shared with lib/services/videos.ts:
 * - PUBLISH_CLAIM_STALE_MS: a tiktok_post left "pending" longer than this
 *   may be claimed again (the service's STALE_POST_CLAIM_MS must equal it).
 * - PUBLISH_LOCK_TTL_MS: live's Upstash lock per (profile token, source).
 *   One minute shorter than the claim, so the lock has always expired when a
 *   claim becomes stale, and longer than any function that runs a publish
 *   (maxDuration 300 s), so a live publish never outlives its lock.
 */
export const PUBLISH_CLAIM_STALE_MS = 10 * 60_000;
export const PUBLISH_LOCK_TTL_MS = PUBLISH_CLAIM_STALE_MS - 60_000;

export type TikTokLoginConfig = {
  clientKey: string;
  clientSecret: string;
  sandbox: boolean;
  /** True only when TikTok has audited the app AND we are not in sandbox/tests. */
  audited: boolean;
};

export function isPostingAudited(env: Env = process.env): boolean {
  return env.TIKTOK_POSTING_AUDITED === "true" && !isSandbox(env) && !isTestEnvironment(env);
}

export function readLoginConfig(env: Env = process.env): TikTokLoginConfig {
  const clientKey = env.TIKTOK_LOGIN_CLIENT_KEY;
  const clientSecret = env.TIKTOK_LOGIN_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new MissingConfigError(TIKTOK_POSTING_PROVIDER, [
      "TIKTOK_LOGIN_CLIENT_KEY",
      "TIKTOK_LOGIN_CLIENT_SECRET",
    ]);
  }
  return { clientKey, clientSecret, sandbox: isSandbox(env), audited: isPostingAudited(env) };
}

/** Unaudited apps may only post privately. Enforced by mock and live alike. */
export function assertPrivacyAllowed(privacy: TikTokPrivacyLevel, audited: boolean) {
  if (privacy !== "SELF_ONLY" && !audited) {
    throw new IntegrationError(
      TIKTOK_POSTING_PROVIDER,
      "permission_denied",
      `Privacy ${privacy} needs an audited TikTok app; use SELF_ONLY.`,
      { retryable: false },
    );
  }
}
