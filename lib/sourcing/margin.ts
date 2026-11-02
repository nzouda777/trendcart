/**
 * Unit economics of one order (pure, integer-cent arithmetic).
 *
 *   landed cost   = product cost + shipping + other per-order costs
 *   payment fees  = price × paymentRate + paymentFixed      (card processing)
 *   shopify fees  = price × shopifyTransactionRate          (third-party gateway only)
 *   gross margin  = price − landed cost − fees              (before ads)
 *   break-even CPA = gross margin                           (ad spend per order that nets 0)
 *   max CPA       = gross margin − targetMarginRate × price (ad spend per order that keeps the target)
 *   break-even ROAS = price / break-even CPA
 *
 * Shopify subscription fees are fixed monthly costs and are not spread per order.
 *
 * `quoteSupplier` (below) turns a chosen supplier listing plus the brand's
 * pricing_rule and min_margin into a suggested selling / compare-at price and
 * its margin, for GATE 2.
 */
import { z } from "zod";

import type { MarginBreakdown, PricingRule } from "@/lib/db/schema/business";
import { IntegrationError } from "@/lib/domain/contracts";
import {
  DEFAULT_PRICE_ENDING,
  priceFromCost,
  pricingRuleSchema,
  roundToEnding,
} from "@/lib/integrations/shopify/pricing";

export const feeScheduleSchema = z.object({
  /** Card processing percentage, 0..1. */
  paymentRate: z.number().min(0).max(0.2),
  /** Card processing fixed fee per order, in the order currency. */
  paymentFixed: z.number().min(0).max(10),
  /** Shopify transaction fee for third-party gateways, 0..1 (0 with Shopify Payments). */
  shopifyTransactionRate: z.number().min(0).max(0.05),
});
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;

/**
 * Starting points (US online card rates, Shopify Payments). Rates differ by
 * country and plan: let the brand override them.
 */
export const FEE_PRESETS = {
  shopify_payments_basic: { paymentRate: 0.029, paymentFixed: 0.3, shopifyTransactionRate: 0 },
  shopify_payments_grow: { paymentRate: 0.027, paymentFixed: 0.3, shopifyTransactionRate: 0 },
  shopify_payments_advanced: { paymentRate: 0.025, paymentFixed: 0.3, shopifyTransactionRate: 0 },
  third_party_basic: { paymentRate: 0.029, paymentFixed: 0.3, shopifyTransactionRate: 0.02 },
  third_party_grow: { paymentRate: 0.029, paymentFixed: 0.3, shopifyTransactionRate: 0.01 },
  third_party_advanced: { paymentRate: 0.029, paymentFixed: 0.3, shopifyTransactionRate: 0.006 },
} as const satisfies Record<string, FeeSchedule>;

export const DEFAULT_FEES: FeeSchedule = FEE_PRESETS.shopify_payments_basic;

const money = z.number().finite().min(0).max(1_000_000);

export const marginInputSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  sellingPrice: money.positive(),
  productCost: money,
  shippingCost: money.default(0),
  /** Packaging, inserts, fulfilment fee per order. */
  otherCosts: money.default(0),
  fees: feeScheduleSchema.default(DEFAULT_FEES),
  /** Margin to keep after ads, 0..1 (brand.min_margin). Omit for break-even. */
  targetMarginRate: z.number().min(0).lt(1).optional(),
});
export type MarginInput = z.input<typeof marginInputSchema>;

export type MarginResult = MarginBreakdown & {
  paymentFees: number;
  shopifyFees: number;
  /** Ad spend per order at which profit is zero (= grossMargin, floored at 0). */
  breakEvenCpa: number;
  /** Ad spend per order that still leaves targetMarginRate × price (floored at 0). */
  maxCpa: number;
  /** price / break-even CPA; null when there is no margin to spend on ads. */
  breakEvenRoas: number | null;
  targetMarginRate: number | null;
  /** True when the gross margin rate is at least the target (or positive without target). */
  meetsTarget: boolean;
};

