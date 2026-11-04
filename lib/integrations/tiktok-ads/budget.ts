import {
  campaignSpecSchema,
  IntegrationError,
  type CampaignIds,
  type CampaignSpec,
} from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";
import { TOTAL_BUDGET_DAYS } from "./spec";

/*
 * Budgets: minimums, precision and updates. Shared by live and mock so both
 * refuse the same inputs, and by the workflow (minimumBudget,
 * currencyDecimals) to check and round a converted budget before it is sent.
 *
 * Marketing API v1.3 (official Business API SDK models CampaignUpdateBody and
 * AdgroupUpdateBody): POST campaign/update/ {advertiser_id, campaign_id,
 * budget} and POST adgroup/update/ {advertiser_id, adgroup_id, budget}.
 * Neither body carries operation_status, and the bodies built here never do:
 * a budget change cannot enable anything. The budget mode (daily/total)
 * cannot be switched once set, so the requested mode must match the one the
 * entity already has.
 *
 * Sources (official TikTok API for Business docs, v1.3, checked 2026-11-04):
 * - "Budget verification ratio and value range for each currency"
 *   https://business-api.tiktok.com/portal/docs?id=1737585839634433
 *   Daily minimum (inclusive) per currency = base minimum x the currency's
 *   Budget Verification Ratio; base 50 for campaigns and 20 for ad groups
 *   (other than PRODUCT_SALES with a STORE/SHOWCASE product source, which
 *   we never create). MIN_DAILY_BUDGET is copied from that page's two
 *   per-currency tables ("At the campaign level", "At the ad group level";
 *   columns "for other campaigns" / "for other ad groups"), and every row
 *   was cross-checked against base x ratio. Nothing here is converted or
 *   derived from FX rates.
 * - "Budget" (budget setting guidelines)
 *   https://business-api.tiktok.com/portal/docs?id=1739381246298114
 *   Campaign daily and lifetime budgets share one minimum; an ad group
 *   lifetime minimum is its daily minimum x scheduled days. That page states
 *   a campaign base of 20 where the currency page and the Ads Manager help
 *   center (https://ads.tiktok.com/help/article/budget) state 50: we keep
 *   the stricter 50. Updates must also stay >= 105% of the current spend;
 *   that rule is left to TikTok's validation.
 * - "Currency-specific precision"
 *   https://business-api.tiktok.com/portal/docs?id=1772544628718594
 *   CURRENCY_DECIMALS (it agrees with the precision column of the
 *   verification-ratio table for every currency both pages list).
 *
 * Currencies absent from MIN_DAILY_BUDGET get no local minimum check
 * (minimumBudget returns null): TikTok's own validation still rejects a
 * budget below its minimum (mapped to invalid_input, nothing changed).
 */

export type MinDailyBudget = { campaignDaily: number; adGroupDaily: number };

