import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import {
  campaignIdsSchema,
  IntegrationError,
  type CampaignIds,
  type Integrations,
  type TikTokAdsCredentials,
} from "@/lib/domain/contracts";
import { brand, campaign, product, tiktokAdConnection } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";
import { withBudget } from "@/lib/workflows/campaign-spec";
import {
  evidenceOf,
  loadVideosChoice,
  lockProduct,
  recordGateDecision,
} from "@/lib/workflows/gate-payloads";

import { beginAttempt, failJob, succeedJob } from "@/lib/workflows/jobs";
import { applyProductEventTo } from "@/lib/workflows/product-status";
import { describeError } from "@/lib/workflows/retry";

import { idSchema } from "./brands";
import {
  adAccountUnusableReason,
  BUDGET_CAP_MULTIPLIER,
  dailyBudgetMinimum,
  findProductCampaign,
  isSpendingUnknown,
  MAX_DAILY_BUDGET,
  maxDailyBudget,
  runningLaunch,
} from "./campaign-read";
import { resolveIntegrations, resolveNow, resolvePipeline, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import { getTikTokAdsCredentials, markConnectionNeedsReauth } from "./internal/credentials";
import { loadPipeline } from "./pipeline";
import type { ProductPipelineDTO } from "./types";

/*
 * GATE 4 and campaign controls (M3). Nothing is enabled on TikTok without an
 * explicit GATE 4 approval by an owner or media buyer: the paused campaign is
 * created by the prepare_campaign step, and only `launchCampaign` (and
 * `resumeCampaign` on an already launched product) ever calls
 * TikTokAdsClient.launchCampaign. Every action is audited.
 *
 * Pause, resume and budget changes run under the product lock (row lock held
 * for the one TikTok call), and re-read the campaign there, so two of them, or
 * one and a launch, never interleave and the stored status always matches
 * what was last sent to TikTok.
 */

type CampaignRow = Row<typeof campaign>;
type ProductRow = Row<typeof product>;

const productInputSchema = z.object({
  productId: idSchema,
  note: z.string().trim().max(2000).optional(),
});

function errorCode(error: unknown): string {
  if (error instanceof IntegrationError || error instanceof ServiceError) return error.code;
  return "unknown";
}

function idsOf(row: CampaignRow): CampaignIds {
  const parsed = campaignIdsSchema.safeParse(row.tiktokIds);
  if (!parsed.success)
    throw new ServiceError("invalid_state", "This campaign was not created on TikTok yet.");
  return parsed.data;
}

/** Marks the ad connection red when TikTok says its token is gone. */
async function onAdsError(ctx: WorkspaceContext, row: CampaignRow, error: unknown) {
  if (error instanceof IntegrationError && error.code === "auth_expired") {
    await markConnectionNeedsReauth(ctx, "tiktok_ads", row.adConnectionId, error.message);
  }
}

async function adsCall<T>(
  ctx: WorkspaceContext,
  row: CampaignRow,
  fn: (creds: TikTokAdsCredentials) => Promise<T>,
): Promise<T> {
  const creds = await getTikTokAdsCredentials(ctx, row.adConnectionId);
  try {
    return await fn(creds);
  } catch (error) {
    await onAdsError(ctx, row, error);
    throw error;
  }
}

/**
 * Runs `fn` in a transaction holding the product lock. A TikTok auth error
 * thrown inside marks the connection red after the rollback (outside the
 * transaction, so the mark is kept).
 */
async function underProductLock<T>(
  ctx: WorkspaceContext,
  productId: string,
  fn: (tx: ScopedDb, row: ProductRow, camp: CampaignRow | null) => Promise<T>,
): Promise<T> {
  let failedOn: CampaignRow | null = null;
  try {
    return await ctx.db.transaction(async (tx) => {
      const row = await lockProduct(tx, productId);
      const camp = (await findProductCampaign(tx, row.id)) ?? null;
      failedOn = camp;
      return fn(tx, row, camp);
    });
  } catch (error) {
    if (failedOn) await onAdsError(ctx, failedOn, error);
    throw error;
  }
}

/** Best effort: puts every entity back to disabled after a failed launch. */
async function revertToPaused(
  ctx: WorkspaceContext,
  integrations: Integrations,
  row: CampaignRow,
): Promise<boolean> {
  try {
    await adsCall(ctx, row, (creds) => integrations.tiktokAds.pauseCampaign(creds, idsOf(row)));
    return true;
  } catch (error) {
    console.error("[launchCampaign] could not pause the campaign after a failed launch", error);
    return false;
  }
}

/** The error a failed launch surfaces, worded from whether the re-pause worked (S2). */
function launchFailure(error: unknown, reverted: boolean): ServiceError {
  const detail =
    error instanceof IntegrationError || error instanceof ServiceError
      ? ` (${error.message.slice(0, 300)})`
      : "";
  return reverted
    ? new ServiceError(
        "invalid_state",
        `The launch failed${detail}. The campaign was paused again: nothing is spending. Retry, then approve the launch again.`,
        { reason: "launch_failed_paused" },
      )
    : new ServiceError(
        "invalid_state",
        `The launch failed${detail}, and Trendcart could not pause the campaign again: part of it may be spending. Pause it now (Pause campaign) or in TikTok Ads Manager.`,
        { reason: "launch_failed_not_paused" },
      );
}

/**
 * GATE 4: an owner or media buyer approves the launch of the paused
 * campaign, which is then enabled on TikTok.
 *
 * 1. Under the product lock: the product is ready_to_launch, its campaign is
 *    paused on TikTok (or in the unknown state a failed re-pause left) and no
 *    launch is in flight (a launch job older than STALE_LAUNCH_CLAIM_MS is
 *    taken over). The ad account's currency is known, and when it differs
 *    from the brand's the GATE 3 rate exists. The approval is recorded (gate
 *    "launch", payload { campaignId, budget, amount, currency (advertiser),
 *    brandCurrency, fxRate }), the launch job starts, `gate.approve` is
 *    audited.
 * 2. TikTokAdsClient.launchCampaign.
 * 3. Success: launched (gate transition with the recorded approval), campaign
 *    "active" with launchedAt, job succeeded, `campaign.launch` audited.
 *    Failure: the campaign is paused again (best effort), the product enters
 *    `failed` (step "launch"), `campaign.launch` is audited with the error
 *    code and `reverted`. When the re-pause failed the campaign status
 *    becomes "failed" (DTO `spendingUnknown`). A ServiceError is thrown with
 *    reason "launch_failed_paused" or "launch_failed_not_paused". retryStep
 *    brings it back to ready_to_launch, where a NEW GATE 4 approval is
 *    required.
 */
export async function launchCampaign(
  ctx: WorkspaceContext,
  input: z.input<typeof productInputSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:launch", "campaign:launch");
  const v = productInputSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);
  const userId = ctx.actor.userId;

  const claim = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    if (row.status !== "ready_to_launch") {
      throw new ServiceError("invalid_state", "This product is not ready to launch.");
    }
    const camp = await findProductCampaign(tx, row.id);
    if (
      !camp ||
      !(camp.status === "paused" || isSpendingUnknown(camp)) ||
      !camp.tiktokIds ||
      camp.launchedAt
    ) {
      throw new ServiceError("invalid_state", "This product has no paused campaign to launch.");
    }
    const running = await runningLaunch(tx, row.id, now());
    if (running && !running.stale) {
      throw new ServiceError(
        "invalid_state",
        "This campaign is being launched. Try again in a moment.",
      );
    }
    // B1: the approved figures are in the advertiser currency TikTok spends.
    const [connection, brandRow, choice] = await Promise.all([
      tx.findById(tiktokAdConnection, camp.adConnectionId),
      tx.getById(brand, row.brandId),
      loadVideosChoice(tx, row.id),
    ]);
    if (!connection) {
      throw new ServiceError(
        "precondition_failed",
        "The TikTok Ads account of this campaign is no longer connected.",
      );
    }
    const unusable = adAccountUnusableReason(connection);
    if (unusable) throw new ServiceError("precondition_failed", unusable);
    const currency = connection.currency!;
    const fxRate = choice?.adConnectionId === connection.id && choice.fxRate ? choice.fxRate : null;
    if (currency !== brandRow.currency && fxRate === null) {
      throw new ServiceError(
        "precondition_failed",
        `This campaign's ad account bills in ${currency} but no exchange rate from ${brandRow.currency} was recorded at GATE 3: its budget was not converted. Prepare it again.`,
      );
    }

    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "launch",
      userId,
      decision: "approved",
      note: v.note ?? null,
      payload: {
        campaignId: camp.id,
        budget: camp.config.budget,
        amount: camp.config.budget.amount,
        currency,
        brandCurrency: brandRow.currency,
        fxRate,
      },
    });
    const job = await beginAttempt(tx, row.id, "launch", now());
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.approve",
        targetType: "product",
        targetId: row.id,
        metadata: {
          gate: "launch",
          approvalId: recorded.id,
          campaignId: camp.id,
          budget: camp.config.budget,
          currency,
          fxRate,
        },
      },
    );
    return { row, camp, recorded, jobId: job.id, currency };
  });

  const fail = async (error: unknown): Promise<never> => {
    const reverted = await revertToPaused(ctx, integrations, claim.camp);
    await ctx.db.transaction(async (tx) => {
      const current = await lockProduct(tx, claim.row.id);
      await failJob(tx, claim.jobId, describeError(error), now());
      if (current.status === "ready_to_launch") {
        await applyProductEventTo(tx, current, {
          type: "step_failed",
          step: "launch",
          error: describeError(error),
        });
      }
      // Paused again, or unknown: maybe partly enabled on TikTok.
      await tx.update(
        campaign,
        { status: reverted ? "paused" : "failed" },
        eq(campaign.id, claim.camp.id),
      );
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "campaign.launch",
          targetType: "campaign",
          targetId: claim.camp.id,
          metadata: {
            productId: claim.row.id,
            approvalId: claim.recorded.id,
            outcome: "failed",
            error: errorCode(error),
            reverted,
          },
        },
      );
    });
    throw launchFailure(error, reverted);
  };

  try {
    await adsCall(ctx, claim.camp, (creds) =>
      integrations.tiktokAds.launchCampaign(creds, idsOf(claim.camp)),
    );
  } catch (error) {
    return fail(error);
  }

  try {
    await ctx.db.transaction(async (tx) => {
      const current = await lockProduct(tx, claim.row.id);
      await applyProductEventTo(tx, current, {
        type: "gate_approved",
        productId: current.id,
        approval: evidenceOf(claim.recorded),
      });
      await tx.update(
        campaign,
        { status: "active", launchedAt: now() },
        eq(campaign.id, claim.camp.id),
      );
      await succeedJob(tx, claim.jobId, now());
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "campaign.launch",
          targetType: "campaign",
          targetId: claim.camp.id,
          metadata: {
            productId: claim.row.id,
            approvalId: claim.recorded.id,
            campaignId: claim.camp.tiktokIds?.campaignId ?? null,
            budget: claim.camp.config.budget,
            currency: claim.currency,
            outcome: "launched",
          },
        },
      );
    });
  } catch (error) {
    return fail(error);
  }

  await resolvePipeline(deps).continueAfterGate(ctx, claim.row.id, "launch", claim.recorded.id);
  return loadPipeline(ctx, claim.row.id, undefined, now());
}

