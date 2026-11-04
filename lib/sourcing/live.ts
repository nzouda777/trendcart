import "server-only";

/**
 * Live SupplierFinder: SerpApi discovery + Firecrawl listing extraction.
 *
 *   1. Google Lens on the reference image (when there is one).
 *   2. Google Shopping on the most specific keyword when there is no image or
 *      Lens left fewer than `limit` usable candidates.
 *   3. Required marketplaces (AliExpress, CJ Dropshipping, Amazon): one Google
 *      search restricted to each marketplace that has no matching product page
 *      yet (in parallel; a failed one is skipped).
 *   4. Drop listings rejected at GATE 2 (`excludeUrls`), dedupe by canonical
 *      URL, drop content sites, rank by match; keep `limit` + 2 to scrape,
 *      always including the best match of each required marketplace.
 *   5. Firecrawl JSON scrape of each kept listing (4 at a time); a failed or
 *      empty scrape falls back to the search-result data when it has a price.
 *   6. Listings without a price are dropped; the rest are re-scored with the
 *      extracted title, scored for quality/price (./value.ts) and the best
 *      `limit` returned, best value first, with the best offer of each required
 *      marketplace always in.
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
import {
  aliExpressCandidates,
  cjCandidates,
  cjGallery,
  type AliExpressConfig,
  type CjConfig,
} from "./marketplaces";
import {
  isMarketplaceProductPage,
  marketplaceSearchDomain,
  matchScore,
  rankCandidates,
  type ListingCandidate,
} from "./ranking";
import {
  amazonCandidates,
  lensCandidates,
  marketplaceCandidates,
  shoppingCandidates,
} from "./serpapi";
import {
  MIN_MATCH,
  pickWithRequiredSources,
  REQUIRED_SUPPLIER_SOURCES,
  shortlistListings,
  type RequiredSupplierSource,
} from "./value";

export const DEFAULT_SUPPLIER_LIMIT = 6;
export const MAX_SUPPLIER_LIMIT = 10;
const EXTRACT_CONCURRENCY = 4;
/** Listings scraped beyond `limit`, so the value ranking has a choice. */
const EXTRA_SCRAPES = 2;

export type LiveSupplierFinderOptions = {
  /** Base fetch (tests). */
  fetch?: HttpFetch;
  serpApiKey?: string;
  firecrawlApiKey?: string;
  serpApiBaseUrl?: string;
  firecrawlBaseUrl?: string;
  /** Marketplace API credentials (tests); default from env, absent = Google site search. */
  cj?: CjConfig | null;
  aliexpress?: AliExpressConfig | null;
};

/** Listing currencies kept: prices are compared and margins computed in USD or EUR. */
export const SOURCING_CURRENCIES: ReadonlySet<string> = new Set(["USD", "EUR"]);

const EURO_AMAZON_COUNTRIES = new Set(["FR", "DE", "ES", "IT", "NL"]);

/**
 * Where suppliers are searched: EUR brands in the euro market (their own
 * Amazon when it has one, else amazon.fr), every other brand in USD (US).
 */
export function sourcingMarket(country: string, currency: string) {
  if (currency.toUpperCase() === "EUR") {
    const c = EURO_AMAZON_COUNTRIES.has(country.toUpperCase()) ? country.toUpperCase() : "FR";
    return {
      currency: "EUR" as const,
      country: c,
      amazonDomain: marketplaceSearchDomain("amazon", c),
    };
  }
  return { currency: "USD" as const, country: "US", amazonDomain: "amazon.com" };
}

function cjConfigFromEnv(fetch: HttpFetch): CjConfig | null {
  const apiKey = process.env.CJ_API_KEY?.trim();
  return apiKey ? { apiKey, fetch } : null;
}

