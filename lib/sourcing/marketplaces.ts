import "server-only";

/**
 * Official marketplace APIs for the required suppliers, so their listings come
 * with real prices in USD or EUR instead of depending on scraping pages that
 * block bots (docs checked 2026-11-04).
 *
 * CJ Dropshipping (https://developers.cjdropshipping.com, API 2.0):
 *   POST /api2.0/v1/authentication/getAccessToken { apiKey } -> data.accessToken
 *        (valid 180 days; the same token comes back for 24 h; 1 call / s)
 *   GET  /api2.0/v1/product/listV2?keyWord=&page=1&size=20   (CJ-Access-Token header)
 *        -> data.content[].productList[]: id, nameEn, bigImage, sellPrice, nowPrice,
 *           listedNum, deliveryCycle ("3-7")       prices in USD (strings)
 *   GET  /api2.0/v1/product/query?pid=  -> data.productImageSet[] (gallery)
 *
 * AliExpress Open Platform, Affiliate API (https://openservice.aliexpress.com):
 *   GET https://api-sg.aliexpress.com/sync?method=aliexpress.affiliate.product.query
 *       &app_key=&timestamp=<ms>&sign_method=sha256&sign=<HMAC-SHA256>
 *       &keywords=&target_currency=USD|EUR&target_language=EN&ship_to_country=&page_size=
 *       &tracking_id=
 *   -> aliexpress_affiliate_product_query_response.resp_result.result.products.product[]:
 *      product_id, product_title, product_main_image_url, product_small_image_urls.string[],
 *      target_sale_price, target_sale_price_currency, evaluate_rate ("97.5%"),
 *      product_detail_url
 *   sign = uppercase hex HMAC-SHA256(app_secret, concat of sorted key+value pairs).
 *
 * Credentials are optional: without them the finder falls back to a Google
 * search restricted to the marketplace (./serpapi.ts).
 */
import { createHmac } from "node:crypto";

import { z } from "zod";

import { IntegrationError } from "@/lib/domain/contracts";
import { httpStatusError, networkError, type HttpFetch } from "@/lib/integrations/tiktok-data/http";

import { cleanImageUrls, toMoney, type ListingCandidate } from "./ranking";

const TIMEOUT_MS = 25_000;

async function getJson(
  provider: string,
  fetch: HttpFetch,
  url: string | URL,
  init: NonNullable<Parameters<HttpFetch>[1]> = {},
): Promise<unknown> {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw networkError(provider, error);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw httpStatusError(provider, res.status, text.slice(0, 200));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new IntegrationError(provider, "provider_error", `${provider} returned unreadable JSON.`);
  }
}

/** "1.20 -- 3.40" / "12.5" / 12.5 → the lowest price. */
function lowestPrice(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const nums = [...v.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n > 0);
      if (nums.length) return Math.min(...nums);
    }
  }
  return null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";

/* ----------------------------------- CJ ----------------------------------- */

export const CJ_BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";
const CJ = "cjdropshipping";

export type CjConfig = { apiKey: string; fetch: HttpFetch; baseUrl?: string };

/** Access tokens per API key (180-day tokens; refreshed a day before expiry). */
const cjTokens = new Map<string, { token: string; expiresAt: number }>();

const cjEnvelope = z.looseObject({
  code: z.number().optional(),
  result: z.boolean().optional(),
  message: z.string().optional().nullable(),
  data: z.unknown().optional(),
});

function cjData(body: unknown): unknown {
  const env = cjEnvelope.parse(body);
  if (env.result === false || (env.code !== undefined && env.code !== 200)) {
    const code =
      env.code === 1600001 || env.code === 1600003 ? "permission_denied" : "provider_error";
    throw new IntegrationError(CJ, code, `CJ: ${String(env.message ?? "error").slice(0, 200)}`, {
      retryable: code !== "permission_denied",
    });
  }
  return env.data;
}

