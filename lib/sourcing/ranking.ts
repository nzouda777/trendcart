/**
 * Supplier candidate normalization, dedupe and ranking (pure).
 *
 * Discovery (SerpApi) yields candidates; this module turns their links into
 * canonical public URLs (one per product page), classifies the host, drops
 * content sites, and scores how well each one matches the analysed product.
 */
import { moneySchema, type Money } from "@/lib/domain/contracts";
import { isPublicHostname } from "@/lib/integrations/tiktok-data/net-guard";

import { normalizeProductUrl } from "./links";

export type CandidateOrigin = "lens" | "shopping";

export type ListingCandidate = {
  /** Canonical URL (dedupe key). */
  url: string;
  host: string;
  /** Contract `source`: marketplace key or bare domain. */
  source: string;
  title: string;
  /** Price shown on the search result, if any. */
  price: Money | null;
  /** Shipping/delivery shown on the search result, when parseable. */
  shipping: Money | null;
  images: string[];
  origin: CandidateOrigin;
  /** 1-based rank inside its search. */
  position: number;
  /** False for links we cannot scrape usefully (e.g. Google Shopping pages). */
  extractable: boolean;
};

/* Hosts ------------------------------------------------------------------- */

/** Marketplaces keyed by registrable domain label. `tier` 1 = wholesale/dropshipping supplier. */
const MARKETPLACES: { key: string; match: RegExp; tier: 1 | 2 }[] = [
  { key: "aliexpress", match: /(^|\.)aliexpress\.(com|us|ru)$/, tier: 1 },
  { key: "alibaba", match: /(^|\.)alibaba\.com$/, tier: 1 },
  { key: "1688", match: /(^|\.)1688\.com$/, tier: 1 },
  { key: "cjdropshipping", match: /(^|\.)cjdropshipping\.com$/, tier: 1 },
  { key: "dhgate", match: /(^|\.)dhgate\.com$/, tier: 1 },
  { key: "temu", match: /(^|\.)temu\.com$/, tier: 1 },
  { key: "banggood", match: /(^|\.)banggood\.com$/, tier: 1 },
  { key: "made-in-china", match: /(^|\.)made-in-china\.com$/, tier: 1 },
  {
    key: "amazon",
    match: /(^|\.)amazon\.(com|ca|co\.uk|de|fr|es|it|nl|com\.au|com\.mx|co\.jp|in)$/,
    tier: 2,
  },
  { key: "ebay", match: /(^|\.)ebay\.(com|ca|co\.uk|de|fr|es|it|com\.au)$/, tier: 2 },
  { key: "walmart", match: /(^|\.)walmart\.(com|ca)$/, tier: 2 },
  { key: "etsy", match: /(^|\.)etsy\.com$/, tier: 2 },
  { key: "shein", match: /(^|\.)shein\.com$/, tier: 2 },
];

/** Social, video, forum and reference sites: never a supplier listing. */
const CONTENT_HOSTS =
  /(^|\.)(reddit\.com|pinterest\.[a-z.]+|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|threads\.net|wikipedia\.org|wikimedia\.org|quora\.com|medium\.com|tumblr\.com|flickr\.com|imgur\.com|vk\.com|linkedin\.com|snapchat\.com|lemon8-app\.com)$/;

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/;

export function marketplaceFor(host: string): { key: string; tier: 1 | 2 } | null {
  const h = host.toLowerCase();
  const found = MARKETPLACES.find((m) => m.match.test(h));
  return found ? { key: found.key, tier: found.tier } : null;
}

export function isContentHost(host: string): boolean {
  return CONTENT_HOSTS.test(host.toLowerCase());
}

/** Contract `source` for a host: marketplace key, else the domain without "www.". */
export function sourceForHost(host: string): string {
  return marketplaceFor(host)?.key ?? host.toLowerCase().replace(/^www\d?\./, "");
}

/* URLs -------------------------------------------------------------------- */

/**
 * Canonical public URL for a listing link, or null when it is not a public
 * http(s) page. Marketplace product pages collapse to their id so tracking
 * and variant query strings dedupe to one URL.
 */
export function canonicalListingUrl(raw: string): string | null {
  let normalized: string;
  try {
    normalized = normalizeProductUrl(raw);
  } catch {
    return null;
  }
  const url = new URL(normalized);
  const host = url.hostname;
  const market = marketplaceFor(host)?.key;
  const path = url.pathname;

  if (market === "aliexpress") {
    const id = path.match(/\/item\/(?:[^/]+\/)?(\d{6,})\.html/)?.[1];
    if (id) return `https://www.aliexpress.com/item/${id}.html`;
  }
  if (market === "amazon") {
    const asin = path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
    if (asin) return `https://${host.replace(/^(smile|m)\./, "www.")}/dp/${asin.toUpperCase()}`;
  }
  if (market === "ebay") {
    const id = path.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/)?.[1];
    if (id) return `https://${host}/itm/${id}`;
  }
  if (market && market !== "amazon") {
    // Other marketplaces: the path identifies the product; queries are tracking/variants.
    url.search = "";
  }
  url.protocol = "https:";
  return url.href;
}

/** Keeps https image URLs on public hosts, deduped, capped. */
export function cleanImageUrls(values: unknown[], max = 8): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    let url: URL;
    try {
      url = new URL(v.trim());
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    if (!isPublicHostname(url.hostname)) continue;
    url.hash = "";
    if (!out.includes(url.href)) out.push(url.href);
    if (out.length >= max) break;
  }
  return out;
}

