import { z } from "zod";

import { IntegrationError, type IntegrationErrorCode } from "@/lib/domain/contracts";

import { TIKTOK_POSTING_PROVIDER } from "./config";

/*
 * Two response shapes on open.tiktokapis.com:
 * - OAuth (/v2/oauth/*): flat JSON, success fields or { error, error_description, log_id }.
 * - Content Posting: { data: {...}, error: { code: "ok" | "...", message, log_id } }.
 */

const providerError = (code: IntegrationErrorCode, message: string, cause?: unknown) =>
  new IntegrationError(TIKTOK_POSTING_PROVIDER, code, message, { cause });

async function send(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (cause) {
    throw providerError("provider_error", "TikTok unreachable.", cause);
  }
}

export function mapOAuthError(error: string): IntegrationErrorCode {
  switch (error) {
    case "invalid_grant": // code or refresh token expired, used or revoked
    case "access_denied":
      return "auth_expired";
    case "invalid_client":
    case "unauthorized_client":
    case "invalid_scope":
      return "permission_denied";
    case "rate_limit_exceeded":
      return "rate_limited";
    case "invalid_request":
      return "invalid_input";
    default:
      return "provider_error";
  }
}

const oauthErrorSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
  log_id: z.string().optional(),
});

export async function oauthForm<T>(
  fetchImpl: typeof fetch,
  url: string,
  form: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await send(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams(form).toString(),
  });
  const json: unknown = await res.json().catch(() => null);
  const err = oauthErrorSchema.safeParse(json);
  if (err.success) {
    throw providerError(
      mapOAuthError(err.data.error),
      `TikTok OAuth error ${err.data.error}: ${err.data.error_description ?? ""}`.trim(),
    );
  }
  if (res.status === 429) throw providerError("rate_limited", "TikTok OAuth rate limit.");
  if (!res.ok) {
    throw providerError(
      res.status >= 500 ? "provider_error" : "invalid_input",
      `TikTok OAuth HTTP ${res.status}.`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw providerError("provider_error", "Unexpected TikTok OAuth response.", parsed.error);
  return parsed.data;
}

export function mapPostingError(code: string, httpStatus: number): IntegrationErrorCode {
  if (code === "access_token_invalid") return "auth_expired";
  if (
    code === "scope_not_authorized" ||
    code === "unaudited_client_can_only_post_to_private_accounts"
  )
    return "permission_denied";
  if (code === "rate_limit_exceeded" || httpStatus === 429) return "rate_limited";
  if (code.startsWith("spam_risk") || code === "reached_active_user_cap") return "quota_exceeded";
  if (code === "invalid_publish_id") return "not_found";
  if (httpStatus >= 500 || code === "internal_error") return "provider_error";
  return "invalid_input";
}

const postingEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string().optional().default(""),
      log_id: z.string().optional(),
      logid: z.string().optional(),
    })
    .optional(),
});

export async function postingJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await send(fetchImpl, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body ?? {}),
  });
  const env = postingEnvelopeSchema.safeParse(await res.json().catch(() => null));
  if (!env.success) {
    throw providerError(
      res.status === 429 ? "rate_limited" : "provider_error",
      `TikTok HTTP ${res.status}.`,
    );
  }
  const error = env.data.error;
  if ((error && error.code !== "ok") || !res.ok) {
    const code = error?.code ?? `http_${res.status}`;
    throw providerError(
      mapPostingError(code, res.status),
      `TikTok error ${code}: ${error?.message ?? ""}`.trim(),
    );
  }
  const data = schema.safeParse(env.data.data);
  if (!data.success) throw providerError("provider_error", "Unexpected TikTok data.", data.error);
  return data.data;
}
