/**
 * Selling price from a brand's pricing_rule (pure).
 *
 *   price = landed cost × multiplier, raised to the next price ending in
 *   `roundTo` (default .99): 23.40 -> 23.99, 24.00 -> 24.99, 23.99 -> 23.99.
 *   compareAtPrice = price × compareAtMultiplier with the same ending, only
 *   when it ends up strictly above the price.
 *
 * All arithmetic is done in integer cents to avoid float drift.
 */
import { z } from "zod";

import type { PricingRule } from "@/lib/db/schema/business";

export const pricingRuleSchema = z.object({
  multiplier: z.number().positive().finite(),
  /** Fractional ending in [0, 1), e.g. 0.99 or 0.95; 0 = whole units. */
  roundTo: z.number().min(0).lt(1).optional(),
  compareAtMultiplier: z.number().gt(1).finite().optional(),
}) satisfies z.ZodType<PricingRule>;

export const DEFAULT_PRICE_ENDING = 0.99;

export type PriceQuote = {
  price: number;
  compareAtPrice: number | null;
};

const toCents = (value: number) => Math.round(value * 100);

/** Smallest amount >= `raw` whose fractional part equals `ending` (both in cents). */
function ceilToEnding(rawCents: number, endingCents: number): number {
  const units = Math.ceil((rawCents - endingCents) / 100);
  return Math.max(0, units) * 100 + endingCents;
}

/** Rounds an arbitrary amount up to the brand's price ending. */
export function roundToEnding(amount: number, ending: number = DEFAULT_PRICE_ENDING): number {
  z.number().nonnegative().finite().parse(amount);
  const endingCents = toCents(z.number().min(0).lt(1).parse(ending));
  // Work on a ceiled cent value so 23.401 -> 23.41 cents before rounding up.
  const rawCents = Math.ceil(Math.round(amount * 1e6) / 1e4);
  return ceilToEnding(rawCents, endingCents) / 100;
}

export function priceFromCost(cost: number, rule: PricingRule): PriceQuote {
  const landed = z.number().nonnegative().finite().parse(cost);
  const r = pricingRuleSchema.parse(rule);
  const ending = r.roundTo ?? DEFAULT_PRICE_ENDING;

  const price = roundToEnding(landed * r.multiplier, ending);
  let compareAtPrice: number | null = null;
  if (r.compareAtMultiplier) {
    const candidate = roundToEnding(price * r.compareAtMultiplier, ending);
    compareAtPrice = candidate > price ? candidate : null;
  }
  return { price, compareAtPrice };
}