/**
 * Pauses a campaign on TikTok (every entity disabled). Audited
 * `campaign.pause`. Applies to a launched campaign that is active, and to a
 * campaign a failed launch left in an unknown state (`spendingUnknown`,
 * whatever the product status), which it pauses again. Under the product
 * lock; a campaign already paused is left as is.
 */
export async function pauseCampaign(
  ctx: WorkspaceContext,
  input: z.input<typeof productInputSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "campaign:pause");
  const v = productInputSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);

  await underProductLock(ctx, v.productId, async (tx, row, camp) => {
    const unknown = !!camp && isSpendingUnknown(camp);
    if (!camp || (!unknown && (row.status !== "launched" || !camp.launchedAt))) {
      throw new ServiceError("invalid_state", "This product has no launched campaign.");
    }
    if (camp.status !== "active" && !unknown) return;
    if (unknown) {
      const running = await runningLaunch(tx, row.id, now());
      if (running && !running.stale) {
        throw new ServiceError(
          "invalid_state",
          "This campaign is being launched. Try again in a moment.",
        );
      }
    }
    const creds = await getTikTokAdsCredentials({ ...ctx, db: tx }, camp.adConnectionId);
    await integrations.tiktokAds.pauseCampaign(creds, idsOf(camp));
    await tx.update(campaign, { status: "paused" }, eq(campaign.id, camp.id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.pause",
        targetType: "campaign",
        targetId: camp.id,
        metadata: {
          productId: row.id,
          hasNote: !!v.note,
          ...(unknown ? { afterFailedLaunch: true } : {}),
        },
      },
    );
  });
  return loadPipeline(ctx, v.productId, undefined, now());
}

