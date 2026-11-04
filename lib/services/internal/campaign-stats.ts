import "server-only";

import {
  campaignIdsSchema,
  hourlyStatSchema,
  IntegrationError,
  type TikTokAdsClient,
} from "@/lib/domain/contracts";
import { campaign, campaignStatsHourly } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { ServiceError } from "../errors";

import { getTikTokAdsCredentials, markConnectionNeedsReauth } from "./credentials";

/*
 * Hourly campaign stats (campaign_stats_hourly), synced by the
 * /api/cron/tiktok-stats cron with system contexts, one workspace at a time.
 * Not exported from lib/services (no role check: system actors only).
 */

const HOUR_MS = 3_600_000;
/** Hours re-read on every sync: TikTok keeps attributing conversions for a while. */
export const STATS_LOOKBACK_HOURS = 48;
export const STATS_BATCH_SIZE = 100;

export type CampaignRef = { workspaceId: string; campaignId: string };

/**
 * Cross-workspace scan of the campaigns to sync (ids only): launched
 * campaigns (status "active", plus "paused" ones that were launched, so the
 * last hours land). Provided by lib/tenant/system (foundation layer).
 */
export type CampaignScanner = (input: { limit: number }, db?: Database) => Promise<CampaignRef[]>;

export type StatsSyncSummary = {
  scanned: number;
  synced: number;
  hours: number;
  failed: number;
  skipped: number;
};

const floorHour = (t: number) => Math.floor(t / HOUR_MS) * HOUR_MS;

/**
 * Syncs one campaign: hourly stats from max(launch hour, now - 48 h) to now,
 * upserted by (campaign, hour). Returns the number of hours written.
 */
export async function syncCampaignStats(
  ctx: WorkspaceContext,
  ads: TikTokAdsClient,
  campaignId: string,
  now: Date,
): Promise<number> {
  const row = await ctx.db.findById(campaign, campaignId);
  if (!row || !row.launchedAt || (row.status !== "active" && row.status !== "paused")) return 0;
  const ids = campaignIdsSchema.safeParse(row.tiktokIds);
  if (!ids.success) return 0;

  const from = Math.max(
    floorHour(row.launchedAt.getTime()),
    floorHour(now.getTime()) - STATS_LOOKBACK_HOURS * HOUR_MS,
  );
  const creds = await getTikTokAdsCredentials(ctx, row.adConnectionId);
  let stats;
  try {
    stats = await ads.getHourlyStats(creds, {
      campaignId: ids.data.campaignId,
      from: new Date(from).toISOString(),
      to: now.toISOString(),
    });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "auth_expired") {
      await markConnectionNeedsReauth(ctx, "tiktok_ads", row.adConnectionId, error.message);
    }
    throw error;
  }

  let written = 0;
  for (const raw of stats) {
    const s = hourlyStatSchema.parse(raw);
    const hour = new Date(floorHour(Date.parse(s.hour)));
    const values = {
      spend: s.spend,
      impressions: s.impressions,
      clicks: s.clicks,
      conversions: s.conversions,
      revenue: s.revenue,
    };
    await ctx.db.upsert(
      campaignStatsHourly,
      { campaignId: row.id, hour, ...values },
      { target: (t) => [t.campaignId, t.hour], set: values },
    );
    written++;
  }
  return written;
}

/** Cron entry: scans launched campaigns across workspaces and syncs each one. */
export async function syncAllCampaignStats(deps: {
  scan: CampaignScanner;
  ads: TikTokAdsClient;
  context: (workspaceId: string) => WorkspaceContext;
  now?: () => Date;
  /** Tests only (PGlite). */
  db?: Database;
}): Promise<StatsSyncSummary> {
  const now = deps.now ?? (() => new Date());
  const refs = await deps.scan({ limit: STATS_BATCH_SIZE }, deps.db);
  const summary: StatsSyncSummary = {
    scanned: refs.length,
    synced: 0,
    hours: 0,
    failed: 0,
    skipped: 0,
  };
  for (const ref of refs) {
    try {
      const hours = await syncCampaignStats(
        deps.context(ref.workspaceId),
        deps.ads,
        ref.campaignId,
        now(),
      );
      if (hours > 0) {
        summary.synced++;
        summary.hours += hours;
      } else summary.skipped++;
    } catch (error) {
      summary.failed++;
      // Inactive connection: nothing to sync until it is reconnected.
      if (!(error instanceof ServiceError) && !(error instanceof IntegrationError)) {
        console.error(`[stats] campaign ${ref.campaignId} failed`, error);
      }
    }
  }
  return summary;
}
