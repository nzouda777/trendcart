/**
 * "Find other TikTok videos of the same product" (M3).
 *
 * Pure helpers:
 * - `buildRelatedSearchQueries`: search queries from the product analysis
 *   (keywords most specific first, then the product name), normalised and
 *   deduplicated.
 * - `rankRelatedCandidates`: merges the results of several searches, drops
 *   the imported video, videos already attached to the product and videos
 *   TikTok ads cannot use (duration), caps videos per creator, and ranks by
 *   relevance, engagement, recency and duration fit for ads.
 *
 * And one orchestrator over the TikTokDataProvider contract,
 * `findRelatedVideos`, that runs the searches and ranks the union.
 *
 * Output is plain `VideoCandidate` data (URL, author, thumbnail, metadata),
 * re-parsed through the contract schema so a provider-signed media URL can
 * never leak into what gets stored (lib/media/candidates.ts).
 */
import {
  IntegrationError,
  videoCandidateSchema,
  type CallContext,
  type ProductAnalysis,
  type TikTokDataProvider,
  type VideoCandidate,
} from "@/lib/domain/contracts";

/** TikTok in-feed ad duration limits (same as lib/compliance TECH_LIMITS). */
const AD_MIN_SEC = 5;
const AD_MAX_SEC = 600;

export const RELATED_DEFAULTS = {
  maxQueries: 3,
  perQueryLimit: 20,
  limit: 12,
  maxPerAuthor: 2,
  /** Recency half-life in days. */
  recencyHalfLifeDays: 120,
} as const;

export const RANK_WEIGHTS = {
  relevance: 0.45,
  engagement: 0.25,
  recency: 0.15,
  durationFit: 0.15,
} as const;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "for",
  "with",
  "of",
  "to",
  "in",
  "on",
  "by",
  "or",
  "at",
  "is",
  "it",
  "this",
  "that",
  "your",
  "my",
  "new",
  "best",
  "fyp",
  "foryou",
  "foryoupage",
  "viral",
  "tiktokmademebuyit",
  "amazonfinds",
  "tiktok",
  "trending",
  "xyzbca",
]);

