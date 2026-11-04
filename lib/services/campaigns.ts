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
import { campaign, product } from "@/lib/db/schema";
import type { UserWorkspaceContext, WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";
import { withBudget } from "@/lib/workflows/campaign-spec";
import { evidenceOf, lockProduct, recordGateDecision } from "@/lib/workflows/gate-payloads";
import { beginAttempt, failJob, succeedJob } from "@/lib/workflows/jobs";
import { applyProductEventTo } from "@/lib/workflows/product-status";
import { describeError } from "@/lib/workflows/retry";

import { idSchema } from "./brands";
import { findProductCampaign, runningLaunch } from "./campaign-read";
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
 */

type CampaignRow = Row<typeof campaign>;

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

async function adsCall<T>(
  ctx: WorkspaceContext,
  row: CampaignRow,
  fn: (creds: TikTokAdsCredentials) => Promise<T>,
): Promise<T> {
  const creds = await getTikTokAdsCredentials(ctx, row.adConnectionId);
  try {
    return await fn(creds);
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "auth_expired") {
      await markConnectionNeedsReauth(ctx, "tiktok_ads", row.adConnectionId, error.message);
    }
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

/**
 * GATE 4: an owner or media buyer approves the launch of the paused
 * campaign, which is then enabled on TikTok.
 *
 * 1. Under the product lock: the product is ready_to_launch, its campaign is
 *    paused on TikTok and no launch is in flight (a launch job older than
 *    STALE_LAUNCH_CLAIM_MS is taken over). The approval is recorded (gate
 *    "launch"), the launch job starts, `gate.approve` is audited.
 * 2. TikTokAdsClient.launchCampaign.
 * 3. Success: launched (gate transition with the recorded approval), campaign
 *    "active" with launchedAt, job succeeded, `campaign.launch` audited.
 *    Failure: the campaign is paused again (best effort), the product enters
 *    `failed` (step "launch"), `campaign.launch` is audited with the error
 *    code, and the error is rethrown. retryStep brings it back to
 *    ready_to_launch, where a NEW GATE 4 approval is required.
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
    if (!camp || camp.status !== "paused" || !camp.tiktokIds || camp.launchedAt) {
      throw new ServiceError("invalid_state", "This product has no paused campaign to launch.");
    }
    const running = await runningLaunch(tx, row.id, now());
    if (running && !running.stale) {
      throw new ServiceError(
        "invalid_state",
        "This campaign is being launched. Try again in a moment.",
      );
    }
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "launch",
      userId,
      decision: "approved",
      note: v.note ?? null,
      payload: { campaignId: camp.id, budget: camp.config.budget },
    });
    const job = await beginAttempt(tx, row.id, "launch", now());
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.approve",
        targetType: "product",
        targetId: row.id,
        metadata: { gate: "launch", approvalId: recorded.id, campaignId: camp.id },
      },
    );
    return { row, camp, recorded, jobId: job.id };
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
    throw error;
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

async function launchedCampaign(ctx: UserWorkspaceContext, productId: string) {
  const row = await ctx.db.getById(product, productId);
  const camp = await findProductCampaign(ctx.db, row.id);
  if (row.status !== "launched" || !camp || !camp.launchedAt) {
    throw new ServiceError("invalid_state", "This product has no launched campaign.");
  }
  return { row, camp };
}

/** Pauses a launched campaign on TikTok (every entity disabled). Audited `campaign.pause`. */
export async function pauseCampaign(
  ctx: WorkspaceContext,
  input: z.input<typeof productInputSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "campaign:pause");
  const v = productInputSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const { row, camp } = await launchedCampaign(ctx, v.productId);
  if (camp.status === "active") {
    await adsCall(ctx, camp, (creds) => integrations.tiktokAds.pauseCampaign(creds, idsOf(camp)));
    await ctx.db.transaction(async (tx) => {
      await tx.update(campaign, { status: "paused" }, eq(campaign.id, camp.id));
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "campaign.pause",
          targetType: "campaign",
          targetId: camp.id,
          metadata: { productId: row.id, hasNote: !!v.note },
        },
      );
    });
  }
  return loadPipeline(ctx, row.id);
}

/**
 * Re-enables a campaign that was launched after GATE 4 and paused since
 * (owner / media buyer). Audited `campaign.launch` with { resume: true }.
 */
export async function resumeCampaign(
  ctx: WorkspaceContext,
  input: z.input<typeof productInputSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "campaign:launch");
  const v = productInputSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const { row, camp } = await launchedCampaign(ctx, v.productId);
  if (camp.status === "paused") {
    await adsCall(ctx, camp, (creds) => integrations.tiktokAds.launchCampaign(creds, idsOf(camp)));
    await ctx.db.transaction(async (tx) => {
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
  }
  return loadPipeline(ctx, row.id);
}

const budgetSchema = z.object({
  productId: idSchema,
  /** New budget amount, in the ad account currency, same mode (daily) and level. */
  amount: z.number().positive().max(1_000_000).finite(),
});

/**
 * Changes the campaign budget amount (owner / media buyer), before or after
 * the launch. Never enables anything. Needs an adapter that supports
 * TikTokAdsClient.updateBudget. Audited `campaign.budget_change` (from, to).
 */
export async function updateCampaignBudget(
  ctx: WorkspaceContext,
  input: z.input<typeof budgetSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "campaign:budget");
  const v = budgetSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const row = await ctx.db.getById(product, v.productId);
  if (row.status !== "ready_to_launch" && row.status !== "launched") {
    throw new ServiceError(
      "invalid_state",
      "This product has no campaign whose budget can change.",
    );
  }
  const camp = await findProductCampaign(ctx.db, row.id);
  if (!camp || !camp.tiktokIds || (camp.status !== "paused" && camp.status !== "active")) {
    throw new ServiceError("invalid_state", "This product has no campaign on TikTok yet.");
  }
  const update = integrations.tiktokAds.updateBudget?.bind(integrations.tiktokAds);
  if (!update) {
    throw new ServiceError("precondition_failed", "Changing the budget is not supported yet.");
  }
  const from = camp.config.budget.amount;
  if (from === v.amount) return loadPipeline(ctx, row.id);
  const config = withBudget(camp.config, v.amount);
  await adsCall(ctx, camp, (creds) => update(creds, { ids: idsOf(camp), budget: config.budget }));
  await ctx.db.transaction(async (tx) => {
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
          mode: config.budget.mode,
          level: config.budget.level,
        },
      },
    );
  });
  return loadPipeline(ctx, row.id);
}