/**
 * Re-enables a campaign that was launched after GATE 4 and paused since
 * (owner / media buyer). Audited `campaign.launch` with { resume: true }.
 * Under the product lock; a campaign already active is left as is.
 */
export async function resumeCampaign(
  ctx: WorkspaceContext,
  input: z.input<typeof productInputSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "campaign:launch");
  const v = productInputSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);

  await underProductLock(ctx, v.productId, async (tx, row, camp) => {
    if (row.status !== "launched" || !camp || !camp.launchedAt) {
      throw new ServiceError("invalid_state", "This product has no launched campaign.");
    }
    if (camp.status !== "paused") return;
    const creds = await getTikTokAdsCredentials({ ...ctx, db: tx }, camp.adConnectionId);
    await integrations.tiktokAds.launchCampaign(creds, idsOf(camp));
    await tx.update(campaign, { status: "active" }, eq(campaign.id, camp.id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.launch",
        targetType: "campaign",
        targetId: camp.id,
        metadata: { productId: row.id, resume: true, outcome: "launched" },
      },
    );
  });
  return loadPipeline(ctx, v.productId, undefined, now());
}

const budgetSchema = z.object({
  productId: idSchema,
  /** New daily amount, in the ad account (advertiser) currency, same mode and level. */
  amount: z.number().positive().max(MAX_DAILY_BUDGET).finite(),
});