/** Official minimum daily budgets (inclusive), in the advertiser currency. */
export const MIN_DAILY_BUDGET: Readonly<Record<string, MinDailyBudget>> = {
  AED: { campaignDaily: 50, adGroupDaily: 20 },
  ARS: { campaignDaily: 50, adGroupDaily: 20 },
  AUD: { campaignDaily: 50, adGroupDaily: 20 },
  BDT: { campaignDaily: 5000, adGroupDaily: 2000 },
  BOB: { campaignDaily: 500, adGroupDaily: 200 },
  BRL: { campaignDaily: 50, adGroupDaily: 20 },
  CAD: { campaignDaily: 50, adGroupDaily: 20 },
  CHF: { campaignDaily: 50, adGroupDaily: 20 },
  CLP: { campaignDaily: 50_000, adGroupDaily: 20_000 },
  CNY: { campaignDaily: 500, adGroupDaily: 200 },
  COP: { campaignDaily: 50_000, adGroupDaily: 20_000 },
  CRC: { campaignDaily: 50_000, adGroupDaily: 20_000 },
  CZK: { campaignDaily: 500, adGroupDaily: 200 },
  DKK: { campaignDaily: 500, adGroupDaily: 200 },
  DZD: { campaignDaily: 5000, adGroupDaily: 2000 },
  EGP: { campaignDaily: 500, adGroupDaily: 200 },
  EUR: { campaignDaily: 50, adGroupDaily: 20 },
  GBP: { campaignDaily: 50, adGroupDaily: 20 },
  GTQ: { campaignDaily: 500, adGroupDaily: 200 },
  HKD: { campaignDaily: 500, adGroupDaily: 200 },
  HNL: { campaignDaily: 500, adGroupDaily: 200 },
  HUF: { campaignDaily: 50, adGroupDaily: 20 },
  IDR: { campaignDaily: 500_000, adGroupDaily: 200_000 },
  ILS: { campaignDaily: 50, adGroupDaily: 20 },
  INR: { campaignDaily: 5000, adGroupDaily: 2000 },
  ISK: { campaignDaily: 5000, adGroupDaily: 2000 },
  JPY: { campaignDaily: 5000, adGroupDaily: 2000 },
  KES: { campaignDaily: 5000, adGroupDaily: 2000 },
  KRW: { campaignDaily: 50_000, adGroupDaily: 20_000 },
  MOP: { campaignDaily: 500, adGroupDaily: 200 },
  MXN: { campaignDaily: 500, adGroupDaily: 200 },
  MYR: { campaignDaily: 50, adGroupDaily: 20 },
  NGN: { campaignDaily: 5000, adGroupDaily: 2000 },
  NIO: { campaignDaily: 500, adGroupDaily: 200 },
  NOK: { campaignDaily: 500, adGroupDaily: 200 },
  NZD: { campaignDaily: 50, adGroupDaily: 20 },
  PEN: { campaignDaily: 50, adGroupDaily: 20 },
  PHP: { campaignDaily: 2500, adGroupDaily: 1000 },
  PKR: { campaignDaily: 5000, adGroupDaily: 2000 },
  PLN: { campaignDaily: 200, adGroupDaily: 80 },
  PYG: { campaignDaily: 500_000, adGroupDaily: 200_000 },
  QAR: { campaignDaily: 50, adGroupDaily: 20 },
  RON: { campaignDaily: 50, adGroupDaily: 20 },
  RUB: { campaignDaily: 5000, adGroupDaily: 2000 },
  SAR: { campaignDaily: 50, adGroupDaily: 20 },
  SEK: { campaignDaily: 500, adGroupDaily: 200 },
  SGD: { campaignDaily: 50, adGroupDaily: 20 },
  THB: { campaignDaily: 500, adGroupDaily: 200 },
  TRY: { campaignDaily: 500, adGroupDaily: 200 },
  TWD: { campaignDaily: 500, adGroupDaily: 200 },
  UAH: { campaignDaily: 500, adGroupDaily: 200 },
  USD: { campaignDaily: 50, adGroupDaily: 20 },
  UYU: { campaignDaily: 500, adGroupDaily: 200 },
  VEF: { campaignDaily: 5_000_000, adGroupDaily: 2_000_000 },
  VND: { campaignDaily: 500_000, adGroupDaily: 200_000 },
  ZAR: { campaignDaily: 500, adGroupDaily: 200 },
};

/** Official budget precision per currency, as decimal places. */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  // Precision 1.
  CLP: 0,
  HUF: 0,
  IDR: 0,
  ISK: 0,
  JPY: 0,
  KHR: 0,
  KRW: 0,
  PYG: 0,
  TWD: 0,
  UGX: 0,
  VND: 0,
  XAF: 0,
  // Precision 0.001.
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  TND: 3,
  // Precision 0.01.
  AED: 2,
  ALL: 2,
  AOA: 2,
  ARS: 2,
  AUD: 2,
  BAM: 2,
  BDT: 2,
  BGN: 2,
  BHD: 2,
  BND: 2,
  BOB: 2,
  BRL: 2,
  BWP: 2,
  BYN: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  COP: 2,
  CRC: 2,
  CZK: 2,
  DKK: 2,
  DZD: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  GHS: 2,
  GTQ: 2,
  GYD: 2,
  HKD: 2,
  HNL: 2,
  HRK: 2,
  ILS: 2,
  INR: 2,
  IRR: 2,
  KES: 2,
  KZT: 2,
  LAK: 2,
  LBP: 2,
  LKR: 2,
  MAD: 2,
  MDL: 2,
  MKD: 2,
  MMK: 2,
  MNT: 2,
  MOP: 2,
  MUR: 2,
  MVR: 2,
  MWK: 2,
  MXN: 2,
  MYR: 2,
  NGN: 2,
  NIO: 2,
  NOK: 2,
  NPR: 2,
  NZD: 2,
  OMR: 2,
  PEN: 2,
  PHP: 2,
  PKR: 2,
  PLN: 2,
  QAR: 2,
  RON: 2,
  RSD: 2,
  RUB: 2,
  SAR: 2,
  SDG: 2,
  SEK: 2,
  SGD: 2,
  SLL: 2,
  SRD: 2,
  SSP: 2,
  SYP: 2,
  THB: 2,
  TRY: 2,
  TZS: 2,
  UAH: 2,
  USD: 2,
  UYU: 2,
  UZS: 2,
  VEF: 2,
  YER: 2,
  ZAR: 2,
  ZMW: 2,
};

