import "server-only";

import { and, asc, desc, eq, gte } from "drizzle-orm";

import {
  brand,
  campaign,
  campaignStatsHourly,
  product,
  tiktokAdConnection,
  tiktokProfileConnection,
} from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";
import { minimumBudget } from "@/lib/integrations/tiktok-ads";
import { loadVideosChoice } from "@/lib/workflows/gate-payloads";
import { findOpenJob } from "@/lib/workflows/jobs";

import { USABLE_CONNECTION_STATUSES } from "./internal/credentials";

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

/**
 * A GATE 4 launch running for longer than this (the process died) may be
 * approved again. Well above any function limit (server actions 300 s,
 * workflow steps 800 s), so a launcher still alive can never have its
 * failure path pause a campaign a second launcher enabled.
 */
export const STALE_LAUNCH_CLAIM_MS = 15 * 60_000;

/** Absolute ceiling of a daily budget (advertiser currency). */
export const MAX_DAILY_BUDGET = 1_000_000;
/** A budget change may not exceed this many times the brand default test budget. */
export const BUDGET_CAP_MULTIPLIER = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Highest daily amount updateCampaignBudget accepts, in the advertiser
 * currency: BUDGET_CAP_MULTIPLIER x the brand default test budget converted
 * with the GATE 3 rate (the campaign's current amount when the brand has
 * none), never above MAX_DAILY_BUDGET.
 */
export function maxDailyBudget(
  brandDefault: number | null,
  currentAmount: number,
  fxRate = 1,
): number {
  const base = brandDefault !== null && brandDefault > 0 ? brandDefault * fxRate : currentAmount;
  return Math.min(MAX_DAILY_BUDGET, round2(base * BUDGET_CAP_MULTIPLIER));
}

/**
 * TikTok's minimum for a daily budget at `level`, in `currency`, when known
 * (MIN_DAILY_BUDGET of lib/integrations/tiktok-ads; undefined for currencies
 * TikTok documents no figure for: its own validation still refuses then).
 */
export function dailyBudgetMinimum(
  level: "campaign" | "ad_group",
  currency: string,
): number | undefined {
  return minimumBudget({ currency, level, mode: "daily" })?.amount;
}

/**
 * Why a TikTok Ads account cannot receive this brand's campaigns, or null:
 * a broken connection, or an unknown currency (connected before it was
 * stored: reconnect). Another currency than the brand's is usable with a
 * human-supplied fxRate at GATE 3 (see `needsFxRate`).
 */
export function adAccountUnusableReason(
  account: Pick<Row<typeof tiktokAdConnection>, "status" | "currency">,
): string | null {
  if (!USABLE_CONNECTION_STATUSES.has(account.status)) {
    return "This TikTok Ads account needs to be reconnected.";
  }
  if (!account.currency) {
    return "This TikTok Ads account's currency is unknown. Reconnect the ad account.";
  }
  return null;
}

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

/** The campaign status left by a failed launch whose re-pause failed too. */
export function isSpendingUnknown(row: Pick<Row<typeof campaign>, "status" | "tiktokIds">) {
  return row.status === "failed" && !!row.tiktokIds;
}

export async function loadCampaignDTO(
  ctx: WorkspaceContext,
  productId: string,
  now: Date,
): Promise<CampaignDTO | null> {
  const row = await findProductCampaign(ctx.db, productId);
  if (!row) return null;
  const since = new Date(now.getTime() - STATS_WINDOW_HOURS * 3_600_000);
  const productRow = await ctx.db.getById(product, productId);
  const [connection, stats, last, brandRow, launch, choice] = await Promise.all([
    ctx.db.findById(tiktokAdConnection, row.adConnectionId),
    ctx.db.select(campaignStatsHourly, {
      where: and(eq(campaignStatsHourly.campaignId, row.id), gte(campaignStatsHourly.hour, since)),
      orderBy: (t) => asc(t.hour),
    }),
    ctx.db.findFirst(campaignStatsHourly, eq(campaignStatsHourly.campaignId, row.id), {
      orderBy: (t) => desc(t.updatedAt),
    }),
    ctx.db.getById(brand, productRow.brandId),
    runningLaunch(ctx.db, productId, now),
    loadVideosChoice(ctx.db, productId),
  ]);
  const hourly = stats.map(toStatDTO);
  const totals = totalsOf(hourly);
  // The rate recorded at GATE 3 for this ad account (null when equal).
  const fxRate =
    choice?.adConnectionId === row.adConnectionId && choice.fxRate ? choice.fxRate : null;
  const currency = connection?.currency ?? choice?.advertiserCurrency ?? null;
  return {
    id: row.id,
    adConnectionId: row.adConnectionId,
    advertiserId: connection?.advertiserId ?? null,
    advertiserName: connection?.name ?? null,
    currency,
    brandCurrency: brandRow.currency,
    fxRate,
    totalsInBrandCurrency: fxRate
      ? {
          spend: round2(totals.spend / fxRate),
          revenue: round2(totals.revenue / fxRate),
          approximate: true,
        }
      : null,
    status: row.status,
    spendingUnknown: isSpendingUnknown(row),
    budgetUpdatable:
      !!row.tiktokIds &&
      (row.status === "paused" || row.status === "active") &&
      (productRow.status === "ready_to_launch" || productRow.status === "launched") &&
      !(launch && !launch.stale),
    maxBudget: maxDailyBudget(brandRow.defaultTestBudget, row.config.budget.amount, fxRate ?? 1),
    minBudget: currency ? (dailyBudgetMinimum(row.config.budget.level, currency) ?? null) : null,
    config: row.config,
    tiktokIds: row.tiktokIds ?? null,
    launchedAt: row.launchedAt ? row.launchedAt.toISOString() : null,
    stats: hourly,
    totals,
    statsSyncedAt: last ? last.updatedAt.toISOString() : null,
  };
}

export async function loadAdAccounts(
  db: ScopedDb,
  brandId: string,
  brandCurrency: string,
): Promise<TikTokAdAccountOptionDTO[]> {
  const rows = await db.select(tiktokAdConnection, {
    where: eq(tiktokAdConnection.brandId, brandId),
    orderBy: (t) => t.createdAt,
  });
  return rows.map((r) => {
    const reason = adAccountUnusableReason(r);
    return {
      id: r.id,
      advertiserId: r.advertiserId,
      name: r.name,
      status: r.status,
      currency: r.currency,
      usable: reason === null,
      unusableReason: reason,
      needsFxRate: !!r.currency && r.currency !== brandCurrency,
    };
  });
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