/**
 * Changes the campaign budget amount (owner / media buyer), at GATE 4 or
 * after the launch. Never enables anything. Under the product lock: refused
 * while a launch is in flight (the GATE 4 approval records the budget it
 * launches), under TikTok's daily minimum for the advertiser currency (when
 * known), and above `maxDailyBudget` (10x the brand default test budget,
 * converted with the GATE 3 rate).
 * TikTok refusing the amount (e.g. under its minimum) is `invalid_input` and
 * changes nothing. Audited `campaign.budget_change` (from, to, currency).
 */
export async function updateCampaignBudget(
  ctx: WorkspaceContext,
  input: z.input<typeof budgetSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "campaign:budget");
  const v = budgetSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);
  const update = integrations.tiktokAds.updateBudget?.bind(integrations.tiktokAds);
  if (!update) {
    throw new ServiceError("precondition_failed", "Changing the budget is not supported yet.");
  }

  await underProductLock(ctx, v.productId, async (tx, row, camp) => {
    if (row.status !== "ready_to_launch" && row.status !== "launched") {
      throw new ServiceError(
        "invalid_state",
        "This product has no campaign whose budget can change.",
      );
    }
    if (!camp || !camp.tiktokIds || (camp.status !== "paused" && camp.status !== "active")) {
      throw new ServiceError("invalid_state", "This product has no campaign on TikTok yet.");
    }
    const running = await runningLaunch(tx, row.id, now());
    if (running && !running.stale) {
      throw new ServiceError(
        "invalid_state",
        "This campaign is being launched. Change the budget once the launch is done.",
      );
    }
    const from = camp.config.budget.amount;
    if (from === v.amount) return;
    const [brandRow, connection, choice] = await Promise.all([
      tx.getById(brand, row.brandId),
      tx.findById(tiktokAdConnection, camp.adConnectionId),
      loadVideosChoice(tx, row.id),
    ]);
    const currency = connection?.currency ?? null;
    const fxRate = choice?.adConnectionId === camp.adConnectionId ? (choice.fxRate ?? 1) : 1;
    const cap = maxDailyBudget(brandRow.defaultTestBudget, from, fxRate);
    const unit = currency ? ` ${currency}` : "";
    if (v.amount > cap) {
      throw new ServiceError(
        "invalid_input",
        `The daily budget cannot exceed ${cap}${unit} (${BUDGET_CAP_MULTIPLIER}x the brand default test budget). Raise the brand default first.`,
      );
    }
    const min = currency ? dailyBudgetMinimum(camp.config.budget.level, currency) : undefined;
    if (min !== undefined && v.amount < min) {
      throw new ServiceError(
        "invalid_input",
        `The daily budget must be at least ${min}${unit} (TikTok's minimum); ${v.amount}${unit} is too low.`,
      );
    }
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
          from,
          to: v.amount,
          currency: connection?.currency ?? null,
          mode: config.budget.mode,
          level: config.budget.level,
        },
      },
    );
  });
  return loadPipeline(ctx, v.productId, undefined, now());
}
