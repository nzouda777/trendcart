import { z } from "zod";

import { IntegrationError, type IntegrationErrorCode } from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";

/*
 * Marketing API transport. Every response is HTTP 200 with an envelope:
 *   { code: number, message: string, request_id: string, data: {...} }
 * `code` 0 = success; anything else is mapped to an IntegrationError.
 * Tokens travel in the `Access-Token` header and are never logged.
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

  const parsed = envelopeSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new IntegrationError(
      TIKTOK_ADS_PROVIDER,
      "provider_error",
      "Unexpected TikTok Ads response.",
    );
  }
  const env = parsed.data;
  if (env.code !== 0) {
    throw new IntegrationError(
      TIKTOK_ADS_PROVIDER,
      mapAdsErrorCode(env.code),
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