const ISO_CURRENCY = /^[A-Z]{3}$/;

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Decimal places TikTok accepts in a budget for this currency (JPY, IDR,
 * KRW, VND... 0; KWD, JOD... 3; most 2). Currencies TikTok does not list
 * fall back to their ISO 4217 minor units (Intl), else 2.
 */
export function currencyDecimals(currency: string): number {
  const code = normalizeCurrency(currency);
  const documented = CURRENCY_DECIMALS[code];
  if (documented !== undefined) return documented;
  if (ISO_CURRENCY.test(code)) {
    try {
      const digits = new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      if (digits !== undefined) return digits;
    } catch {
      // Not a currency Intl knows: fall through.
    }
  }
  return 2;
}

/**
 * TikTok's minimum budget (inclusive) for a budget level and mode, in the
 * advertiser currency, or null when TikTok documents no figure for that
 * currency (no local check; TikTok validates). A total (lifetime) budget on
 * an ad group is the daily minimum x scheduled days (TOTAL_BUDGET_DAYS, the
 * schedule spec.ts creates); on a campaign it equals the daily minimum.
 */
export function minimumBudget(input: {
  currency: string;
  level: CampaignSpec["budget"]["level"];
  mode: CampaignSpec["budget"]["mode"];
  /** Scheduled days of a total ad group budget (default TOTAL_BUDGET_DAYS). */
  scheduledDays?: number;
}): { amount: number; currency: string } | null {
  const currency = normalizeCurrency(input.currency);
  const row = MIN_DAILY_BUDGET[currency];
  if (!row) return null;
  if (input.level === "campaign") return { amount: row.campaignDaily, currency };
  if (input.mode === "daily") return { amount: row.adGroupDaily, currency };
  const days = Math.max(1, Math.ceil(input.scheduledDays ?? TOTAL_BUDGET_DAYS));
  return { amount: row.adGroupDaily * days, currency };
}

function invalid(message: string): never {
  throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", message, { retryable: false });
}

function hasAtMostDecimals(amount: number, decimals: number): boolean {
  const scaled = amount * 10 ** decimals;
  return Math.abs(Math.round(scaled) - scaled) <= 1e-6 * Math.max(1, Math.abs(scaled));
}

/**
 * Parses a budget and refuses one TikTok would reject for the advertiser
 * currency: more decimals than the currency allows, or under its minimum.
 * Used on create (createPausedCampaign) and on update (updateBudget).
 * Without a known currency only the contract and a two-decimal cap apply.
 */
export function validateBudgetForCurrency(
  raw: CampaignSpec["budget"],
  currency: string | undefined,
): CampaignSpec["budget"] {
  const parsed = campaignSpecSchema.shape.budget.safeParse(raw);
  if (!parsed.success || !Number.isFinite(parsed.data.amount)) {
    invalid("Invalid budget.");
  }
  const budget = parsed.data;
  const code = currency ? normalizeCurrency(currency) : undefined;
  const decimals = code ? currencyDecimals(code) : 2;
  if (!hasAtMostDecimals(budget.amount, decimals)) {
    const label = code ? `${code} budget` : "budget";
    invalid(
      decimals === 0
        ? `A ${label} must be a whole number.`
        : `A ${label} has at most ${decimals} decimals.`,
    );
  }
  const min = code
    ? minimumBudget({ currency: code, level: budget.level, mode: budget.mode })
    : null;
  if (min && budget.amount < min.amount) {
    invalid(
      `The ${budget.level === "campaign" ? "campaign" : "ad group"} ${budget.mode} budget must be at least ${min.amount} ${min.currency}.`,
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