const cents = (n: number) => Math.round(n * 100);
const units = (c: number) => c / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function calculateMargin(raw: MarginInput): MarginResult {
  const input = marginInputSchema.parse(raw);
  const price = cents(input.sellingPrice);
  const landed = cents(input.productCost) + cents(input.shippingCost) + cents(input.otherCosts);
  const paymentFees = Math.round(price * input.fees.paymentRate) + cents(input.fees.paymentFixed);
  const shopifyFees = Math.round(price * input.fees.shopifyTransactionRate);
  const fees = paymentFees + shopifyFees;
  const gross = price - landed - fees;
  const target = input.targetMarginRate ?? null;
  const breakEven = Math.max(0, gross);
  const maxCpa = Math.max(0, gross - Math.round(price * (target ?? 0)));
  const marginRate = gross / price;

  return {
    currency: input.currency,
    productCost: units(cents(input.productCost)),
    shippingCost: units(cents(input.shippingCost)),
    fees: units(fees),
    landedCost: units(landed),
    sellingPrice: units(price),
    grossMargin: units(gross),
    marginRate: round4(marginRate),
    paymentFees: units(paymentFees),
    shopifyFees: units(shopifyFees),
    breakEvenCpa: units(breakEven),
    maxCpa: units(maxCpa),
    breakEvenRoas: breakEven > 0 ? round4(price / breakEven) : null,
    targetMarginRate: target,
    meetsTarget: target === null ? gross > 0 : marginRate >= target,
  };
}

/**
 * Lowest price (rounded up to the cent) whose margin after fees reaches
 * `targetMarginRate`. Null when fees + target leave nothing (rates ≥ 100 %).
 */
export function minimumPriceForMargin(input: {
  productCost: number;
  shippingCost?: number;
  otherCosts?: number;
  fees?: FeeSchedule;
  targetMarginRate: number;
}): number | null {
  const fees = feeScheduleSchema.parse(input.fees ?? DEFAULT_FEES);
  const target = z.number().min(0).lt(1).parse(input.targetMarginRate);
  const landed =
    cents(money.parse(input.productCost)) +
    cents(input.shippingCost ?? 0) +
    cents(input.otherCosts ?? 0);
  const variableRate = fees.paymentRate + fees.shopifyTransactionRate + target;
  if (variableRate >= 1) return null;
  // price − landed − price×rates − fixed ≥ target×price
  let price = Math.max(1, Math.ceil((landed + cents(fees.paymentFixed)) / (1 - variableRate)));
  // Per-component cent rounding can leave us a cent short: step up until it holds.
  const grossAt = (p: number) =>
    p -
    landed -
    Math.round(p * fees.paymentRate) -
    cents(fees.paymentFixed) -
    Math.round(p * fees.shopifyTransactionRate);
  while (grossAt(price) / price < target) price += 1;
  while (price > 1 && grossAt(price - 1) / (price - 1) >= target) price -= 1;
  return units(price);
}

/* -------------------------------------------------------------------------- */
/* Supplier quote (GATE 2)                                                    */
/* -------------------------------------------------------------------------- */

/** Used when the brand has no pricing_rule: 3x landed cost, .99 ending, no compare-at. */
export const DEFAULT_PRICING_RULE: PricingRule = { multiplier: 3, roundTo: 0.99 };

const moneySchema = z.object({ amount: money, currency: z.string().regex(/^[A-Z]{3}$/) });

export const supplierQuoteInputSchema = z.object({
  /** The chosen listing's price and shipping (SupplierListing fields). */
  listing: z.object({ price: moneySchema, shipping: moneySchema.nullable() }),
  /** Selling currency (brand.currency). */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /**
   * Units of `currency` per unit of the listing currency. Required when the
   * listing is priced in another currency (Trendcart does not fetch FX rates).
   */
  fxRate: z.number().positive().finite().optional(),
  pricingRule: pricingRuleSchema.nullable().optional(),
  /** brand.min_margin, 0..1. */
  minMargin: z.number().min(0).lt(1).nullable().optional(),
  fees: feeScheduleSchema.default(DEFAULT_FEES),
  otherCosts: money.default(0),
  /** Manual overrides from the GATE 2 screen. */
  sellingPrice: money.positive().optional(),
  compareAtPrice: money.positive().nullable().optional(),
});
export type SupplierQuoteInput = z.input<typeof supplierQuoteInputSchema>;

