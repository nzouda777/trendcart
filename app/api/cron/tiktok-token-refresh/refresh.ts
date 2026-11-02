import "server-only";

import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { aadFor, decrypt, encrypt } from "@/lib/crypto";
import { tiktokProfileConnection } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { IntegrationError, type TikTokPostingClient } from "@/lib/domain/contracts";
import { noopRateLimiter, type RateLimiter } from "@/lib/integrations/tiktok-ads/rate-limit";
import { getSystemContext, listDueTikTokProfileConnections } from "@/lib/tenant/system";

/*
 * Refreshes TikTok profile (Login Kit) access tokens before they expire.
 * Access tokens live 24h, so with an hourly cron a 6h window gives several
 * attempts before expiry. Ads (Marketing API) tokens are long-lived and are
 * not refreshed here.
 *
 * - invalid/revoked grant → status needs_reauth + audit connection.update;
 * - transient errors → left as is, retried next run;
 * - each row is refreshed under a short lock, and re-checked inside it, so
 *   overlapping runs never rotate the same refresh token twice.
 */

export const REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
export const BATCH_SIZE = 100;
const ACTOR = "cron:tiktok-token-refresh";

export type RefreshSummary = {
  scanned: number;
  refreshed: number;
  revoked: number;
  failed: number;
  skipped: number;
};

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`. Fails closed. */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const isDue = (expiresAt: Date | null, now: Date) =>
  !expiresAt || expiresAt.getTime() < now.getTime() + REFRESH_WINDOW_MS;

export async function refreshProfileTokens(deps: {
  client: TikTokPostingClient;
  now?: () => Date;
  limiter?: RateLimiter;
  /** Tests only (PGlite); the app uses the foundation's default database. */
  db?: Database;
}): Promise<RefreshSummary> {
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? noopRateLimiter;
  const before = new Date(now().getTime() + REFRESH_WINDOW_MS);

  // Cross-workspace scan of ids only (lib/tenant/system); every read/write
  // below goes through a system context scoped to the row's own workspace.
  const due = await listDueTikTokProfileConnections({ before, limit: BATCH_SIZE }, deps.db);

  const summary: RefreshSummary = {
    scanned: due.length,
    refreshed: 0,
    revoked: 0,
    failed: 0,
    skipped: 0,
  };

  for (const { connectionId: id, workspaceId } of due) {
    const ctx = getSystemContext(workspaceId, ACTOR, deps.db);
    const outcome = await limiter.withLock(`tiktok-refresh:${id}`, 60_000, async () => {
      const row = await ctx.db.findById(tiktokProfileConnection, id);
      if (!row || row.status !== "active" || !row.refreshTokenEnc || !isDue(row.expiresAt, now())) {
        return "skipped" as const;
      }
      try {
        const refreshToken = decrypt(row.refreshTokenEnc, {
          aad: aadFor("tiktok_profile_connection", id, "refresh_token"),
        });
        const token = await deps.client.refreshToken({ refreshToken });
        await ctx.db.update(
          tiktokProfileConnection,
          {
            accessTokenEnc: encrypt(token.accessToken, {
              aad: aadFor("tiktok_profile_connection", id, "access_token"),
            }),
            // TikTok may rotate the refresh token: always store the returned one.
            refreshTokenEnc: encrypt(token.refreshToken, {
              aad: aadFor("tiktok_profile_connection", id, "refresh_token"),
            }),
            expiresAt: new Date(token.expiresAt),
          },
          (t) => eq(t.id, id),
        );
        return "refreshed" as const;
      } catch (error) {
        const revoked =
          error instanceof IntegrationError &&
          (error.code === "auth_expired" || error.code === "permission_denied");
        if (!revoked) return "failed" as const;
        await ctx.db.update(tiktokProfileConnection, { status: "needs_reauth" }, (t) =>
          eq(t.id, id),
        );
        await writeAudit(ctx, {
          action: "connection.update",
          targetType: "tiktok_profile_connection",
          targetId: id,
          metadata: { provider: "tiktok_login", status: "needs_reauth", reason: error.code },
        });
        return "revoked" as const;
      }
    });
    summary[outcome ?? "skipped"] += 1;
  }
  return summary;
}
