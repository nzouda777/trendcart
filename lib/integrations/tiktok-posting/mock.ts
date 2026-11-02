import { createHash } from "node:crypto";

import { z } from "zod";

import {
  IntegrationError,
  oauthStartSchema,
  tiktokPrivacyLevelSchema,
  tiktokProfileTokenSchema,
  type TikTokCreatorInfo,
  type TikTokPostingClient,
  type TikTokPublishStatus,
} from "@/lib/domain/contracts";

import { planChunks, type ChunkPlan } from "./chunks";
import { assertPrivacyAllowed, LOGIN_SCOPES, TIKTOK_POSTING_PROVIDER } from "./config";

/*
 * Deterministic in-memory Login Kit + Content Posting. Never touches the
 * network. buildAuthUrl points back at our callback with a fake code so the
 * connect flow completes locally. Enforces the same unaudited-app rule as
 * live: only SELF_ONLY unless created with { audited: true }.
 *
 * Magic inputs for tests:
 * - auth codes starting with "bad-" fail like an expired code;
 * - refresh tokens starting with "revoked-" fail like a revoked grant;
 * - access tokens starting with "expired-" fail like an expired token.
 */

export const MOCK_LOGIN_AUTH_CODE = "mock-login-auth-code";
const ACCESS_TTL_S = 86_400;
const REFRESH_TTL_S = 31_536_000;
/** Fake size of every mock source video (24 MB → 2 chunks of 10 MB + tail). */
const MOCK_VIDEO_SIZE = 24 * 1024 * 1024 + 12_345;

function digest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export type MockTikTokPostingOptions = {
  now?: () => Date;
  audited?: boolean;
};

export interface MockTikTokPostingClient extends TikTokPostingClient {
  /** Test helper: the chunk plan used for a publish. */
  chunkPlanOf(publishId: string): ChunkPlan | undefined;
}

export function createMockTikTokPostingClient(
  options: MockTikTokPostingOptions = {},
): MockTikTokPostingClient {
  const now = options.now ?? (() => new Date());
  const audited = options.audited ?? false;
  const publishes = new Map<string, { polls: number; plan: ChunkPlan }>();

  function tokenFor(openId: string, seed: string) {
    const t = now().getTime();
    return tiktokProfileTokenSchema.parse({
      openId,
      accessToken: `mock-access-${digest("access", openId, seed).slice(0, 24)}`,
      refreshToken: `mock-refresh-${digest("refresh", openId, seed).slice(0, 24)}`,
      expiresAt: new Date(t + ACCESS_TTL_S * 1000).toISOString(),
      refreshExpiresAt: new Date(t + REFRESH_TTL_S * 1000).toISOString(),
      scopes: [...LOGIN_SCOPES],
    });
  }

  function assertToken(accessToken: string) {
    if (!accessToken || accessToken.startsWith("expired-")) {
      throw new IntegrationError(TIKTOK_POSTING_PROVIDER, "auth_expired", "access_token_invalid");
    }
  }

  return {
    buildAuthUrl(oauth) {
      const { state, redirectUri } = oauthStartSchema.parse(oauth);
      const url = new URL(redirectUri);
      url.searchParams.set("code", MOCK_LOGIN_AUTH_CODE);
      url.searchParams.set("scopes", LOGIN_SCOPES.join(","));
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeAuthCode({ code, redirectUri }) {
      z.url().parse(redirectUri);
      if (!code || code.startsWith("bad-")) {
        throw new IntegrationError(TIKTOK_POSTING_PROVIDER, "auth_expired", "invalid_grant");
      }
      const openId = `mock-open-${digest("open", code).slice(0, 16)}`;
      return tokenFor(openId, code);
    },

    async refreshToken({ refreshToken }) {
      if (!refreshToken || refreshToken.startsWith("revoked-")) {
        throw new IntegrationError(TIKTOK_POSTING_PROVIDER, "auth_expired", "invalid_grant");
      }
      const openId = `mock-open-${digest("open-of", refreshToken).slice(0, 16)}`;
      // Rotate deterministically per refresh token and time.
      return tokenFor(openId, `${refreshToken}:${now().toISOString()}`);
    },

    async getCreatorInfo({ accessToken }): Promise<TikTokCreatorInfo> {
      assertToken(accessToken);
      return {
        displayName: "Mock Creator",
        avatarUrl: "https://example.com/mock-avatar.png",
        // A private account, as required for unaudited posting.
        privacyLevelOptions: ["FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
        maxVideoPostDurationSec: 600,
        commentDisabled: false,
        duetDisabled: true,
        stitchDisabled: true,
      };
    },

    async publishVideoFromUrl(input) {
      assertToken(input.accessToken);
      const { sourceUrl, caption } = z
        .object({ sourceUrl: z.url(), caption: z.string().max(2200) })
        .parse(input);
      const privacy = tiktokPrivacyLevelSchema.parse(input.privacyLevel);
      assertPrivacyAllowed(privacy, audited);
      const publishId = `v_pub_file~v2-mock.${digest(input.accessToken, sourceUrl, caption).slice(0, 20)}`;
      publishes.set(publishId, { polls: 0, plan: planChunks(MOCK_VIDEO_SIZE) });
      return { publishId };
    },

    async getPublishStatus({ accessToken, publishId }): Promise<TikTokPublishStatus> {
      assertToken(accessToken);
      const entry = publishes.get(publishId);
      if (!entry) {
        throw new IntegrationError(TIKTOK_POSTING_PROVIDER, "not_found", "invalid_publish_id");
      }
      entry.polls += 1;
      // Upload → complete. Private posts never get a public post id.
      if (entry.polls === 1) return { status: "PROCESSING_UPLOAD", postIds: [] };
      return { status: "PUBLISH_COMPLETE", postIds: [] };
    },

    chunkPlanOf(publishId) {
      return publishes.get(publishId)?.plan;
    },
  };
}
