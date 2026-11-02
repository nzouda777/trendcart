import "server-only";

/**
 * Live SupplierFinder: SerpApi discovery + Firecrawl listing extraction.
 *
 *   1. Google Lens on the reference image (when there is one).
 *   2. Google Shopping on the most specific keyword when there is no image or
 *      Lens left fewer than `limit` usable candidates.
 *   3. Drop listings rejected at GATE 2 (`excludeUrls`), dedupe by canonical
 *      URL, drop content sites, rank by match, keep `limit`.
 *   4. Firecrawl JSON scrape of each kept listing (3 at a time); a failed or
 *      empty scrape falls back to the search-result data when it has a price.
 *   5. Listings without a price are dropped; the rest are re-scored with the
 *      extracted title and returned best first.
 *
 * Every HTTP call goes through the brand proxy when the CallContext carries
 * one, otherwise through the SSRF-guarded dispatcher. Usage is reported for
 * each billed request, including the scrapes that yielded nothing.
 * Prices stay in the listing's own currency (no FX conversion here).
 */
import { z } from "zod";

import {
  callContextSchema,
  countrySchema,
  currencySchema,
  IntegrationError,
  supplierListingSchema,
  type AiUsage,
  type SupplierFinder,
  type SupplierListing,
} from "@/lib/domain/contracts";
import { serpApiUsage } from "@/lib/ai/pricing";
import { createHttpClient, type HttpFetch } from "@/lib/integrations/tiktok-data/http";
import { assertPublicHostname } from "@/lib/integrations/tiktok-data/net-guard";

import { createExclusionFilter } from "./exclude";
import { extractListing, type ExtractedListing } from "./firecrawl";
import { matchScore, rankCandidates, type ListingCandidate } from "./ranking";
import { lensCandidates, shoppingCandidates } from "./serpapi";

export const DEFAULT_SUPPLIER_LIMIT = 5;
export const MAX_SUPPLIER_LIMIT = 10;
const EXTRACT_CONCURRENCY = 3;

export type LiveSupplierFinderOptions = {
  /** Base fetch (tests). */
  fetch?: HttpFetch;
  serpApiKey?: string;
  firecrawlApiKey?: string;
  serpApiBaseUrl?: string;
  firecrawlBaseUrl?: string;
};

const inputSchema = z.object({
  imageUrl: z.url().nullable(),
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  country: countrySchema,
  currency: currencySchema,
  limit: z.number().int().min(1).max(MAX_SUPPLIER_LIMIT).optional(),
  excludeUrls: z.array(z.string().max(4096)).max(500).optional(),
});

function key(name: string, value: string | undefined): string {
  if (!value) {
    throw new IntegrationError(
      name.toLowerCase().split("_")[0]!,
      "permission_denied",
      `${name} is not set.`,
      {
        retryable: false,
      },
    );
  }
  return value;
}

/** A Lens-safe image URL (https, public host) or null. */
function lensImage(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    assertPublicHostname(u.hostname);
    return u.href;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `n` in flight; keeps order. */
async function mapLimited<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Pure: merges a candidate with its extraction into a contract listing (exported for tests). */
export function toListing(
  c: ListingCandidate,
  x: ExtractedListing | null,
  keywords: string[],
): SupplierListing | null {
  const price = x?.price ?? c.price;
  if (!price) return null;
  const title = x?.title ?? c.title;
  const shipping = x?.shipping ?? c.shipping;
  const listing = {
    source: c.source,
    url: c.url,
    title,
    price,
    // Shipping in another currency than the price would be silently wrong in margins.
    shipping: shipping && shipping.currency === price.currency ? shipping : null,
    leadTimeDays: x?.leadTimeDays ?? null,
    images: x?.images.length ? x.images : c.images,
    variants: x?.variants ?? [],
    matchScore: matchScore({ ...c, title, price }, keywords),
  };
  const parsed = supplierListingSchema.safeParse(listing);
  return parsed.success ? parsed.data : null;
}

export function createLiveSupplierFinder(options: LiveSupplierFinderOptions = {}): SupplierFinder {
  return {
    async find(ctx, raw) {
      const callCtx = callContextSchema.parse(ctx);
      const input = inputSchema.parse({
        ...raw,
        country: raw.country?.toUpperCase(),
        currency: raw.currency?.toUpperCase(),
      });
      const limit = input.limit ?? DEFAULT_SUPPLIER_LIMIT;
      const keywords = input.keywords;
      const http = createHttpClient(callCtx, { fetch: options.fetch, timeoutMs: 60_000 });
      const serp = {
        apiKey: key("SERPAPI_KEY", options.serpApiKey ?? process.env.SERPAPI_KEY),
        fetch: http,
        baseUrl: options.serpApiBaseUrl,
      };
      const firecrawl = {
        apiKey: key("FIRECRAWL_API_KEY", options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY),
        fetch: http,
        baseUrl: options.firecrawlBaseUrl,
      };
      const usage: AiUsage[] = [];
      const candidates: ListingCandidate[] = [];
      const isExcluded = createExclusionFilter(input.excludeUrls);
      // Excluded listings never take a slot, so Shopping can still top up.
      const keep = (found: ListingCandidate[]) => found.filter((c) => !isExcluded(c.url));
      let searchError: IntegrationError | null = null;

      const image = lensImage(input.imageUrl);
      if (image) {
        try {
          candidates.push(
            ...keep(
              await lensCandidates(serp, {
                imageUrl: image,
                country: input.country,
                currency: input.currency,
              }),
            ),
          );
          usage.push(serpApiUsage("google_lens"));
        } catch (error) {
          if (!(error instanceof IntegrationError) || !error.retryable) throw error;
          searchError = error; // try Shopping before giving up
        }
      }

      if (rankCandidates(candidates, keywords, limit).length < limit) {
        try {
          candidates.push(
            ...keep(
              await shoppingCandidates(serp, {
                query: keywords[0]!,
                country: input.country,
                currency: input.currency,
              }),
            ),
          );
          usage.push(serpApiUsage("google_shopping"));
        } catch (error) {
          if (usage.length === 0) throw searchError ?? error;
          // Lens worked: keep its candidates rather than failing the whole step.
        }
      }

      const ranked = rankCandidates(candidates, keywords, limit);
      const listings = await mapLimited(ranked, EXTRACT_CONCURRENCY, async (c) => {
        if (!c.extractable) return toListing(c, null, keywords);
        try {
          const { listing, usage: u } = await extractListing(firecrawl, {
            url: c.url,
            currency: input.currency,
            country: input.country,
          });
          usage.push(u);
          return toListing(c, listing, keywords);
        } catch {
          // Unbilled Firecrawl failure (rate limit, outage): fall back to search data.
          return toListing(c, null, keywords);
        }
      });

      const seen = new Set<string>();
      const data = listings
        .filter((l): l is SupplierListing => l !== null)
        .filter((l) => !isExcluded(l.url))
        .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)))
        .sort((a, b) => b.matchScore - a.matchScore);
      return { data, usage };
    },
  };
}
