import "server-only";

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/guards";
import type { CampaignSpec, ProductStatus } from "@/lib/domain/contracts";
import {
  brand,
  campaign,
  campaignPreset,
  campaignStatsHourly,
  product,
  tiktokAdConnection,
} from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";
import { loadVideosChoice } from "@/lib/workflows/gate-payloads";

import { idSchema } from "./brands";
import {
  dailyBudgetMinimum,
  isSpendingUnknown,
  maxDailyBudget,
  STATS_WINDOW_HOURS,
  totalsOf,
} from "./campaign-read";
import type { CampaignTotalsDTO } from "./types";

/*
 * Every campaign of the workspace in one list (the Campaigns screen): the
 * GATE 4 campaign of each product (latest per product, the one the product
 * controls act on) and its duplicates. Read only; actions stay in
 * campaigns.ts / campaign-duplicates.ts, which re-check roles and state.
 */

type CampaignRow = Row<typeof campaign>;

export const CAMPAIGN_LIST_FILTERS = ["all", "active", "paused", "to_launch", "failed"] as const;
export type CampaignListFilter = (typeof CAMPAIGN_LIST_FILTERS)[number];

/** Most campaigns returned (newest first). */
export const CAMPAIGN_LIST_LIMIT = 200;

export type CampaignListItemDTO = {
  id: string;
  kind: "main" | "duplicate";
  sourceCampaignId: string | null;
  name: string;
  status: CampaignRow["status"];
  /** Failed launch whose re-pause failed too: may be spending. */
  spendingUnknown: boolean;
  /** Created on TikTok (has ids). */
  onTikTok: boolean;
  launchedAt: string | null;
  createdAt: string;
  productId: string;
  productName: string | null;
  productStatus: ProductStatus;
  brandId: string;
  brandName: string;
  advertiserName: string | null;
  /** Advertiser currency (budget and totals). */
  currency: string | null;
  budget: CampaignSpec["budget"];
  adGroupCount: number;
  presetName: string | null;
  /** Totals of the last STATS_WINDOW_HOURS hours. */
  totals: CampaignTotalsDTO;
  maxBudget: number;
  minBudget: number | null;
  budgetUpdatable: boolean;
};

const listSchema = z.object({
  brandId: idSchema.optional(),
  filter: z.enum(CAMPAIGN_LIST_FILTERS).default("all"),
});

function matches(item: CampaignListItemDTO, filter: CampaignListFilter) {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return item.status === "active";
    case "paused":
      return item.status === "paused" && !!item.launchedAt;
    case "to_launch":
      return (
        (item.status === "paused" && !item.launchedAt) ||
        (item.kind === "main" && item.productStatus === "ready_to_launch")
      );
    case "failed":
      return item.status === "failed";
  }
}

export async function listWorkspaceCampaigns(
  ctx: WorkspaceContext,
  input: z.input<typeof listSchema> = {},
  now: Date = new Date(),
): Promise<CampaignListItemDTO[]> {
  requirePermission(ctx, "campaign:read");
  const v = listSchema.parse(input);

  const products = await ctx.db.select(product, {
    where: v.brandId ? eq(product.brandId, v.brandId) : undefined,
  });
  if (products.length === 0) return [];
  const productIds = products.map((p) => p.id);
  const rows = await ctx.db.select(campaign, {
    where: inArray(campaign.productId, productIds),
    orderBy: (t) => desc(t.createdAt),
    limit: CAMPAIGN_LIST_LIMIT,
  });
  // Keep the latest GATE 4 campaign per product (the one its controls act on).
  const seenMain = new Set<string>();
  const kept = rows.filter((r) => {
    if (r.sourceCampaignId) return true;
    if (seenMain.has(r.productId)) return false;
    seenMain.add(r.productId);
    return true;
  });
  if (kept.length === 0) return [];

  const since = new Date(now.getTime() - STATS_WINDOW_HOURS * 3_600_000);
  const brandIds = [...new Set(products.map((p) => p.brandId))];
  const connectionIds = [...new Set(kept.map((r) => r.adConnectionId))];
  const presetIds = [...new Set(kept.map((r) => r.presetId).filter((x): x is string => !!x))];
  const usedProductIds = [...new Set(kept.map((r) => r.productId))];
  const [brands, connections, presets, stats, choices] = await Promise.all([
    ctx.db.select(brand, { where: inArray(brand.id, brandIds) }),
    ctx.db.select(tiktokAdConnection, { where: inArray(tiktokAdConnection.id, connectionIds) }),
    presetIds.length
      ? ctx.db.select(campaignPreset, { where: inArray(campaignPreset.id, presetIds) })
      : Promise.resolve([]),
    ctx.db.select(campaignStatsHourly, {
      where: and(
        inArray(
          campaignStatsHourly.campaignId,
          kept.map((r) => r.id),
        ),
        gte(campaignStatsHourly.hour, since),
      ),
    }),
    Promise.all(
      usedProductIds.map(async (id) => [id, await loadVideosChoice(ctx.db, id)] as const),
    ),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const choiceByProduct = new Map(choices);

  const items = kept.map((row): CampaignListItemDTO => {
    const p = productById.get(row.productId)!;
    const b = brandById.get(p.brandId);
    const connection = connections.find((c) => c.id === row.adConnectionId);
    const currency = connection?.currency ?? null;
    const choice = choiceByProduct.get(row.productId);
    // The GATE 3 rate for this ad account (1 when equal or none).
    const fxRate =
      choice?.adConnectionId === row.adConnectionId && choice.fxRate ? choice.fxRate : 1;
    const main = !row.sourceCampaignId;
    const editable = !!row.tiktokIds && (row.status === "paused" || row.status === "active");
    return {
      id: row.id,
      kind: main ? "main" : "duplicate",
      sourceCampaignId: row.sourceCampaignId,
      name: row.config.name,
      status: row.status,
      spendingUnknown: isSpendingUnknown(row),
      onTikTok: !!row.tiktokIds,
      launchedAt: row.launchedAt ? row.launchedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      productId: p.id,
      productName: p.name,
      productStatus: p.status,
      brandId: p.brandId,
      brandName: b?.name ?? "",
      advertiserName: connection?.name ?? null,
      currency,
      budget: row.config.budget,
      adGroupCount: row.config.adGroups.length,
      presetName: presets.find((x) => x.id === row.presetId)?.name ?? null,
      totals: totalsOf(
        stats
          .filter((s) => s.campaignId === row.id)
          .map((s) => ({ ...s, hour: s.hour.toISOString() })),
      ),
      maxBudget: maxDailyBudget(b?.defaultTestBudget ?? null, row.config.budget.amount, fxRate),
      minBudget: currency ? (dailyBudgetMinimum(row.config.budget.level, currency) ?? null) : null,
      budgetUpdatable: main
        ? editable && (p.status === "ready_to_launch" || p.status === "launched")
        : editable,
    };
  });
  return items.filter((i) => matches(i, v.filter));
}
