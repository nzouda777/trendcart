import "server-only";

import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import { BUILT_IN_SETTINGS } from "@/lib/domain/campaign-presets";
import {
  campaignIdsSchema,
  IntegrationError,
  type CampaignIds,
  type CampaignSpec,
} from "@/lib/domain/contracts";
import {
  brand,
  campaign,
  campaignPreset,
  campaignStatsHourly,
  product,
  tiktokAdConnection,
} from "@/lib/db/schema";
import { currencyDecimals } from "@/lib/integrations/tiktok-ads";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";
import { buildDuplicateSpec, withBudget } from "@/lib/workflows/campaign-spec";
import { loadVideosChoice, lockProduct } from "@/lib/workflows/gate-payloads";

import { idSchema } from "./brands";
import {
  BUDGET_CAP_MULTIPLIER,
  dailyBudgetMinimum,
  MAX_DAILY_BUDGET,
  maxDailyBudget,
  STATS_WINDOW_HOURS,
  totalsOf,
} from "./campaign-read";
import { defaultPresetFor, loadPresetFor } from "./campaign-presets";
import { resolveIntegrations, resolveNow, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import { assertAccess } from "./internal/entitlements";
import { getTikTokAdsCredentials, markConnectionNeedsReauth } from "./internal/credentials";
import type { CampaignTotalsDTO } from "./types";

/*
 * Campaign duplicates. A launched campaign (the GATE 4 one, or a duplicate
 * already launched) is copied into a NEW campaign with the same ads and
 * landing page, laid out with a "duplicate" preset, created PAUSED on TikTok
 * (createPausedCampaign: every entity DISABLE). It spends only after an
 * explicit launch by a Media buyer or the Owner (`launchDuplicate`, audited
 * `campaign.launch` { duplicate: true }). Pause and budget changes mirror the
 * GATE 4 campaign's controls. All writes run under the product lock.
 */

type CampaignRow = Row<typeof campaign>;

export type CampaignDuplicateDTO = {
  id: string;
  sourceCampaignId: string;
  name: string;
  status: CampaignRow["status"];
  presetId: string | null;
  presetName: string | null;
  /** Advertiser currency (budget and totals). */
  currency: string | null;
  budget: CampaignSpec["budget"];
  adGroupCount: number;
  launchedAt: string | null;
  createdAt: string;
  totals: CampaignTotalsDTO;
  maxBudget: number;
  minBudget: number | null;
};

function idsOf(row: CampaignRow): CampaignIds {
  const parsed = campaignIdsSchema.safeParse(row.tiktokIds);
  if (!parsed.success) {
    throw new ServiceError("invalid_state", "This campaign was not created on TikTok yet.");
  }
  return parsed.data;
}

async function markIfAuthExpired(ctx: WorkspaceContext, connectionId: string, error: unknown) {
  if (error instanceof IntegrationError && error.code === "auth_expired") {
    await markConnectionNeedsReauth(ctx, "tiktok_ads", connectionId, error.message);
  }
}

/** Rate recorded at GATE 3 for this ad account (1 when equal or none). */
async function fxRateFor(db: ScopedDb, productId: string, adConnectionId: string) {
  const choice = await loadVideosChoice(db, productId);
  return choice?.adConnectionId === adConnectionId && choice.fxRate ? choice.fxRate : 1;
}

/* Read ----------------------------------------------------------------------- */

export async function listCampaignDuplicates(
  ctx: WorkspaceContext,
  productId: string,
  now: Date = new Date(),
): Promise<CampaignDuplicateDTO[]> {
  requirePermission(ctx, "campaign:read");
  const rows = await ctx.db.select(campaign, {
    where: and(eq(campaign.productId, productId), isNotNull(campaign.sourceCampaignId)),
    orderBy: (t) => asc(t.createdAt),
  });
  if (rows.length === 0) return [];
  const since = new Date(now.getTime() - STATS_WINDOW_HOURS * 3_600_000);
  const presetIds = [...new Set(rows.map((r) => r.presetId).filter((x): x is string => !!x))];
  const connectionIds = [...new Set(rows.map((r) => r.adConnectionId))];
  const [stats, presets, connections, productRow] = await Promise.all([
    ctx.db.select(campaignStatsHourly, {
      where: and(
        inArray(
          campaignStatsHourly.campaignId,
          rows.map((r) => r.id),
        ),
        gte(campaignStatsHourly.hour, since),
      ),
    }),
    presetIds.length
      ? ctx.db.select(campaignPreset, { where: inArray(campaignPreset.id, presetIds) })
      : Promise.resolve([]),
    ctx.db.select(tiktokAdConnection, { where: inArray(tiktokAdConnection.id, connectionIds) }),
    ctx.db.getById(product, productId),
  ]);
  const brandRow = await ctx.db.getById(brand, productRow.brandId);
  const fxRates = new Map<string, number>();
  for (const id of connectionIds) fxRates.set(id, await fxRateFor(ctx.db, productId, id));
  return rows.map((row) => {
    const currency = connections.find((c) => c.id === row.adConnectionId)?.currency ?? null;
    const fxRate = fxRates.get(row.adConnectionId) ?? 1;
    return {
      id: row.id,
      sourceCampaignId: row.sourceCampaignId!,
      name: row.config.name,
      status: row.status,
      presetId: row.presetId,
      presetName: presets.find((p) => p.id === row.presetId)?.name ?? null,
      currency,
      budget: row.config.budget,
      adGroupCount: row.config.adGroups.length,
      launchedAt: row.launchedAt ? row.launchedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      totals: totalsOf(
        stats
          .filter((st) => st.campaignId === row.id)
          .map((st) => ({ ...st, hour: st.hour.toISOString() })),
      ),
      maxBudget: maxDailyBudget(brandRow.defaultTestBudget, row.config.budget.amount, fxRate),
      minBudget: currency ? (dailyBudgetMinimum(row.config.budget.level, currency) ?? null) : null,
    };
  });
}

/* Duplicate ------------------------------------------------------------------ */

const duplicateSchema = z.object({
  campaignId: idSchema,
  /** "Duplicate" preset; absent = the brand default (or built-in: same budget and layout rules). */
  presetId: idSchema.optional(),
});

/**
 * Copies a launched campaign into a new PAUSED campaign with a duplicate
 * preset (Media buyer / Owner). Nothing spends until `launchDuplicate`.
 */
export async function duplicateCampaign(
  ctx: WorkspaceContext,
  input: z.input<typeof duplicateSchema>,
  deps: ServiceDeps = {},
): Promise<{ campaignId: string }> {
  requirePermission(ctx, "campaign:create");
  await assertAccess(ctx);
  const v = duplicateSchema.parse(input);
  const integrations = resolveIntegrations(deps);

  // 1. Under the product lock: checks, spec, the "creating" row.
  const claim = await ctx.db.transaction(async (tx) => {
    const source = await tx.getById(campaign, v.campaignId);
    const row = await lockProduct(tx, source.productId);
    if (!source.launchedAt || !source.tiktokIds) {
      throw new ServiceError(
        "invalid_state",
        "Only a campaign that was launched can be duplicated.",
      );
    }
    const brandRow = await tx.getById(brand, row.brandId);
    const connection = await tx.findById(tiktokAdConnection, source.adConnectionId);
    if (!connection || connection.brandId !== row.brandId) {
      throw new ServiceError(
        "precondition_failed",
        "The campaign's TikTok Ads account is no longer connected to this brand.",
      );
    }
    if (!connection.currency) {
      throw new ServiceError(
        "precondition_failed",
        "The TikTok Ads account's currency is unknown. Reconnect the ad account.",
      );
    }
    const preset = v.presetId
      ? await loadPresetFor(tx, { presetId: v.presetId, brandId: row.brandId, kind: "duplicate" })
      : await defaultPresetFor(tx, row.brandId, "duplicate");
    const rootId = source.sourceCampaignId ?? source.id;
    const copies = await tx.count(
      campaign,
      and(eq(campaign.productId, row.id), eq(campaign.sourceCampaignId, rootId)),
    );
    const fxRate = await fxRateFor(tx, row.id, source.adConnectionId);
    const spec = buildDuplicateSpec({
      source: source.config,
      copy: copies + 1,
      brandCountry: brandRow.country,
      preset: preset ?? { id: null, settings: BUILT_IN_SETTINGS },
      fxRate,
      budgetDecimals: currencyDecimals(connection.currency),
    });
    assertBudgetAllowed(spec.budget, {
      cap: maxDailyBudget(brandRow.defaultTestBudget, source.config.budget.amount, fxRate),
      currency: connection.currency,
      days: spec.totalDays,
    });
    const created = await tx.insert(campaign, {
      productId: row.id,
      adConnectionId: source.adConnectionId,
      config: spec,
      status: "creating",
      sourceCampaignId: rootId,
      presetId: preset?.id ?? null,
    });
    return { created, spec, source, presetName: preset?.name ?? null };
  });

  // 2. The paused copy on TikTok (outside the lock: several calls).
  let ids: CampaignIds;
  try {
    const creds = await getTikTokAdsCredentials(ctx, claim.created.adConnectionId);
    ids = await integrations.tiktokAds.createPausedCampaign(creds, claim.spec);
  } catch (error) {
    await markIfAuthExpired(ctx, claim.created.adConnectionId, error);
    // Nothing usable was stored: drop the row so the copy can be retried.
    await ctx.db.delete(campaign, eq(campaign.id, claim.created.id)).catch(() => undefined);
    throw error;
  }

  await ctx.db.transaction(async (tx) => {
    await tx.update(
      campaign,
      { tiktokIds: ids, status: "paused" },
      eq(campaign.id, claim.created.id),
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.duplicate",
        targetType: "campaign",
        targetId: claim.created.id,
        metadata: {
          productId: claim.source.productId,
          sourceCampaignId: claim.source.id,
          presetId: claim.created.presetId,
          presetName: claim.presetName,
          budget: claim.spec.budget,
          adGroups: claim.spec.adGroups.length,
        },
      },
    );
  });
  return { campaignId: claim.created.id };
}