/* Money ------------------------------------------------------------------- */

const SYMBOLS: [RegExp, string][] = [
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/₹/, "INR"],
  [/₩/, "KRW"],
  [/R\$/, "BRL"],
  [/C\$|CA\$/, "CAD"],
  [/A\$|AU\$/, "AUD"],
  [/zł/i, "PLN"],
  [/CHF/, "CHF"],
];
const DOLLAR_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  MX: "MXN",
  SG: "SGD",
  HK: "HKD",
};

/**
 * ISO currency from a displayed price ("$12.99", "12,99 €", "EUR 12.99").
 * "$" is resolved with the search country; unknown -> `fallback`.
 */
export function currencyFromDisplay(
  display: string | null | undefined,
  country: string,
  fallback: string,
): string {
  const s = (display ?? "").trim();
  const iso = s.match(/\b([A-Z]{3})\b/)?.[1];
  if (iso && iso !== "FOB") return iso;
  for (const [re, code] of SYMBOLS) if (re.test(s)) return code;
  if (s.includes("$")) return DOLLAR_BY_COUNTRY[country.toUpperCase()] ?? "USD";
  if (/¥|￥/.test(s)) return country.toUpperCase() === "JP" ? "JPY" : "CNY";
  return fallback;
}

/** A validated Money, or null for missing / non-positive / absurd amounts. */
export function toMoney(amount: unknown, currency: string | null | undefined): Money | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 100_000) {
    return null;
  }
  const parsed = moneySchema.safeParse({
    amount: Math.round(amount * 100) / 100,
    currency: (currency ?? "").toUpperCase(),
  });
  return parsed.success ? parsed.data : null;
}

/** Shipping from a delivery line: "Free delivery" -> 0, "+$3.99 shipping" -> 3.99, else null. */
export function shippingFromDelivery(
  delivery: string | null | undefined,
  currency: string,
): Money | null {
  const s = (delivery ?? "").toLowerCase();
  if (!s) return null;
  if (/\bfree\b/.test(s)) return toMoney(0, currency);
  const m = s.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (m && /ship|deliver|livraison|envío|versand/.test(s)) {
    return toMoney(Number(m[1]!.replace(",", ".")), currency);
  }
  return null;
}

/* Matching ---------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "new",
  "hot",
  "sale",
  "best",
  "free",
  "shipping",
  "pcs",
  "set",
  "of",
  "in",
  "to",
  "a",
  "an",
  "2024",
  "2025",
  "2026",
  "mini",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/**
 * 0..1 title relevance against the analysis keywords: best single-phrase
 * coverage blended with coverage of all keyword tokens.
 */
export function keywordScore(title: string, keywords: string[]): number {
  const have = new Set(tokens(title));
  if (have.size === 0) return 0;
  const phrases = keywords.map(tokens).filter((p) => p.length > 0);
  if (phrases.length === 0) return 0;
  const cover = (p: string[]) => p.filter((t) => have.has(t)).length / p.length;
  const best = Math.max(...phrases.map(cover));
  const all = [...new Set(phrases.flat())];
  return Math.round((0.7 * best + 0.3 * cover(all)) * 1000) / 1000;
}

/** Visual-similarity proxy from the search rank (Lens ranks by similarity). */
function rankSignal(c: Pick<ListingCandidate, "origin" | "position">): number {
  if (c.origin === "shopping") return 0.45;
  return Math.max(0.3, 1 - (c.position - 1) * 0.04);
}

/** 0..1 match score of a candidate (optionally with the extracted title). */
export function matchScore(
  c: Pick<ListingCandidate, "origin" | "position" | "host" | "title" | "price">,
  keywords: string[],
): number {
  const tier = marketplaceFor(c.host)?.tier;
  const supplier = tier === 1 ? 1 : tier === 2 ? 0.5 : 0;
  const score =
    0.5 * rankSignal(c) +
    0.35 * keywordScore(c.title, keywords) +
    0.1 * supplier +
    0.05 * (c.price ? 1 : 0);
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

/**
 * Drops content hosts, dedupes by canonical URL (keeping the better-ranked
 * entry, filling a missing price/image from the duplicate), and returns the
 * candidates sorted by match score, capped at `limit`.
 */
export function rankCandidates(
  candidates: ListingCandidate[],
  keywords: string[],
  limit: number,
): ListingCandidate[] {
  const byUrl = new Map<string, ListingCandidate>();
  for (const c of candidates) {
    if (isContentHost(c.host)) continue;
    if (!c.extractable && !c.price) continue;
    const prev = byUrl.get(c.url);
    if (!prev) {
      byUrl.set(c.url, c);
      continue;
    }
    const [keep, other] =
      matchScore(c, keywords) > matchScore(prev, keywords) ? [c, prev] : [prev, c];
    byUrl.set(c.url, {
      ...keep,
      price: keep.price ?? other.price,
      shipping: keep.shipping ?? other.shipping,
      images: keep.images.length ? keep.images : other.images,
    });
  }
  return [...byUrl.values()]
    .map((c) => ({ c, s: matchScore(c, keywords) }))
    .sort((a, b) => b.s - a.s || a.c.position - b.c.position)
    .slice(0, Math.max(0, limit))
    .map(({ c }) => c);
}

export const isGoogleHost = (host: string) => GOOGLE_HOST.test(host.toLowerCase());
