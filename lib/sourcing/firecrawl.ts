import "server-only";

/**
 * Firecrawl listing extraction (https://docs.firecrawl.dev, API v2, checked 2026-10-31).
 *
 *   POST https://api.firecrawl.dev/v2/scrape
 *   Authorization: Bearer <FIRECRAWL_API_KEY>
 *   { url, formats: [{ type: "json", schema, prompt }], onlyMainContent, timeout, maxAge, proxy }
 *   -> { success: true, data: { json: {...}, metadata: { statusCode, sourceURL, ... } } }
 *
 * Cost: 1 credit per scrape + 4 for the JSON format = 5 credits. Credits are
 * debited whenever Firecrawl processes the request, even when the target page
 * answered 4xx, so usage is reported for every 2xx Firecrawl response.
 *
 * Firecrawl runs the LLM extraction against our JSON Schema; the page content
 * is untrusted, so its output is re-validated and normalized here (prices
 * bounded, ISO currency, https public images only, capped lists). Nothing is
 * stored: only the normalized fields leave this module.
 */
import { z } from "zod";

import { IntegrationError, type AiUsage, type Money } from "@/lib/domain/contracts";
import { firecrawlUsage } from "@/lib/ai/pricing";
import { httpStatusError, networkError, type HttpFetch } from "@/lib/integrations/tiktok-data/http";

import { cleanImageUrls, toMoney } from "./ranking";

export const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const PROVIDER = "firecrawl";
/** Server-side page timeout we ask Firecrawl for; our own fetch waits a bit longer. */
const SCRAPE_TIMEOUT_MS = 40_000;
/** Accept a cached copy up to a day old (listing prices move slowly; saves latency). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What we ask Firecrawl's extractor to fill (sent as JSON Schema). */
export const listingExtractionSchema = z.object({
  isProductPage: z.boolean().describe("True only if the page sells one specific physical product."),
  title: z.string().nullable().describe("Product title as shown on the page."),
  price: z
    .number()
    .nullable()
    .describe("Lowest current unit price of an in-stock variant, as a number. Null if not shown."),
  currency: z.string().nullable().describe("ISO 4217 code of that price, e.g. USD, EUR."),
  shippingCost: z
    .number()
    .nullable()
    .describe(
      "Cheapest shipping cost to the target country, 0 when shipping is free, null if not shown.",
    ),
  deliveryDaysMin: z
    .number()
    .nullable()
    .describe("Minimum delivery time in days, null if not shown."),
  deliveryDaysMax: z
    .number()
    .nullable()
    .describe("Maximum delivery time in days, null if not shown."),
  images: z.array(z.string()).describe("Absolute URLs of the product gallery images."),
  variants: z
    .array(
      z.object({
        name: z.string().describe("Option name, e.g. Color or Size."),
        values: z.array(z.string()).describe("Option values offered."),
      }),
    )
    .describe("Purchasable options. Empty when the product has none."),
  inStock: z.boolean().nullable(),
});

export const listingExtractionJsonSchema = z.toJSONSchema(listingExtractionSchema);

