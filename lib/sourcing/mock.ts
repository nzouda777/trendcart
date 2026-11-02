import {
  supplierListingSchema,
  type SupplierFinder,
  type SupplierListing,
} from "@/lib/domain/contracts";
import { firecrawlUsage, serpApiUsage } from "@/lib/ai/pricing";
import { matchSampleProduct, sampleImageUrl, seeded } from "@/lib/ai/sample-products";

import { createExclusionFilter } from "./exclude";

/**
 * Deterministic supplier listings for the sample product the keywords match.
 * Prices are converted from USD with fixed demo rates; usage mirrors the live
 * pipeline: one SerpApi search (Google Lens with an image, Google Shopping
 * without) and one Firecrawl JSON scrape per listing.
 *
 * Listings rejected at GATE 2 (`excludeUrls`) are never returned: the next
 * deterministic "page" of results for the same sources is offered instead
 * (up to `MOCK_ROUNDS` pages, then the result is simply shorter).
 */
const DEMO_FX: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, AUD: 1.52 };

const SOURCES = [
  { source: "aliexpress", host: "www.aliexpress.com", path: "item", lead: [8, 15], shipping: 0 },
  {
    source: "cjdropshipping",
    host: "cjdropshipping.com",
    path: "product",
    lead: [6, 12],
    shipping: 2.9,
  },
  {
    source: "alibaba",
    host: "www.alibaba.com",
    path: "product-detail",
    lead: [10, 20],
    shipping: 4.5,
  },
  { source: "temu", host: "www.temu.com", path: "goods", lead: [7, 14], shipping: 0 },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const MOCK_ROUNDS = 3;

export function createMockSupplierFinder(): SupplierFinder {
  return {
    async find(_ctx, input) {
      const product = matchSampleProduct(input.keywords.join(" "));
      const currency = input.currency.toUpperCase();
      const fx = DEMO_FX[currency] ?? 1;
      const limit = Math.min(Math.max(1, input.limit ?? SOURCES.length), SOURCES.length);
      const [lo, hi] = product.unitCostUsd;
      const isExcluded = createExclusionFilter(input.excludeUrls);

      // Round 0 is the first page of results; later rounds are what a new search
      // would surface once the first ones were rejected.
      const pool = Array.from({ length: MOCK_ROUNDS }, (_, round) =>
        SOURCES.slice(0, limit).map((s) => {
          const r = seeded(
            round === 0 ? `${product.key}:${s.source}` : `${product.key}:${s.source}:${round}`,
          );
          const id = String(1_005_000_000_000 + Math.floor(r * 9_000_000_000));
          return { s, r, url: `https://${s.host}/${s.path}/${id}.html` };
        }),
      )
        .flat()
        .filter((c) => !isExcluded(c.url))
        .slice(0, limit);

      const listings: SupplierListing[] = pool.map(({ s, r, url }, i) => {
        const price = round2((lo + (hi - lo) * r) * fx);
        return supplierListingSchema.parse({
          source: s.source,
          url,
          title: `${product.productName} ${product.variants[0]?.values[0] ?? ""}`.trim(),
          price: { amount: price, currency },
          shipping: { amount: round2(s.shipping * fx), currency },
          leadTimeDays: { min: s.lead[0], max: s.lead[1] },
          images: [1, 2, 3].map((n) => sampleImageUrl(`${product.key}-${s.source}-${n}`)),
          variants: product.variants.map((v) => ({ name: v.name, values: v.values })),
          matchScore: round2(0.94 - i * 0.07 - r * 0.03),
        });
      });

      const usage = [
        serpApiUsage(input.imageUrl ? "google_lens" : "google_shopping"),
        ...listings.map(() => firecrawlUsage()),
      ];
      return { data: listings, usage };
    },
  };
}
