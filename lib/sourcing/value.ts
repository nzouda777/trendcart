/**
 * Quality/price ratio of supplier listings, and the GATE 2 shortlist (pure).
 *
 * valueScore (0..1), relative to the other listings of the same search:
 *   0.40 relevance  matchScore (is it the same product?)
 *   0.30 price      cheapest landed cost (price + shipping) / this landed cost,
 *                   compared within one currency
 *   0.20 quality    rating out of 5, pulled towards neutral when few reviews
 *   0.10 speed      maximum delivery days (unknown = neutral)
 * A listing that does not look like the product (matchScore < MIN_MATCH) is
 * never preferred for its price: its score is capped by its relevance.
 */
import type { SupplierListing } from "@/lib/domain/contracts";

/** Marketplaces every search covers; the best offer of each is always shortlisted. */
export const REQUIRED_SUPPLIER_SOURCES = ["aliexpress", "cjdropshipping", "amazon"] as const;
export type RequiredSupplierSource = (typeof REQUIRED_SUPPLIER_SOURCES)[number];

/** Below this match score a listing is probably another product. */
export const MIN_MATCH = 0.35;

const WEIGHTS = { relevance: 0.4, price: 0.3, quality: 0.2, speed: 0.1 } as const;

const round2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

type Scorable = Pick<
  SupplierListing,
  "price" | "shipping" | "rating" | "reviewCount" | "leadTimeDays" | "matchScore"
>;

/** Price + shipping when both are in the same currency, else the price alone. */
export function landedCost(l: Pick<SupplierListing, "price" | "shipping">): number {
  const ship = l.shipping && l.shipping.currency === l.price.currency ? l.shipping.amount : 0;
  return l.price.amount + ship;
}

/** 0..1 quality from a rating out of 5; 0.5 when unknown or backed by few reviews. */
export function qualitySignal(rating: number | null, reviewCount: number | null): number {
  if (rating === null) return 0.5;
  const norm = Math.min(1, Math.max(0, (rating - 3) / 2)); // 3★ → 0, 5★ → 1
  // 1 review ≈ 0.1 confidence, 10 ≈ 0.35, 100 ≈ 0.67, 1000+ = 1. Unknown count: 0.3.
  const confidence =
    reviewCount === null ? 0.3 : Math.min(1, Math.log10(Math.max(0, reviewCount) + 1) / 3);
  return 0.5 + (norm - 0.5) * confidence;
}

/** 0..1 delivery speed: ≤ 5 days → 1, ≥ 30 days → 0, unknown → 0.5. */
export function speedSignal(lead: SupplierListing["leadTimeDays"]): number {
  if (!lead) return 0.5;
  return Math.min(1, Math.max(0, (30 - lead.max) / 25));
}

/** The listings with their valueScore set (same order). */
export function scoreListings<T extends Scorable>(
  listings: readonly T[],
): (T & { valueScore: number })[] {
  const cheapest = new Map<string, number>();
  for (const l of listings) {
    const cost = landedCost(l);
    const cur = l.price.currency;
    if (cost > 0 && cost < (cheapest.get(cur) ?? Infinity)) cheapest.set(cur, cost);
  }
  return listings.map((l) => {
    const cost = landedCost(l);
    const min = cheapest.get(l.price.currency);
    const price = min && cost > 0 ? min / cost : 0.5;
    const raw =
      WEIGHTS.relevance * l.matchScore +
      WEIGHTS.price * price +
      WEIGHTS.quality * qualitySignal(l.rating, l.reviewCount) +
      WEIGHTS.speed * speedSignal(l.leadTimeDays);
    const valueScore = round2(l.matchScore < MIN_MATCH ? Math.min(raw, l.matchScore) : raw);
    return { ...l, valueScore };
  });
}

/**
 * Up to `limit` items, keeping the order of `ranked` (best first) but always
 * including the first eligible item of each required source. Required picks
 * replace the lowest-ranked others when the list is full.
 */
export function pickWithRequiredSources<T>(
  ranked: readonly T[],
  options: {
    limit: number;
    sourceOf: (item: T) => string;
    eligible: (item: T) => boolean;
    required?: readonly string[];
  },
): T[] {
  const required = options.required ?? REQUIRED_SUPPLIER_SOURCES;
  const must = new Set<T>();
  for (const source of required) {
    const best = ranked.find((x) => options.sourceOf(x) === source && options.eligible(x));
    if (best !== undefined) must.add(best);
  }
  const limit = Math.max(options.limit, must.size);
  const out: T[] = [];
  let free = limit - must.size;
  for (const item of ranked) {
    if (must.has(item)) out.push(item);
    else if (free > 0) {
      out.push(item);
      free--;
    }
    if (out.length === limit) break;
  }
  return out;
}

/** GATE 2 shortlist: scored, best value first, the required marketplaces always in. */
export function shortlistListings(
  listings: readonly SupplierListing[],
  limit: number,
): SupplierListing[] {
  const ranked = scoreListings(listings).sort(
    (a, b) => b.valueScore - a.valueScore || b.matchScore - a.matchScore,
  );
  return pickWithRequiredSources(ranked, {
    limit,
    sourceOf: (l) => l.source,
    eligible: (l) => l.matchScore >= MIN_MATCH,
  });
}