/** Lenient parse of what actually comes back (the extractor may omit or mistype fields). */
const extractedSchema = z.looseObject({
  isProductPage: z.boolean().optional().nullable(),
  title: z.string().optional().nullable(),
  price: z.coerce.number().optional().nullable(),
  currency: z.string().optional().nullable(),
  shippingCost: z.coerce.number().optional().nullable(),
  deliveryDaysMin: z.coerce.number().optional().nullable(),
  deliveryDaysMax: z.coerce.number().optional().nullable(),
  images: z.array(z.unknown()).optional().nullable(),
  variants: z
    .array(
      z.looseObject({
        name: z.string().optional().nullable(),
        values: z.array(z.unknown()).optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
  inStock: z.boolean().optional().nullable(),
});

const responseSchema = z.looseObject({
  success: z.boolean().optional(),
  error: z.string().optional().nullable(),
  data: z
    .looseObject({
      json: z.unknown().optional(),
      metadata: z
        .looseObject({
          statusCode: z.number().optional().nullable(),
          creditsUsed: z.number().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  creditsUsed: z.number().optional().nullable(),
});

export type ExtractedListing = {
  title: string | null;
  price: Money | null;
  shipping: Money | null;
  leadTimeDays: { min: number; max: number } | null;
  images: string[];
  variants: { name: string; values: string[] }[];
};

export type FirecrawlConfig = {
  apiKey: string;
  fetch: HttpFetch;
  baseUrl?: string;
};

const clean = (s: unknown, max: number) =>
  typeof s === "string"
    ? s
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

function days(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 180) return null;
  return Math.round(n);
}

/** Pure: normalizes the extractor output (exported for tests). */
export function normalizeExtraction(
  raw: unknown,
  fallbackCurrency: string,
): ExtractedListing | null {
  const parsed = extractedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const x = parsed.data;
  if (x.isProductPage === false) return null;

  const currency = /^[A-Za-z]{3}$/.test(x.currency ?? "")
    ? x.currency!.toUpperCase()
    : fallbackCurrency;
  const price = x.price && x.price > 0 ? toMoney(x.price, currency) : null;
  const shipping = toMoney(x.shippingCost, currency);

  let lo = days(x.deliveryDaysMin);
  let hi = days(x.deliveryDaysMax);
  if (lo === null) lo = hi;
  if (hi === null) hi = lo;
  const leadTimeDays =
    lo !== null && hi !== null ? { min: Math.min(lo, hi), max: Math.max(lo, hi) } : null;

  const variants = (x.variants ?? [])
    .map((v) => ({
      name: clean(v.name, 60),
      values: [...new Set((v.values ?? []).map((value) => clean(value, 80)).filter(Boolean))].slice(
        0,
        30,
      ),
    }))
    .filter((v) => v.name && v.values.length > 0)
    .slice(0, 3);

  return {
    title: clean(x.title, 255) || null,
    price,
    shipping,
    leadTimeDays,
    images: cleanImageUrls(x.images ?? [], 10),
    variants,
  };
}

const PROMPT = (currency: string, country: string) =>
  [
    "Extract the offer of the single product sold on this page.",
    `The buyer ships to country ${country}. If the page shows prices in several currencies, prefer ${currency}.`,
    "Report only values printed on the page. Use null when a value is not shown; never estimate.",
    "Ignore reviews, ratings, recommendations and other products.",
  ].join(" ");

/**
 * Scrapes one listing page. Returns the normalized listing (null when the
 * page is not a product page or yields nothing usable) plus the usage to
 * record. Throws IntegrationError when Firecrawl itself fails (not billed).
 */
export async function extractListing(
  config: FirecrawlConfig,
  input: { url: string; currency: string; country: string },
): Promise<{ listing: ExtractedListing | null; usage: AiUsage }> {
  let res;
  try {
    res = await config.fetch(`${config.baseUrl ?? FIRECRAWL_BASE_URL}/v2/scrape`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        url: input.url,
        formats: [
          {
            type: "json",
            schema: listingExtractionJsonSchema,
            prompt: PROMPT(input.currency, input.country),
          },
        ],
        onlyMainContent: true,
        timeout: SCRAPE_TIMEOUT_MS,
        maxAge: MAX_AGE_MS,
        proxy: "auto",
      }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS + 10_000),
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
  const parsed = responseSchema.safeParse(body);
  if (!res.ok) {
    throw httpStatusError(PROVIDER, res.status, parsed.success ? (parsed.data.error ?? "") : "");
  }
  if (!parsed.success) {
    throw new IntegrationError(
      PROVIDER,
      "provider_error",
      "Firecrawl returned an unreadable response.",
    );
  }
  const reported = parsed.data.creditsUsed ?? parsed.data.data?.metadata?.creditsUsed;
  const usage = firecrawlUsage(typeof reported === "number" && reported > 0 ? reported : undefined);

  const status = parsed.data.data?.metadata?.statusCode ?? 200;
  if (parsed.data.success === false || status >= 400) return { listing: null, usage };
  return { listing: normalizeExtraction(parsed.data.data?.json, input.currency), usage };
}