export type SupplierQuote = {
  currency: string;
  sellingPrice: number;
  /** Strictly above sellingPrice, or null. */
  compareAtPrice: number | null;
  /** Where sellingPrice came from. */
  priceSource: "pricing_rule" | "default_rule" | "min_margin" | "manual";
  /** Lowest price that still meets minMargin after fees (null without minMargin). */
  minimumPrice: number | null;
  margin: MarginResult;
  /** Human-readable notes for the GATE 2 screen (e.g. margin below target). */
  warnings: string[];
};

/**
 * Prices a product from the selected supplier listing:
 *   landed = (listing price + shipping) × fxRate
 *   price  = pricing_rule (or DEFAULT_PRICING_RULE) applied to landed, raised
 *            to the min_margin floor when the rule lands below it
 *   margin = calculateMargin(price, landed, fees, target = min_margin)
 * Manual sellingPrice / compareAtPrice win over the suggestion.
 */
export function quoteSupplier(raw: SupplierQuoteInput): SupplierQuote {
  const input = supplierQuoteInputSchema.parse(raw);
  const { listing, currency } = input;
  const listingCurrency = listing.price.currency;
  if (listing.shipping && listing.shipping.currency !== listingCurrency) {
    throw new IntegrationError(
      "margin",
      "invalid_input",
      "The listing's shipping and price use different currencies.",
      { retryable: false },
    );
  }
  if (listingCurrency !== currency && input.fxRate === undefined) {
    throw new IntegrationError(
      "margin",
      "invalid_input",
      `The listing is priced in ${listingCurrency}; give an exchange rate to ${currency}.`,
      { retryable: false },
    );
  }
  const fx = listingCurrency === currency ? 1 : input.fxRate!;
  const productCost = units(cents(listing.price.amount * fx));
  const shippingCost = units(cents((listing.shipping?.amount ?? 0) * fx));
  const landed = units(cents(productCost) + cents(shippingCost) + cents(input.otherCosts));
  const rule = input.pricingRule ?? DEFAULT_PRICING_RULE;
  const ending = rule.roundTo ?? DEFAULT_PRICE_ENDING;
  const target = input.minMargin ?? null;
  const warnings: string[] = [];

  const minimumRaw =
    target === null
      ? null
      : minimumPriceForMargin({
          productCost,
          shippingCost,
          otherCosts: input.otherCosts,
          fees: input.fees,
          targetMarginRate: target,
        });
  const minimumPrice = minimumRaw === null ? null : roundToEnding(minimumRaw, ending);
  if (target !== null && minimumRaw === null) {
    warnings.push("Fees and the minimum margin leave no room for a price: lower min_margin.");
  }

  let sellingPrice: number;
  let priceSource: SupplierQuote["priceSource"];
  if (input.sellingPrice !== undefined) {
    sellingPrice = units(cents(input.sellingPrice));
    priceSource = "manual";
  } else {
    sellingPrice = priceFromCost(landed, rule).price;
    priceSource = input.pricingRule ? "pricing_rule" : "default_rule";
    if (minimumPrice !== null && sellingPrice < minimumPrice) {
      sellingPrice = minimumPrice;
      priceSource = "min_margin";
    }
  }
  if (sellingPrice <= 0) sellingPrice = 0.01;

  let compareAtPrice: number | null = null;
  if (input.compareAtPrice !== undefined) {
    compareAtPrice = input.compareAtPrice;
  } else if (rule.compareAtMultiplier) {
    compareAtPrice = roundToEnding(sellingPrice * rule.compareAtMultiplier, ending);
  }
  if (compareAtPrice !== null && compareAtPrice <= sellingPrice) compareAtPrice = null;

  const margin = calculateMargin({
    currency,
    sellingPrice,
    productCost,
    shippingCost,
    otherCosts: input.otherCosts,
    fees: input.fees,
    targetMarginRate: target ?? undefined,
  });
  if (margin.grossMargin <= 0) warnings.push("This price does not cover the landed cost and fees.");
  else if (target !== null && !margin.meetsTarget) {
    warnings.push(
      `Margin ${(margin.marginRate * 100).toFixed(1)} % is below the brand minimum of ${(target * 100).toFixed(1)} %.`,
    );
  }
  return { currency, sellingPrice, compareAtPrice, priceSource, minimumPrice, margin, warnings };
}