function assertBudgetAllowed(
  budget: CampaignSpec["budget"],
  limits: { cap: number; currency: string; days?: number },
) {
  const daily = budget.mode === "total" ? budget.amount / (limits.days ?? 7) : budget.amount;
  if (daily > limits.cap) {
    throw new ServiceError(
      "invalid_input",
      `The daily budget cannot exceed ${limits.cap} ${limits.currency} (${BUDGET_CAP_MULTIPLIER}x the brand default test budget). Lower the preset budget or raise the brand default.`,
    );
  }
  if (budget.mode === "daily") {
    const min = dailyBudgetMinimum(budget.level, limits.currency);
    if (min !== undefined && budget.amount < min) {
      throw new ServiceError(
        "invalid_input",
        `The daily budget must be at least ${min} ${limits.currency} (TikTok's minimum).`,
      );
    }
  }
}

/* Launch, pause, budget ------------------------------------------------------ */

const duplicateActionSchema = z.object({
  campaignId: idSchema,
  note: z.string().trim().max(2000).optional(),
});

/** A duplicate under the product lock. */
async function lockedDuplicate(tx: ScopedDb, campaignId: string) {
  const found = await tx.getById(campaign, campaignId);
  const row = await lockProduct(tx, found.productId);
  const camp = await tx.getById(campaign, campaignId);
  if (!camp.sourceCampaignId) {
    throw new ServiceError("invalid_state", "Use the campaign controls above for this campaign.");
  }
  return { row, camp };
}

