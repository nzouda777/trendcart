import {
  campaignSpecSchema,
  IntegrationError,
  type CampaignIds,
  type CampaignSpec,
} from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";

/*
 * Budget changes (updateBudget), shared by live and mock so both refuse the
 * same inputs.
 *
 * Marketing API v1.3 (official Business API SDK models CampaignUpdateBody and
 * AdgroupUpdateBody): POST campaign/update/ {advertiser_id, campaign_id,
 * budget} and POST adgroup/update/ {advertiser_id, adgroup_id, budget}.
 * Neither body carries operation_status, and the bodies built here never do:
 * a budget change cannot enable anything. The budget mode (daily/total)
 * cannot be switched once set, so the requested mode must match the one the
 * entity already has.
 *
 * Minimums (TikTok Ads Manager help, "About budgets"): campaign daily or
 * total budget >= 50 USD, ad group daily budget >= 20 USD, ad group total
 * budget >= 20 USD per scheduled day. Floors are only enforced here for
 * currencies listed in BUDGET_FLOORS (amounts in that currency); for other
 * currencies TikTok's own validation still rejects a budget below its
 * minimum (mapped to invalid_input, nothing changed).
 */

export type BudgetFloor = { campaign: number; adGroupDaily: number };

/** Verified minimums per advertiser currency (in that currency). */
export const BUDGET_FLOORS: Readonly<Record<string, BudgetFloor>> = {
  USD: { campaign: 50, adGroupDaily: 20 },
};

/** Ad groups of a total-budget campaign are scheduled over TOTAL_BUDGET_DAYS (spec.ts). */
export function minimumBudget(
  budget: CampaignSpec["budget"],
  currency: string | undefined,
  totalDays: number,
): number | undefined {
  const floor = currency ? BUDGET_FLOORS[currency] : undefined;
  if (!floor) return undefined;
  if (budget.level === "campaign") return floor.campaign;
  return budget.mode === "daily" ? floor.adGroupDaily : floor.adGroupDaily * totalDays;
}

function invalid(message: string): never {
  throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", message, { retryable: false });
}

/** Parses the requested budget and refuses a value under TikTok's minimum. */
export function validateBudgetUpdate(
  raw: CampaignSpec["budget"],
  currency: string | undefined,
  totalDays: number,
): CampaignSpec["budget"] {
  const parsed = campaignSpecSchema.shape.budget.safeParse(raw);
  if (!parsed.success || !Number.isFinite(parsed.data.amount)) {
    invalid("Invalid budget.");
  }
  const budget = parsed.data;
  // TikTok budgets have at most two decimals.
  if (Math.abs(Math.round(budget.amount * 100) - budget.amount * 100) > 1e-6) {
    invalid("A budget has at most two decimals.");
  }
  const min = minimumBudget(budget, currency, totalDays);
  if (min !== undefined && budget.amount < min) {
    invalid(
      `The ${budget.level === "campaign" ? "campaign" : "ad group"} ${budget.mode} budget must be at least ${min} ${currency}.`,
    );
  }
  return budget;
}

export function budgetModeFor(mode: "daily" | "total") {
  return mode === "daily" ? "BUDGET_MODE_DAY" : "BUDGET_MODE_TOTAL";
}

/** Throws unless a budget update body is free of any status field. */
export function assertBudgetBodyHasNoStatus(body: Record<string, unknown>): void {
  if ("operation_status" in body || "status" in body || "opt_status" in body) {
    throw new IntegrationError(
      TIKTOK_ADS_PROVIDER,
      "invalid_input",
      "Refusing a budget update that carries a status.",
      { retryable: false },
    );
  }
}

export function campaignBudgetBody(advertiserId: string, campaignId: string, amount: number) {
  return { advertiser_id: advertiserId, campaign_id: campaignId, budget: amount };
}

export function adGroupBudgetBody(advertiserId: string, adGroupId: string, amount: number) {
  return { advertiser_id: advertiserId, adgroup_id: adGroupId, budget: amount };
}

export function allIds(ids: CampaignIds): string[] {
  return [ids.campaignId, ...ids.adGroups.flatMap((g) => [g.adGroupId, ...g.adIds])];
}
