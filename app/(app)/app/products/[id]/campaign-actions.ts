"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/components/app/action-result";
import { BUDGET_UNSUPPORTED } from "@/components/app/product/action-markers";
import {
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  updateCampaignBudget,
  type ServiceFailure,
} from "@/lib/services";

import { runAction } from "../../_lib/action";

/*
 * GATE 4 and campaign controls (M3). Nothing spends without launchCampaign
 * (GATE 4) or resumeCampaign, both owner / media buyer only (checked by the
 * services).
 */

type Messages = Partial<Record<ServiceFailure["code"], string>>;

function explain<T>(result: ActionResult<T>, messages: Messages): ActionResult<T> {
  if (result.ok) return result;
  if (result.code === "invalid_state" || result.code === "conflict") refresh();
  const message = messages[result.code];
  return message ? { ...result, error: message } : result;
}

const CAMPAIGN_FORBIDDEN = "Only a Media buyer or the Owner can do this.";

/**
 * GATE 4: approves the launch and enables the paused campaign on TikTok. A
 * TikTok failure leaves the product failed (step "launch"): the route is
 * refreshed so the failure and its retry show.
 */
export async function launchCampaignAction(
  productId: string,
  input: { note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await launchCampaign(ctx, { productId, note: input.note?.trim() || undefined });
    return undefined;
  });
  // A failed launch is invalid_state with reason launch_failed_paused or
  // launch_failed_not_paused: the service message says whether anything may
  // be spending, and explain() refreshes so the failure shows.
  if (result.ok || result.code === "integration") refresh();
  return explain(result, {
    forbidden: CAMPAIGN_FORBIDDEN,
    integration:
      "TikTok refused the launch. Check the campaign state on this screen before trying again.",
  });
}

export async function pauseCampaignAction(productId: string): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await pauseCampaign(ctx, { productId });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    forbidden: CAMPAIGN_FORBIDDEN,
    conflict: "The campaign changed in the meantime. The screen was refreshed: try again.",
  });
}

export async function resumeCampaignAction(productId: string): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await resumeCampaign(ctx, { productId });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    forbidden: CAMPAIGN_FORBIDDEN,
    conflict: "The campaign changed in the meantime. The screen was refreshed: try again.",
  });
}

/**
 * Changes the daily budget amount (ad account currency). If the TikTok
 * adapter cannot change budgets the service answers precondition_failed "not
 * supported": that failure is marked so the dialog shows it as unavailable
 * instead of offering a retry.
 */
export async function updateCampaignBudgetAction(
  productId: string,
  input: { amount: number },
): Promise<ActionResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return {
      ok: false,
      code: "invalid_input",
      error: "Enter a budget above zero.",
      fieldErrors: { amount: ["Enter a budget above zero."] },
    };
  }
  const result = await runAction(async (ctx) => {
    await updateCampaignBudget(ctx, { productId, amount: input.amount });
    return undefined;
  });
  if (result.ok) {
    refresh();
    return result;
  }
  // Only the adapter lacking updateBudget is "unavailable"; other refusals
  // (launch in flight, over the cap) keep the service message.
  if (result.code === "precondition_failed" && /not supported/i.test(result.error)) {
    return {
      ...result,
      error:
        "Changing the budget from Trendcart is not available yet. Change it in TikTok Ads Manager.",
      fieldErrors: { amount: [BUDGET_UNSUPPORTED] },
    };
  }
  return explain(result, {
    forbidden: CAMPAIGN_FORBIDDEN,
    conflict: "The campaign changed in the meantime. The screen was refreshed: try again.",
  });
}
