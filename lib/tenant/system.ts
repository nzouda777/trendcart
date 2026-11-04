import "server-only";

import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { campaign, shopifyConnection, tiktokProfileConnection } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

import { createSystemContext, type WorkspaceContext } from "./context";

/*
 * Sanctioned entry points for background work (workflows, crons, webhooks)
 * that cannot go through a session. The cross-workspace lookups return ids
 * only, never secrets; everything after that goes through a system context
 * scoped to the row's own workspace.
 *
 * The optional trailing `db` exists for tests (PGlite); app code omits it.
 */

export type WorkspaceConnectionRef = { workspaceId: string; connectionId: string };

/**
 * Workspace-scoped context for background work. Only pass a workspace id
 * read from a trusted record (job row, verified webhook lookup, cron scan).
 */
export function getSystemContext(
  workspaceId: string,
  name: string,
  db: Database = getDb(),
): WorkspaceContext {
  return createSystemContext(db, { workspaceId, name });
}

/**
 * Every Shopify connection for a shop domain, across workspaces. Call only
 * after the webhook HMAC was verified. Order is stable (oldest first).
 */
export async function findShopifyConnectionsByShopDomain(
  shop: string,
  db: Database = getDb(),
): Promise<WorkspaceConnectionRef[]> {
  const domain = shop.trim().toLowerCase();
  if (!domain) return [];
  return db
    .select({ workspaceId: shopifyConnection.workspaceId, connectionId: shopifyConnection.id })
    .from(shopifyConnection)
    .where(eq(shopifyConnection.shopDomain, domain))
    .orderBy(asc(shopifyConnection.createdAt), asc(shopifyConnection.id));
}

/**
 * Active TikTok profile connections that hold a refresh token and whose
 * access token expires before `before` (or has no known expiry), across
 * workspaces, soonest first.
 */
export async function listDueTikTokProfileConnections(
  input: { before: Date; limit: number },
  db: Database = getDb(),
): Promise<WorkspaceConnectionRef[]> {
  const limit = Math.max(0, Math.min(Math.trunc(input.limit), 1000));
  if (limit === 0) return [];
  const t = tiktokProfileConnection;
  return db
    .select({ workspaceId: t.workspaceId, connectionId: t.id })
    .from(t)
    .where(
      and(
        eq(t.status, "active"),
        isNotNull(t.refreshTokenEnc),
        or(isNull(t.expiresAt), lt(t.expiresAt, input.before)),
      ),
    )
    .orderBy(asc(t.expiresAt), asc(t.id))
    .limit(limit);
}

export type WorkspaceCampaignRef = { workspaceId: string; campaignId: string };

/** How long a launched campaign that was paused keeps being synced (late stats). */
export const PAUSED_CAMPAIGN_SYNC_MS = 48 * 60 * 60 * 1000;

/**
 * Launched campaigns to sync hourly stats for, across workspaces (ids only):
 * every `active` campaign, plus `paused` ones that were launched and changed
 * within the last 48 hours, so their final hours land.
 *
 * Fair rotation: least recently synced first (`stats_synced_at`, never synced
 * first), then oldest launch. The sync must stamp each campaign it attempts
 * with `markCampaignStatsSynced`, success or failure, so a batch smaller than
 * the backlog still reaches every campaign.
 */
export async function listLaunchedCampaigns(
  input: { limit: number; now?: Date },
  db: Database = getDb(),
): Promise<WorkspaceCampaignRef[]> {
  const limit = Math.max(0, Math.min(Math.trunc(input.limit), 1000));
  if (limit === 0) return [];
  const since = new Date((input.now ?? new Date()).getTime() - PAUSED_CAMPAIGN_SYNC_MS);
  const c = campaign;
  return db
    .select({ workspaceId: c.workspaceId, campaignId: c.id })
    .from(c)
    .where(
      and(
        isNotNull(c.launchedAt),
        or(eq(c.status, "active"), and(eq(c.status, "paused"), gt(c.updatedAt, since))),
      ),
    )
    .orderBy(sql`${c.statsSyncedAt} asc nulls first`, asc(c.launchedAt), asc(c.id))
    .limit(limit);
}

/**
 * Records a stats sync attempt on a campaign of the context's workspace.
 * Leaves `updated_at` untouched: it dates the last real change (a pause),
 * which bounds how long a paused campaign keeps being synced.
 */
export async function markCampaignStatsSynced(
  ctx: WorkspaceContext,
  campaignId: string,
  at: Date = new Date(),
): Promise<void> {
  await ctx.db.update(
    campaign,
    {
      statsSyncedAt: at,
      // Explicit value so the $onUpdate default does not bump it.
      updatedAt: sql`${campaign.updatedAt}` as unknown as Date,
    },
    eq(campaign.id, campaignId),
  );
}