async function cjToken(config: CjConfig): Promise<string> {
  const cached = cjTokens.get(config.apiKey);
  if (cached && cached.expiresAt > Date.now() + 24 * 3600_000) return cached.token;
  const data = z
    .looseObject({ accessToken: z.string(), accessTokenExpiryDate: z.string().optional() })
    .parse(
      cjData(
        await getJson(
          CJ,
          config.fetch,
          `${config.baseUrl ?? CJ_BASE_URL}/authentication/getAccessToken`,
          {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ apiKey: config.apiKey }),
          },
        ),
      ),
    );
  const expiresAt = Date.parse(data.accessTokenExpiryDate ?? "") || Date.now() + 14 * 24 * 3600_000;
  cjTokens.set(config.apiKey, { token: data.accessToken, expiresAt });
  // CJ allows one call per second per account.
  await new Promise((r) => setTimeout(r, 1100));
  return data.accessToken;
}

const cjProductSchema = z.looseObject({
  id: z.string(),
  nameEn: z.string().optional().nullable(),
  bigImage: z.string().optional().nullable(),
  sellPrice: z.unknown().optional(),
  nowPrice: z.unknown().optional(),
  listedNum: z.number().optional().nullable(),
  deliveryCycle: z.string().optional().nullable(),
});

/** CJ catalogue search by keyword (prices in USD). */
export async function cjCandidates(
  config: CjConfig,
  input: { query: string },
): Promise<ListingCandidate[]> {
  const token = await cjToken(config);
  const url = new URL(`${config.baseUrl ?? CJ_BASE_URL}/product/listV2`);
  url.searchParams.set("keyWord", input.query);
  url.searchParams.set("page", "1");
  url.searchParams.set("size", "20");
  const data = z
    .looseObject({
      content: z.array(z.looseObject({ productList: z.array(z.unknown()).optional().nullable() })),
    })
    .safeParse(
      cjData(
        await getJson(CJ, config.fetch, url, {
          headers: { "CJ-Access-Token": token, accept: "application/json" },
        }),
      ),
    );
  if (!data.success) return [];
  const out: ListingCandidate[] = [];
  const products = data.data.content.flatMap((c) => c.productList ?? []);
  for (const [i, raw] of products.entries()) {
    const p = cjProductSchema.safeParse(raw);
    if (!p.success || !p.data.nameEn) continue;
    const lead = p.data.deliveryCycle?.match(/(\d+)\s*-\s*(\d+)/);
    out.push({
      url: `https://cjdropshipping.com/product/${slug(p.data.nameEn)}-p-${encodeURIComponent(p.data.id)}.html`,
      host: "cjdropshipping.com",
      source: CJ,
      title: p.data.nameEn.trim().slice(0, 255),
      price: toMoney(lowestPrice(p.data.nowPrice, p.data.sellPrice), "USD"),
      shipping: null,
      images: cleanImageUrls([p.data.bigImage]),
      rating: null,
      reviewCount: null,
      origin: "site",
      position: i + 1,
      extractable: false,
      leadTimeDays: lead ? { min: Number(lead[1]), max: Number(lead[2]) } : null,
      externalId: p.data.id,
    });
  }
  return out;
}

/** The product gallery of one CJ product (up to 10 images), [] when unavailable. */
export async function cjGallery(config: CjConfig, pid: string): Promise<string[]> {
  const token = await cjToken(config);
  const url = new URL(`${config.baseUrl ?? CJ_BASE_URL}/product/query`);
  url.searchParams.set("pid", pid);
  const data = z
    .looseObject({
      bigImage: z.string().optional().nullable(),
      productImageSet: z.unknown().optional(),
    })
    .safeParse(
      cjData(
        await getJson(CJ, config.fetch, url, {
          headers: { "CJ-Access-Token": token, accept: "application/json" },
        }),
      ),
    );
  if (!data.success) return [];
  const set = Array.isArray(data.data.productImageSet) ? data.data.productImageSet : [];
  return cleanImageUrls([data.data.bigImage, ...set], 10);
}

/* -------------------------------- AliExpress ------------------------------- */

export const ALIEXPRESS_GATEWAY = "https://api-sg.aliexpress.com/sync";
const ALI = "aliexpress";

