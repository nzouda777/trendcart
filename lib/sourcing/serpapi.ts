import "server-only";

/**
 * SerpApi discovery (https://serpapi.com, docs checked 2026-10-31).
 *
 *   GET https://serpapi.com/search?engine=google_lens&url=<image>&type=visual_matches
 *       &hl=en&country=<cc>&api_key=...
 *     -> visual_matches[]: position, title, link, source, thumbnail, image,
 *        price? { value, extracted_value, currency }, in_stock?
 *   GET https://serpapi.com/search?engine=google_shopping&q=<query>&gl=<cc>&hl=en&api_key=...
 *     -> shopping_results[]: position, title, product_link, link?, source,
 *        price, extracted_price, thumbnail, delivery?
 *
 * One search = one billed request (cached and failed searches are free).
 * SerpApi reports "no results" as HTTP 200 with an `error` string: that is an
 * empty result, not a failure. The request URL carries the API key: never log it.
 */
import { z } from "zod";

import { IntegrationError } from "@/lib/domain/contracts";
import { httpStatusError, networkError, type HttpFetch } from "@/lib/integrations/tiktok-data/http";

import {
  canonicalListingUrl,
  cleanImageUrls,
  currencyFromDisplay,
  isGoogleHost,
  shippingFromDelivery,
  sourceForHost,
  toMoney,
  type ListingCandidate,
} from "./ranking";

export const SERPAPI_BASE_URL = "https://serpapi.com/search";
const PROVIDER = "serpapi";
const TIMEOUT_MS = 30_000;

const lensMatchSchema = z.looseObject({
  position: z.number().optional(),
  title: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  price: z
    .looseObject({
      value: z.string().optional().nullable(),
      extracted_value: z.number().optional().nullable(),
      currency: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  in_stock: z.boolean().optional().nullable(),
});

const lensResponseSchema = z.looseObject({
  error: z.string().optional(),
  visual_matches: z.array(z.unknown()).optional().nullable(),
});

const shoppingResultSchema = z.looseObject({
  position: z.number().optional(),
  title: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
  product_link: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  price: z.string().optional().nullable(),
  extracted_price: z.number().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  delivery: z.string().optional().nullable(),
});

const shoppingResponseSchema = z.looseObject({
  error: z.string().optional(),
  shopping_results: z.array(z.unknown()).optional().nullable(),
});

export type SerpApiConfig = {
  apiKey: string;
  fetch: HttpFetch;
  baseUrl?: string;
};

/** "No results" style errors SerpApi returns with HTTP 200. */
const EMPTY_RESULT = /hasn'?t returned any results|no results/i;

async function search(config: SerpApiConfig, params: Record<string, string>): Promise<unknown> {
  const url = new URL(config.baseUrl ?? SERPAPI_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", config.apiKey);

  let res;
  try {
    res = await config.fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(PROVIDER, error);
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const errorMessage =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "";
  if (!res.ok) throw httpStatusError(PROVIDER, res.status, errorMessage);
  if (body === null) {
    throw new IntegrationError(
      PROVIDER,
      "provider_error",
      "SerpApi returned an unreadable response.",
    );
  }
  if (errorMessage && !EMPTY_RESULT.test(errorMessage)) {
    throw new IntegrationError(
      PROVIDER,
      "provider_error",
      `SerpApi: ${errorMessage.slice(0, 300)}`,
    );
  }
  return body;
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

/** Google Lens visual matches for a public product image. */
export async function lensCandidates(
  config: SerpApiConfig,
  input: { imageUrl: string; country: string; currency: string },
): Promise<ListingCandidate[]> {
  const body = lensResponseSchema.parse(
    await search(config, {
      engine: "google_lens",
      url: input.imageUrl,
      type: "visual_matches",
      hl: "en",
      country: input.country.toLowerCase(),
    }),
  );
  const out: ListingCandidate[] = [];
  for (const [i, raw] of (body.visual_matches ?? []).entries()) {
    const m = lensMatchSchema.safeParse(raw);
    if (!m.success || !m.data.link || !m.data.title) continue;
    if (m.data.in_stock === false) continue;
    const url = canonicalListingUrl(m.data.link);
    if (!url) continue;
    const host = hostOf(url);
    const currency = currencyFromDisplay(
      m.data.price?.currency ?? m.data.price?.value,
      input.country,
      input.currency,
    );
    out.push({
      url,
      host,
      source: sourceForHost(host),
      title: m.data.title.trim().slice(0, 255),
      price: toMoney(m.data.price?.extracted_value, currency),
      shipping: null,
      images: cleanImageUrls([m.data.image, m.data.thumbnail]),
      origin: "lens",
      position: m.data.position ?? i + 1,
      extractable: !isGoogleHost(host),
    });
  }
  return out;
}

/** Google Shopping results for a keyword query. */
export async function shoppingCandidates(
  config: SerpApiConfig,
  input: { query: string; country: string; currency: string },
): Promise<ListingCandidate[]> {
  const body = shoppingResponseSchema.parse(
    await search(config, {
      engine: "google_shopping",
      q: input.query,
      gl: input.country.toLowerCase(),
      hl: "en",
    }),
  );
  const out: ListingCandidate[] = [];
  for (const [i, raw] of (body.shopping_results ?? []).entries()) {
    const r = shoppingResultSchema.safeParse(raw);
    if (!r.success || !r.data.title) continue;
    // Prefer the merchant link; the Google product page is a fallback we do not scrape.
    const url = canonicalListingUrl(r.data.link ?? r.data.product_link ?? "");
    if (!url) continue;
    const host = hostOf(url);
    const currency = currencyFromDisplay(r.data.price, input.country, input.currency);
    const google = isGoogleHost(host);
    out.push({
      url,
      host,
      // On a Google page the merchant name is the meaningful source.
      source:
        google && r.data.source
          ? r.data.source.trim().toLowerCase().slice(0, 60)
          : sourceForHost(host),
      title: r.data.title.trim().slice(0, 255),
      price: toMoney(r.data.extracted_price, currency),
      shipping: shippingFromDelivery(r.data.delivery, currency),
      images: cleanImageUrls([r.data.thumbnail]),
      origin: "shopping",
      position: r.data.position ?? i + 1,
      extractable: !google,
    });
  }
  return out;
}
