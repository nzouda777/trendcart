import "server-only";

import { and, asc, desc, eq, gte } from "drizzle-orm";

import {
  campaign,
  campaignStatsHourly,
  tiktokAdConnection,
  tiktokProfileConnection,
} from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";
import { LEASE_TTL_MS } from "@/lib/workflows/concurrency";
import { findOpenJob } from "@/lib/workflows/jobs";

import type {
  CampaignDTO,
  CampaignStatDTO,
  CampaignTotalsDTO,
  TikTokAdAccountOptionDTO,
  TikTokProfileOptionDTO,
} from "./types";

/*
 * Read models of M3 (campaign, stats, TikTok accounts) for the product
 * pipeline DTO. No role checks: callers checked product:read.
 */

/** Hours of hourly stats returned with a campaign. */
export const STATS_WINDOW_HOURS = 72;

/** A GATE 4 launch running for longer than this (the process died) may be approved again. */
export const STALE_LAUNCH_CLAIM_MS = LEASE_TTL_MS;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function totalsOf(stats: readonly CampaignStatDTO[]): CampaignTotalsDTO {
  const sum = stats.reduce(
    (acc, s) => ({
      spend: acc.spend + s.spend,
      impressions: acc.impressions + s.impressions,
      clicks: acc.clicks + s.clicks,
      conversions: acc.conversions + s.conversions,
      revenue: acc.revenue + s.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
  );
  return {
    ...sum,
    spend: round2(sum.spend),
    revenue: round2(sum.revenue),
    roas: sum.spend > 0 ? round2(sum.revenue / sum.spend) : null,
    ctr: sum.impressions > 0 ? Math.round((sum.clicks / sum.impressions) * 10_000) / 10_000 : null,
  };
}

function toStatDTO(r: Row<typeof campaignStatsHourly>): CampaignStatDTO {
  return {
    hour: r.hour.toISOString(),
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    revenue: r.revenue,
  };
}

/** The product's campaign (latest), or null. */
export async function findProductCampaign(db: ScopedDb, productId: string) {
  return db.findFirst(campaign, eq(campaign.productId, productId), {
    orderBy: (t) => desc(t.createdAt),
  });
}

export async function loadCampaignDTO(
  ctx: WorkspaceContext,
  productId: string,
  now: Date,
): Promise<CampaignDTO | null> {
  const row = await findProductCampaign(ctx.db, productId);
  if (!row) return null;
  const since = new Date(now.getTime() - STATS_WINDOW_HOURS * 3_600_000);
  const [connection, stats, last] = await Promise.all([
    ctx.db.findById(tiktokAdConnection, row.adConnectionId),
    ctx.db.select(campaignStatsHourly, {
      where: and(eq(campaignStatsHourly.campaignId, row.id), gte(campaignStatsHourly.hour, since)),
      orderBy: (t) => asc(t.hour),
    }),
    ctx.db.findFirst(campaignStatsHourly, eq(campaignStatsHourly.campaignId, row.id), {
      orderBy: (t) => desc(t.updatedAt),
    }),
  ]);
  const hourly = stats.map(toStatDTO);
  return {
    id: row.id,
    adConnectionId: row.adConnectionId,
    advertiserId: connection?.advertiserId ?? null,
    advertiserName: connection?.name ?? null,
    status: row.status,
    config: row.config,
    tiktokIds: row.tiktokIds ?? null,
    launchedAt: row.launchedAt ? row.launchedAt.toISOString() : null,
    stats: hourly,
    totals: totalsOf(hourly),
    statsSyncedAt: last ? last.updatedAt.toISOString() : null,
  };
}

export async function loadAdAccounts(
  db: ScopedDb,
  brandId: string,
): Promise<TikTokAdAccountOptionDTO[]> {
  const rows = await db.select(tiktokAdConnection, {
    where: eq(tiktokAdConnection.brandId, brandId),
    orderBy: (t) => t.createdAt,
  });
  return rows.map((r) => ({
    id: r.id,
    advertiserId: r.advertiserId,
    name: r.name,
    status: r.status,
  }));
}

export async function loadProfiles(
  db: ScopedDb,
  brandId: string,
): Promise<TikTokProfileOptionDTO[]> {
  const rows = await db.select(tiktokProfileConnection, {
    where: eq(tiktokProfileConnection.brandId, brandId),
    orderBy: (t) => t.createdAt,
  });
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    status: r.status,
    postingMode: r.postingMode,
  }));
}

/** The launch job of a product while it runs (GATE 4 approved, TikTok call in flight). */
export async function runningLaunch(db: ScopedDb, productId: string, now: Date) {
  const open = await findOpenJob(db, productId, "launch");
  if (!open || open.status !== "running") return null;
  const startedAt = open.updatedAt;
  return {
    job: open,
    startedAt,
    stale: now.getTime() - startedAt.getTime() > STALE_LAUNCH_CLAIM_MS,
  };
}