export type AliExpressConfig = {
  appKey: string;
  appSecret: string;
  trackingId: string;
  fetch: HttpFetch;
  baseUrl?: string;
  now?: () => number;
};

/** IOP signature: uppercase hex HMAC-SHA256 of sorted key+value pairs (exported for tests). */
export function aliExpressSign(secret: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex").toUpperCase();
}

const aliProductSchema = z.looseObject({
  product_id: z.union([z.string(), z.number()]),
  product_title: z.string().optional().nullable(),
  product_main_image_url: z.string().optional().nullable(),
  product_small_image_urls: z
    .looseObject({ string: z.array(z.string()).optional().nullable() })
    .optional()
    .nullable(),
  target_sale_price: z.unknown().optional(),
  target_sale_price_currency: z.string().optional().nullable(),
  evaluate_rate: z.string().optional().nullable(),
});

/** AliExpress affiliate product search, priced in `currency` (USD or EUR). */
export async function aliExpressCandidates(
  config: AliExpressConfig,
  input: { query: string; currency: "USD" | "EUR"; country: string },
): Promise<ListingCandidate[]> {
  const params: Record<string, string> = {
    method: "aliexpress.affiliate.product.query",
    app_key: config.appKey,
    sign_method: "sha256",
    timestamp: String(config.now?.() ?? Date.now()),
    keywords: input.query,
    target_currency: input.currency,
    target_language: "EN",
    ship_to_country: input.country.toUpperCase(),
    page_size: "20",
    tracking_id: config.trackingId,
  };
  const url = new URL(config.baseUrl ?? ALIEXPRESS_GATEWAY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("sign", aliExpressSign(config.appSecret, params));

  const body = z
    .looseObject({
      error_response: z.looseObject({ code: z.unknown(), msg: z.string().optional() }).optional(),
      aliexpress_affiliate_product_query_response: z
        .looseObject({
          resp_result: z
            .looseObject({
              resp_code: z.number().optional(),
              resp_msg: z.string().optional().nullable(),
              result: z
                .looseObject({
                  products: z
                    .looseObject({ product: z.array(z.unknown()).optional().nullable() })
                    .optional()
                    .nullable(),
                })
                .optional()
                .nullable(),
            })
            .optional()
            .nullable(),
        })
        .optional(),
    })
    .parse(await getJson(ALI, config.fetch, url, { headers: { accept: "application/json" } }));
  if (body.error_response) {
    const msg = String(body.error_response.msg ?? body.error_response.code ?? "error");
    const denied = /appkey|sign|permission|session/i.test(msg);
    throw new IntegrationError(
      ALI,
      denied ? "permission_denied" : "provider_error",
      `AliExpress: ${msg.slice(0, 200)}`,
      {
        retryable: !denied,
      },
    );
  }
  const products =
    body.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ?? [];
  const out: ListingCandidate[] = [];
  for (const [i, raw] of products.entries()) {
    const p = aliProductSchema.safeParse(raw);
    if (!p.success || !p.data.product_title) continue;
    const id = String(p.data.product_id);
    if (!/^\d{6,}$/.test(id)) continue;
    const currency = (p.data.target_sale_price_currency ?? input.currency).toUpperCase();
    // evaluate_rate is the share of positive feedback: 96% ≈ 4.8 / 5.
    const positive = Number(p.data.evaluate_rate?.replace("%", ""));
    out.push({
      url: `https://www.aliexpress.com/item/${id}.html`,
      host: "www.aliexpress.com",
      source: ALI,
      title: p.data.product_title.trim().slice(0, 255),
      price: toMoney(lowestPrice(p.data.target_sale_price), currency),
      shipping: null,
      images: cleanImageUrls(
        [p.data.product_main_image_url, ...(p.data.product_small_image_urls?.string ?? [])],
        10,
      ),
      rating:
        Number.isFinite(positive) && positive > 0 ? Math.round((positive / 20) * 10) / 10 : null,
      reviewCount: null,
      origin: "site",
      position: i + 1,
      extractable: false,
    });
  }
  return out;
}