/**
 * Launches (or resumes) a paused duplicate: the human approval to spend
 * (Media buyer / Owner). On a TikTok failure the copy is paused again (best
 * effort) and the error is shown.
 */
export async function launchDuplicate(
  ctx: WorkspaceContext,
  input: z.input<typeof duplicateActionSchema>,
  deps: ServiceDeps = {},
): Promise<void> {
  requirePermission(ctx, "campaign:launch");
  await assertAccess(ctx);
  const v = duplicateActionSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);
  await ctx.db
    .transaction(async (tx) => {
      const { row, camp } = await lockedDuplicate(tx, v.campaignId);
      if (camp.status === "active") return;
      if (camp.status !== "paused" && camp.status !== "failed") {
        throw new ServiceError("invalid_state", "This copy is not ready on TikTok yet.");
      }
      const creds = await getTikTokAdsCredentials({ ...ctx, db: tx }, camp.adConnectionId);
      const ids = idsOf(camp);
      try {
        await integrations.tiktokAds.launchCampaign(creds, ids);
      } catch (error) {
        await integrations.tiktokAds.pauseCampaign(creds, ids).catch(() => undefined);
        throw error;
      }
      await tx.update(
        campaign,
        { status: "active", launchedAt: camp.launchedAt ?? now() },
        eq(campaign.id, camp.id),
      );
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "campaign.launch",
          targetType: "campaign",
          targetId: camp.id,
          metadata: {
            productId: row.id,
            duplicate: true,
            sourceCampaignId: camp.sourceCampaignId,
            resume: !!camp.launchedAt,
            budget: camp.config.budget,
            hasNote: !!v.note,
            outcome: "launched",
          },
        },
      );
    })
    .catch(async (error) => {
      const found = await ctx.db.findById(campaign, v.campaignId);
      if (found) await markIfAuthExpired(ctx, found.adConnectionId, error);
      throw error;
    });
}

