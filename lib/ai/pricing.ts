/**
 * Model ids and list prices used to turn token usage into AiUsage.costUsd.
 *
 * Sources (checked 2026-10-25):
 * - Gemini: https://ai.google.dev/gemini-api/docs/pricing (paid tier).
 *   gemini-3.8-flash: $0.75 / $3.75 per 1M input / output tokens until
 *   2026-12-31, then $1.50 / $7.50. Text, image and video input share a price.
 * - Claude: Anthropic list prices (claude-opus-5-5 $4 / $20, claude-sonnet-5-5
 *   $2 / $10, claude-haiku-5-5 $0.10 / $0.50 up to 100K-token prompts).
 *   Older ids a server-side refusal fallback may answer with (checked
 *   2026-10-31): claude-opus-5 and claude-opus-4-8 $5 / $25, claude-sonnet-5
 *   $2 / $10, claude-fable-5-1 $10 / $50.
 * - SerpApi (https://serpapi.com/pricing, checked 2026-10-31): Developer plan
 *   $75 / 5,000 searches = $0.015 per search. Cached, errored and failed
 *   searches are not counted.
 * - Firecrawl (https://www.firecrawl.dev/pricing, checked 2026-10-31): scrape
 *   1 credit, JSON format +4 credits (5 per page). Standard plan $99 / 100,000
 *   credits = $0.00099 per credit, so a JSON scrape is about $0.005.
 * - Perplexity is per-request too (not used yet).
 *
 * Unknown models fall back to a deliberately high price so a missing entry
 * over-counts rather than under-counts against the workspace cap.
 */
import type { AiUsage } from "@/lib/domain/contracts";

/** Defaults, overridable with env (see `modelIds`). */
export const DEFAULT_MODELS = {
  /** Video and page understanding (GA, recommended Flash for new projects). */
  productAnalysis: "gemini-3.8-flash",
  /** Policy check of captions/claims (cheap, structured). */
  compliance: "gemini-3.5-flash-lite",
  /** Product page copy in the brand language. */
  copywriting: "claude-opus-5-5",
} as const;

export function modelIds(env: Partial<Record<string, string | undefined>> = process.env) {
  return {
    productAnalysis: env.AI_ANALYSIS_MODEL || DEFAULT_MODELS.productAnalysis,
    compliance: env.AI_COMPLIANCE_MODEL || DEFAULT_MODELS.compliance,
    copywriting: env.AI_COPYWRITING_MODEL || DEFAULT_MODELS.copywriting,
  };
}

/** Per-request providers: USD per billable unit (see header). */
export const REQUEST_PRICES = {
  serpapiSearchUsd: 0.015,
  firecrawlCreditUsd: 0.00099,
  /** Credits per scrape with the JSON (LLM extraction) format. */
  firecrawlJsonScrapeCredits: 5,
} as const;

/** AiUsage for one SerpApi search (`engine` as the model, e.g. "google_lens"). */
export function serpApiUsage(engine: string): AiUsage {
  return { provider: "serpapi", model: engine, costUsd: REQUEST_PRICES.serpapiSearchUsd };
}

/** AiUsage for one Firecrawl call billed in credits. */
export function firecrawlUsage(
  credits: number = REQUEST_PRICES.firecrawlJsonScrapeCredits,
  model = "scrape_json",
): AiUsage {
  const costUsd = Math.round(credits * REQUEST_PRICES.firecrawlCreditUsd * 1e6) / 1e6;
  return { provider: "firecrawl", model, costUsd };
}

type PricePoint = {
  /** First day (UTC, YYYY-MM-DD) this price applies. */
  from: string;
  inputPerMTok: number;
  outputPerMTok: number;
};

/** Newest price point last. */
export const MODEL_PRICES: Record<string, PricePoint[]> = {
  "gemini-3.8-flash": [
    { from: "2026-01-01", inputPerMTok: 0.75, outputPerMTok: 3.75 },
    { from: "2027-01-01", inputPerMTok: 1.5, outputPerMTok: 7.5 },
  ],
  "gemini-3.6-flash": [
    { from: "2026-01-01", inputPerMTok: 0.75, outputPerMTok: 3.75 },
    { from: "2027-01-01", inputPerMTok: 1.5, outputPerMTok: 7.5 },
  ],
  "gemini-3.5-flash-lite": [{ from: "2026-01-01", inputPerMTok: 0.3, outputPerMTok: 2.5 }],
  "gemini-2.5-flash": [{ from: "2025-01-01", inputPerMTok: 0.3, outputPerMTok: 2.5 }],
  "claude-opus-5-5": [{ from: "2026-01-01", inputPerMTok: 4, outputPerMTok: 20 }],
  "claude-sonnet-5-5": [{ from: "2026-01-01", inputPerMTok: 2, outputPerMTok: 10 }],
  "claude-haiku-5-5": [{ from: "2026-01-01", inputPerMTok: 0.1, outputPerMTok: 0.5 }],
  "claude-opus-5": [{ from: "2026-01-01", inputPerMTok: 5, outputPerMTok: 25 }],
  "claude-opus-4-8": [{ from: "2026-01-01", inputPerMTok: 5, outputPerMTok: 25 }],
  "claude-sonnet-5": [{ from: "2026-01-01", inputPerMTok: 2, outputPerMTok: 10 }],
  "claude-fable-5-1": [{ from: "2026-01-01", inputPerMTok: 10, outputPerMTok: 50 }],
};

export const FALLBACK_PRICE: PricePoint = {
  from: "1970-01-01",
  inputPerMTok: 10,
  outputPerMTok: 50,
};

export function priceFor(model: string, at: Date = new Date()): PricePoint {
  const points = MODEL_PRICES[model];
  if (!points?.length) return FALLBACK_PRICE;
  const day = at.toISOString().slice(0, 10);
  let current = points[0]!;
  for (const p of points) if (p.from <= day) current = p;
  return current;
}

/** USD cost of one call, rounded to 1e-6. */
export function tokenCostUsd(
  model: string,
  tokens: { inputTokens?: number; outputTokens?: number },
  at?: Date,
): number {
  const price = priceFor(model, at);
  const cost =
    ((tokens.inputTokens ?? 0) * price.inputPerMTok +
      (tokens.outputTokens ?? 0) * price.outputPerMTok) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

/** Builds the AiUsage entry for a token-billed call. */
export function tokenUsage(
  provider: AiUsage["provider"],
  model: string,
  tokens: { inputTokens?: number; outputTokens?: number },
  at?: Date,
): AiUsage {
  const inputTokens = Math.max(0, Math.round(tokens.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(tokens.outputTokens ?? 0));
  return {
    provider,
    model,
    costUsd: tokenCostUsd(model, { inputTokens, outputTokens }, at),
    inputTokens,
    outputTokens,
  };
}
