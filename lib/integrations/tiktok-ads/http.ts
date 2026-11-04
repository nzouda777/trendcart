import { createHash } from "node:crypto";

import { z } from "zod";

import { IntegrationError, type IntegrationErrorCode } from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";
import { realSleep } from "./safety";

/*
 * Marketing API transport. Every response is HTTP 200 with an envelope:
 *   { code: number, message: string, request_id: string, data: {...} }
 * `code` 0 = success; anything else is mapped to an IntegrationError.
 * Tokens travel in the `Access-Token` header and are never logged.
 *
 * TikTok ids are int64. Some responses send them as JSON numbers, which
 * JSON.parse would round past 2^53, so long integers under *_id / *_ids
 * keys are quoted before parsing (quoteBigIds).
 */

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string().optional().default(""),
  request_id: z.string().optional(),
  data: z.unknown().optional(),
});

/**
 * Marketing API return codes we treat specially: 40100 too many requests,
 * 40102/40104/40105 access token expired/empty/invalid or revoked,
 * 40001 no permission. Other 4xxxx are request errors, 5xxxx upstream.
 */
const AUTH_CODES = new Set([40102, 40104, 40105]);
const PERMISSION_CODES = new Set([40001]);
const RATE_CODES = new Set([40100]);

export function mapAdsErrorCode(code: number): IntegrationErrorCode {
  if (RATE_CODES.has(code)) return "rate_limited";
  if (AUTH_CODES.has(code)) return "auth_expired";
  if (PERMISSION_CODES.has(code)) return "permission_denied";
  if (code >= 40000 && code < 50000) return "invalid_input";
  return "provider_error";
}

/** Error raised for a non-zero envelope code; keeps the raw TikTok code. */
export class TikTokAdsApiError extends IntegrationError {
  readonly apiCode: number;
  constructor(apiCode: number, message: string) {
    super(TIKTOK_ADS_PROVIDER, mapAdsErrorCode(apiCode), message);
    this.name = "TikTokAdsApiError";
    this.apiCode = apiCode;
  }
}

/** Quotes integers of 16+ digits that sit under an `..._id` or `..._ids` key. */
export function quoteBigIds(text: string): string {
  const scalar = /("[A-Za-z0-9_]*_ids?"\s*:\s*)(-?\d{16,})(?=\s*[,}\]])/g;
  const array = /("[A-Za-z0-9_]*_ids?"\s*:\s*\[)([^\]]*)\]/g;
  return text
    .replace(scalar, '$1"$2"')
    .replace(array, (_m, head: string, body: string) => {
      const quoted = body.replace(/(^|,)(\s*)(-?\d{16,})(\s*)(?=,|$)/g, '$1$2"$3"$4');
      return `${head}${quoted}]`;
    });
}

/**
 * Deterministic request_id for create calls: TikTok de-duplicates creates
 * that reuse one, so a retried create cannot double the entity. Numeric
 * string under 2^63 (the documented int64 form).
 */
export function requestIdFor(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 15);
  return BigInt(`0x${hex}`).toString(); // < 16^15 < 2^63
}

export type AdsRequest = {
  method: "GET" | "POST";
  url: string;
  accessToken?: string;
  /** GET params; arrays and objects are JSON-encoded as the API expects. */
  query?: Record<string, unknown>;
  body?: unknown;
};

export async function adsRequest<T>(
  fetchImpl: typeof fetch,
  req: AdsRequest,
  dataSchema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(req.url);
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v === undefined) continue;
    url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (req.accessToken) headers["Access-Token"] = req.accessToken;
  if (req.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new IntegrationError(TIKTOK_ADS_PROVIDER, "provider_error", "TikTok Ads unreachable.", {
      cause,
    });
  }

  if (res.status === 429) {
    throw new IntegrationError(TIKTOK_ADS_PROVIDER, "rate_limited", "TikTok Ads rate limit.");
  }
  if (!res.ok) {
    throw new IntegrationError(
      TIKTOK_ADS_PROVIDER,
      res.status >= 500 ? "provider_error" : "invalid_input",
      `TikTok Ads HTTP ${res.status}.`,
    );
  }

  let json: unknown = null;
  try {
    json = JSON.parse(quoteBigIds(await res.text()));
  } catch {
    json = null;
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new IntegrationError(
      TIKTOK_ADS_PROVIDER,
      "provider_error",
      "Unexpected TikTok Ads response.",
    );
  }
  const env = parsed.data;
  if (env.code !== 0) {
    throw new TikTokAdsApiError(
      env.code,
      `TikTok Ads error ${env.code}: ${env.message}${env.request_id ? ` (request ${env.request_id})` : ""}`,
    );
  }
  const data = dataSchema.safeParse(env.data);
  if (!data.success) {
    throw new IntegrationError(
      TIKTOK_ADS_PROVIDER,
      "provider_error",
      "Unexpected TikTok Ads data.",
      {
        cause: data.error,
      },
    );
  }
  return data.data;
}

export type RetryPolicy = {
  /** Total attempts, first included. */
  attempts: number;
  /**
   * Whether an ambiguous failure (5xx, timeout, 5xxxx) may be retried: only
   * for reads and writes that are idempotent (status updates, creates that
   * carry a request_id). A rate-limit rejection is always retried: TikTok
   * did not process it.
   */
  idempotent: boolean;
  sleep?: (ms: number) => Promise<void>;
  baseDelayMs?: number;
};

export function isRetryable(error: unknown, idempotent: boolean): boolean {
  if (!(error instanceof IntegrationError)) return false;
  if (error.code === "rate_limited") return true;
  return idempotent && error.code === "provider_error";
}

/** Retries transient failures only, with exponential backoff. */
export async function withRetry<T>(policy: RetryPolicy, fn: () => Promise<T>): Promise<T> {
  const sleep = policy.sleep ?? realSleep;
  const base = policy.baseDelayMs ?? 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= policy.attempts || !isRetryable(error, policy.idempotent)) throw error;
      await sleep(base * 2 ** (attempt - 1));
    }
  }
}