/** Lowercased word tokens (letters and digits, any script), hashtags split off. */
export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const normalizeQuery = (s: string) =>
  s
    .replace(/#/g, " ")
    .replace(/[^\p{L}\p{N}\s'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/**
 * Up to `max` search queries: analysis keywords in order (most specific
 * first), then the product name. Case- and token-order-insensitive dedupe;
 * single-token generic queries are skipped when better ones exist.
 */
export function buildRelatedSearchQueries(
  analysis: Pick<ProductAnalysis, "productName" | "keywords">,
  options: { max?: number } = {},
): string[] {
  const max = Math.max(1, options.max ?? RELATED_DEFAULTS.maxQueries);
  const seen = new Set<string>();
  const multi: string[] = [];
  const single: string[] = [];
  for (const raw of [...analysis.keywords, analysis.productName]) {
    const q = normalizeQuery(raw);
    const tokens = tokenize(q);
    if (!tokens.length) continue;
    const key = [...tokens].sort().join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    (tokens.length > 1 ? multi : single).push(q);
  }
  return [...multi, ...single].slice(0, max);
}

export type SearchResult = { query: string; candidates: VideoCandidate[] };

export type RankBreakdown = {
  relevance: number;
  engagement: number;
  recency: number;
  durationFit: number;
};

export type RankedCandidate = {
  candidate: VideoCandidate;
  /** 0..1 weighted score (RANK_WEIGHTS). */
  score: number;
  breakdown: RankBreakdown;
  /** Queries that returned this video. */
  matchedQueries: string[];
};

export type RankOptions = {
  /** The imported video: never offered back. */
  imported?: { tiktokVideoId?: string; tiktokUrl?: string } | null;
  /** TikTok video ids already attached to the product (or rejected). */
  excludeVideoIds?: Iterable<string>;
  /** Product terms for caption relevance (keywords, name). */
  analysis: Pick<ProductAnalysis, "productName" | "keywords">;
  now?: Date;
  limit?: number;
  maxPerAuthor?: number;
  /** Drop candidates below this relevance (0..1). Default 0: keep all. */
  minRelevance?: number;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Caption relevance: 0.3 for being returned by a product search, + up to 0.5
 * for the share of product tokens found in the caption (best of the keyword
 * phrases and the whole vocabulary), + 0.2 when several queries found it.
 */
export function relevanceScore(
  caption: string,
  analysis: Pick<ProductAnalysis, "productName" | "keywords">,
  queryHits: number,
): number {
  const captionTokens = new Set(tokenize(caption));
  const phrases = [...analysis.keywords, analysis.productName]
    .map((p) => [...new Set(tokenize(p))])
    .filter((t) => t.length > 0);
  const coverage = (tokens: string[]) => {
    if (!tokens.length) return 0;
    // Hashtags glue words together ("#sunsetlamp"): match joined forms too.
    const hit = tokens.filter(
      (t) =>
        captionTokens.has(t) ||
        [...captionTokens].some((c) => c.length > t.length && c.includes(t)),
    ).length;
    return hit / tokens.length;
  };
  const vocab = [...new Set(phrases.flat())];
  const best = Math.max(0, ...phrases.map(coverage), coverage(vocab) * 0.8);
  const multi = queryHits > 1 ? Math.min(1, (queryHits - 1) / 2) : 0;
  return clamp01(0.3 + 0.5 * best + 0.2 * multi);
}

/**
 * Engagement: interaction rate (likes + 2×comments + 3×shares per view,
 * 10 % or more = 1) blended with reach (log10 views, 10M = 1).
 */
export function engagementScore(stats: VideoCandidate["stats"]): number {
  const { views, likes, comments, shares } = stats;
  if (views <= 0) return 0;
  const rate = clamp01((likes + 2 * comments + 3 * shares) / views / 0.1);
  const reach = clamp01(Math.log10(views + 1) / 7);
  return clamp01(0.6 * rate + 0.4 * reach);
}

/** Exponential decay with a half-life; unknown dates get a neutral 0.3. */
export function recencyScore(
  postedAt: string | undefined,
  now: Date,
  halfLifeDays: number = RELATED_DEFAULTS.recencyHalfLifeDays,
): number {
  if (!postedAt) return 0.3;
  const ageDays = (now.getTime() - Date.parse(postedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0.3;
  if (ageDays <= 0) return 1;
  return clamp01(Math.pow(0.5, ageDays / halfLifeDays));
}

/**
 * Fit for TikTok in-feed ads: 9 to 60 s is ideal (TikTok's recommendation),
 * 5 to 9 s and 60 to 90 s are fine, longer gets weaker. Outside 5 s..10 min
 * TikTok rejects it (0).
 */
export function durationFitScore(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec < AD_MIN_SEC || durationSec > AD_MAX_SEC)
    return 0;
  if (durationSec >= 9 && durationSec <= 60) return 1;
  if (durationSec < 9) return 0.7;
  if (durationSec <= 90) return 0.7;
  if (durationSec <= 180) return 0.4;
  return 0.15;
}

/** Video id from a canonical TikTok URL (…/video/<id>). */
const idFromUrl = (url: string | undefined) => url?.match(/\/(?:video|photo)\/(\d{8,25})/)?.[1];

export function rankRelatedCandidates(
  results: SearchResult[],
  options: RankOptions,
): RankedCandidate[] {
  const now = options.now ?? new Date();
  const limit = Math.max(0, options.limit ?? RELATED_DEFAULTS.limit);
  const maxPerAuthor = Math.max(1, options.maxPerAuthor ?? RELATED_DEFAULTS.maxPerAuthor);
  const minRelevance = options.minRelevance ?? 0;

  const excluded = new Set<string>(options.excludeVideoIds ?? []);
  const importedId = options.imported?.tiktokVideoId ?? idFromUrl(options.imported?.tiktokUrl);
  if (importedId) excluded.add(importedId);

  // Union of all searches, by video id, remembering which queries found it.
  const byId = new Map<string, { candidate: VideoCandidate; queries: Set<string> }>();
  for (const { query, candidates } of results) {
    for (const raw of candidates) {
      // Contract parse strips anything that is not candidate metadata (e.g. mediaUrl).
      const parsed = videoCandidateSchema.safeParse(raw);
      if (!parsed.success) continue;
      const c = parsed.data;
      if (excluded.has(c.tiktokVideoId)) continue;
      if (durationFitScore(c.durationSec) === 0) continue;
      const entry = byId.get(c.tiktokVideoId);
      if (entry) entry.queries.add(query);
      else byId.set(c.tiktokVideoId, { candidate: c, queries: new Set([query]) });
    }
  }

  const scored: RankedCandidate[] = [];
  for (const { candidate, queries } of byId.values()) {
    const breakdown: RankBreakdown = {
      relevance: round(relevanceScore(candidate.caption, options.analysis, queries.size)),
      engagement: round(engagementScore(candidate.stats)),
      recency: round(recencyScore(candidate.postedAt, now)),
      durationFit: round(durationFitScore(candidate.durationSec)),
    };
    if (breakdown.relevance < minRelevance) continue;
    const score = round(
      breakdown.relevance * RANK_WEIGHTS.relevance +
        breakdown.engagement * RANK_WEIGHTS.engagement +
        breakdown.recency * RANK_WEIGHTS.recency +
        breakdown.durationFit * RANK_WEIGHTS.durationFit,
    );
    scored.push({ candidate, score, breakdown, matchedQueries: [...queries] });
  }

  // Deterministic order: score, then views, then id.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.candidate.stats.views - a.candidate.stats.views ||
      a.candidate.tiktokVideoId.localeCompare(b.candidate.tiktokVideoId),
  );

  // Diversity: at most N videos per creator.
  const perAuthor = new Map<string, number>();
  const out: RankedCandidate[] = [];
  for (const r of scored) {
    if (out.length >= limit) break;
    const author = r.candidate.author.username.toLowerCase();
    const n = perAuthor.get(author) ?? 0;
    if (n >= maxPerAuthor) continue;
    perAuthor.set(author, n + 1);
    out.push(r);
  }
  return out;
}

export type FindRelatedInput = {
  analysis: Pick<ProductAnalysis, "productName" | "keywords">;
  imported?: RankOptions["imported"];
  excludeVideoIds?: Iterable<string>;
  /** ISO 3166-1 alpha-2, e.g. the brand country. */
  country?: string;
  limit?: number;
  maxQueries?: number;
  perQueryLimit?: number;
  now?: Date;
};

export type FindRelatedResult = {
  ranked: RankedCandidate[];
  queries: string[];
  /** Queries whose search failed (the others still count). */
  failedQueries: { query: string; code: string }[];
};

/**
 * Runs the searches one after the other (each is paid; a provider rate
 * limit stops the rest) and ranks the union. Fails only when every search
 * failed. Search calls go through the brand proxy inside the provider.
 */
export async function findRelatedVideos(
  provider: Pick<TikTokDataProvider, "searchVideos">,
  ctx: CallContext,
  input: FindRelatedInput,
): Promise<FindRelatedResult> {
  const queries = buildRelatedSearchQueries(input.analysis, { max: input.maxQueries });
  const results: SearchResult[] = [];
  const failedQueries: FindRelatedResult["failedQueries"] = [];
  let firstError: unknown;
  for (const query of queries) {
    try {
      const candidates = await provider.searchVideos(ctx, {
        query,
        country: input.country,
        limit: input.perQueryLimit ?? RELATED_DEFAULTS.perQueryLimit,
      });
      results.push({ query, candidates });
    } catch (error) {
      firstError ??= error;
      const code = error instanceof IntegrationError ? error.code : "provider_error";
      failedQueries.push({ query, code });
      // Auth, quota and rate limits apply to every query: stop early.
      if (
        error instanceof IntegrationError &&
        ["auth_expired", "permission_denied", "rate_limited", "quota_exceeded"].includes(error.code)
      ) {
        break;
      }
    }
  }
  if (results.length === 0) {
    if (firstError) throw firstError;
    throw new IntegrationError("tiktok-data", "invalid_input", "No search query could be built.", {
      retryable: false,
    });
  }
  const ranked = rankRelatedCandidates(results, {
    analysis: input.analysis,
    imported: input.imported,
    excludeVideoIds: input.excludeVideoIds,
    now: input.now,
    limit: input.limit,
  });
  return { ranked, queries, failedQueries };
}