export async function pauseDuplicate(
  ctx: WorkspaceContext,
  input: z.input<typeof duplicateActionSchema>,
  deps: ServiceDeps = {},
): Promise<void> {
  requirePermission(ctx, "campaign:pause");
  const v = duplicateActionSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  await ctx.db.transaction(async (tx) => {
    const { row, camp } = await lockedDuplicate(tx, v.campaignId);
    if (camp.status !== "active" && camp.status !== "failed") return;
    const creds = await getTikTokAdsCredentials({ ...ctx, db: tx }, camp.adConnectionId);
    await integrations.tiktokAds.pauseCampaign(creds, idsOf(camp));
    await tx.update(campaign, { status: "paused" }, eq(campaign.id, camp.id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.pause",
        targetType: "campaign",
        targetId: camp.id,
        metadata: { productId: row.id, duplicate: true, hasNote: !!v.note },
      },
    );
  });
}

const duplicateBudgetSchema = z.object({
  campaignId: idSchema,
  amount: z.number().positive().max(MAX_DAILY_BUDGET).finite(),
});

export async function updateDuplicateBudget(
  ctx: WorkspaceContext,
  input: z.input<typeof duplicateBudgetSchema>,
  deps: ServiceDeps = {},
): Promise<void> {
  requirePermission(ctx, "campaign:budget");
  const v = duplicateBudgetSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const update = integrations.tiktokAds.updateBudget?.bind(integrations.tiktokAds);
  if (!update) {
    throw new ServiceError("precondition_failed", "Changing the budget is not supported yet.");
  }
  await ctx.db.transaction(async (tx) => {
    const { row, camp } = await lockedDuplicate(tx, v.campaignId);
    if (!camp.tiktokIds || (camp.status !== "paused" && camp.status !== "active")) {
      throw new ServiceError("invalid_state", "This copy is not on TikTok yet.");
    }
    const from = camp.config.budget.amount;
    if (from === v.amount) return;
    const brandRow = await tx.getById(brand, row.brandId);
    const connection = await tx.findById(tiktokAdConnection, camp.adConnectionId);
    const currency = connection?.currency ?? "";
    const fxRate = await fxRateFor(tx, row.id, camp.adConnectionId);
    assertBudgetAllowed(
      { ...camp.config.budget, amount: v.amount },
      {
        cap: maxDailyBudget(brandRow.defaultTestBudget, from, fxRate),
        currency,
        days: camp.config.totalDays,
      },
    );
    const config = withBudget(camp.config, v.amount);
    const creds = await getTikTokAdsCredentials({ ...ctx, db: tx }, camp.adConnectionId);
    try {
      await update(creds, { ids: idsOf(camp), budget: config.budget });
    } catch (error) {
      if (error instanceof IntegrationError && error.code === "invalid_input") {
        throw new ServiceError(
          "invalid_input",
          `TikTok refused this budget: ${error.message.slice(0, 300)}`,
        );
      }
      throw error;
    }
    await tx.update(campaign, { config }, eq(campaign.id, camp.id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.budget_change",
        targetType: "campaign",
        targetId: camp.id,
        metadata: {
          productId: row.id,
          duplicate: true,
          from,
          to: v.amount,
          currency: connection?.currency ?? null,
          mode: config.budget.mode,
          level: config.budget.level,
        },
      },
    );
  });
}