function aliExpressConfigFromEnv(fetch: HttpFetch): AliExpressConfig | null {
  const appKey = process.env.ALIEXPRESS_APP_KEY?.trim();
  const appSecret = process.env.ALIEXPRESS_APP_SECRET?.trim();
  const trackingId = process.env.ALIEXPRESS_TRACKING_ID?.trim();
  return appKey && appSecret && trackingId ? { appKey, appSecret, trackingId, fetch } : null;
}

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
    leadTimeDays: x?.leadTimeDays ?? c.leadTimeDays ?? null,
    images: x?.images.length ? x.images : c.images,
    variants: x?.variants ?? [],
    matchScore: matchScore({ ...c, title, price }, keywords),
    rating: x?.rating ?? c.rating,
    reviewCount: x?.reviewCount ?? c.reviewCount,
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
      // Excluded listings never take a slot, so other searches can still top up.
      const keep = (found: ListingCandidate[]) => found.filter((c) => !isExcluded(c.url));
      // Prices are wanted in USD or EUR: searches run in that market.
      const market = sourcingMarket(input.country, input.currency);
      const query = keywords[0]!;
      const cj = options.cj ?? cjConfigFromEnv(http);
      const ali = options.aliexpress ?? aliExpressConfigFromEnv(http);
      let searchError: IntegrationError | null = null;

      async function siteSearch(source: RequiredSupplierSource) {
        const found = await marketplaceCandidates(serp, {
          source,
          query,
          country: market.country,
          currency: market.currency,
        });
        usage.push(serpApiUsage("google"));
        return found;
      }
      // 1. The required marketplaces (official APIs when configured, Amazon through
      //    SerpApi's Amazon engine, else a Google search on the marketplace) and
      //    Google Lens on the reference image, all in parallel.
      const bySource: Record<RequiredSupplierSource, () => Promise<ListingCandidate[]>> = {
        amazon: async () => {
          const found = await amazonCandidates(serp, {
            query,
            domain: market.amazonDomain,
            currency: market.currency,
            country: market.country,
          });
          usage.push(serpApiUsage("amazon"));
          return found;
        },
        aliexpress: async () =>
          ali
            ? aliExpressCandidates(ali, {
                query,
                currency: market.currency,
                country: input.country,
              })
            : siteSearch("aliexpress"),
        cjdropshipping: async () =>
          cj ? cjCandidates(cj, { query }) : siteSearch("cjdropshipping"),
      };
      const image = lensImage(input.imageUrl);
      const [lens, ...markets] = await Promise.allSettled([
        image
          ? lensCandidates(serp, {
              imageUrl: image,
              country: market.country,
              currency: market.currency,
            })
          : Promise.resolve(null),
        ...REQUIRED_SUPPLIER_SOURCES.map((source) => bySource[source]()),
      ]);
      if (lens.status === "fulfilled" && lens.value) {
        candidates.push(...keep(lens.value));
        usage.push(serpApiUsage("google_lens"));
      } else if (lens.status === "rejected") {
        const error: unknown = lens.reason;
        if (!(error instanceof IntegrationError) || !error.retryable) throw error;
        searchError = error;
      }
      markets.forEach((result, i) => {
        if (result.status === "fulfilled") candidates.push(...keep(result.value ?? []));
        else {
          // One marketplace failing (no API access, outage) never fails the search.
          console.warn(
            `[supplier-finder] ${REQUIRED_SUPPLIER_SOURCES[i]} search failed:`,
            result.reason instanceof Error ? result.reason.message : result.reason,
          );
        }
      });

      // 2. Google Shopping tops up when the searches left too few listings.
      if (rankCandidates(candidates, keywords, limit).length < limit) {
        try {
          candidates.push(
            ...keep(
              await shoppingCandidates(serp, {
                query,
                country: market.country,
                currency: market.currency,
              }),
            ),
          );
          usage.push(serpApiUsage("google_shopping"));
        } catch (error) {
          if (candidates.length === 0) throw searchError ?? error;
        }
      }

      // 3. Best matches, the best of each required marketplace always in.
      const usable = (c: ListingCandidate) =>
        isMarketplaceProductPage(c.url) && matchScore(c, keywords) >= MIN_MATCH;
      const ranked = pickWithRequiredSources(rankCandidates(candidates, keywords, Infinity), {
        limit: limit + EXTRA_SCRAPES,
        sourceOf: (c) => c.source,
        eligible: usable,
      });
      const listings = await mapLimited(ranked, EXTRACT_CONCURRENCY, async (c) => {
        if (!c.extractable) return toListing(c, null, keywords);
        try {
          const { listing, usage: u } = await extractListing(firecrawl, {
            url: c.url,
            currency: market.currency,
            country: market.country,
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
        // Only USD or EUR prices: margins never depend on an unknown currency.
        .filter((l) => SOURCING_CURRENCIES.has(l.price.currency))
        .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
      const shortlist = shortlistListings(data, limit);

      // 4. CJ search results carry one photo: fetch the gallery of the shortlisted ones.
      if (cj) {
        for (const listing of shortlist.filter((l) => l.source === "cjdropshipping").slice(0, 2)) {
          const pid = ranked.find((c) => c.url === listing.url)?.externalId;
          if (!pid) continue;
          try {
            const gallery = await cjGallery(cj, pid);
            if (gallery.length > listing.images.length) listing.images = gallery;
          } catch {
            // Keep the search photo.
          }
        }
      }
      return { data: shortlist, usage };
    },
  };
}
