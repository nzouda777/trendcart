/**
 * Minimal Admin GraphQL transport: one POST per call, typed errors, no SDK.
 * `fetch` is injectable so tests replay recorded responses.
 *
 * Rate limits: the Admin API is a cost-based leaky bucket. A THROTTLED
 * response carries `extensions.cost.throttleStatus` (currentlyAvailable,
 * restoreRate per second) and the request's `requestedQueryCost`; an HTTP 429
 * may carry Retry-After. We wait exactly long enough for the bucket to refill
 * (capped at THROTTLE_MAX_WAIT_MS) and retry up to THROTTLE_MAX_RETRIES
 * times, then surface a retryable `rate_limited` error for the workflow
 * runner's backoff. Throttled requests are not executed by Shopify, so
 * retrying a mutation is safe.
 */
import { shopDomainSchema, type ShopifyCredentials } from "@/lib/domain/contracts";

import { THROTTLE_MAX_RETRIES, THROTTLE_MAX_WAIT_MS } from "./config";
import { codeForStatus, shopifyError } from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export type GraphqlOptions = {
  apiVersion: string;
  fetch?: FetchLike;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injectable for tests. */
  sleep?: Sleep;
  maxThrottleRetries?: number;
};

type GraphqlError = { message: string; extensions?: { code?: string } };

type CostExtensions = {
  cost?: {
    requestedQueryCost?: number | null;
    throttleStatus?: {
      maximumAvailable?: number;
      currentlyAvailable?: number;
      restoreRate?: number;
    } | null;
  };
};

export type UserError = { field?: string[] | null; message: string; code?: string | null };

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function adminGraphqlUrl(shopDomain: string, apiVersion: string): string {
  return `https://${shopDomainSchema.parse(shopDomain)}/admin/api/${apiVersion}/graphql.json`;
}

/** Milliseconds until the bucket holds enough points for this request (min 250 ms). */
export function throttleWaitMs(extensions: CostExtensions | undefined): number {
  const cost = extensions?.cost;
  const status = cost?.throttleStatus;
  const requested = cost?.requestedQueryCost ?? 0;
  const available = status?.currentlyAvailable ?? 0;
  const rate = status?.restoreRate ?? 0;
  if (rate <= 0) return 1_000;
  const deficit = Math.max(0, requested - available);
  return Math.min(THROTTLE_MAX_WAIT_MS, Math.max(250, Math.ceil((deficit / rate) * 1000)));
}

function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1_000;
  return Math.min(THROTTLE_MAX_WAIT_MS, Math.ceil(seconds * 1000));
}

export async function adminGraphql<T>(
  creds: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> | undefined,
  options: GraphqlOptions,
): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? realSleep;
  const maxRetries = options.maxThrottleRetries ?? THROTTLE_MAX_RETRIES;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await doFetch(adminGraphqlUrl(creds.shopDomain, options.apiVersion), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Shopify-Access-Token": creds.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        cache: "no-store",
      });
    } catch (cause) {
      throw shopifyError("provider_error", "Shopify Admin API request failed.", { cause });
    }

    if (response.status === 429 && attempt < maxRetries) {
      await sleep(retryAfterMs(response.headers.get("Retry-After")));
      continue;
    }
    if (!response.ok) {
      const code = codeForStatus(response.status);
      throw shopifyError(code, `Shopify Admin API responded ${response.status}.`, {
        retryable: code === "rate_limited" || response.status >= 500,
      });
    }

    let payload: { data?: T | null; errors?: GraphqlError[] | string; extensions?: CostExtensions };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (cause) {
      throw shopifyError("provider_error", "Shopify Admin API returned invalid JSON.", { cause });
    }

    if (payload.errors) {
      const errors = Array.isArray(payload.errors)
        ? payload.errors
        : [{ message: String(payload.errors) }];
      const codes = errors.map((e) => e.extensions?.code);
      const message = errors.map((e) => e.message).join("; ");
      if (codes.includes("THROTTLED")) {
        if (attempt < maxRetries) {
          await sleep(throttleWaitMs(payload.extensions));
          continue;
        }
        throw shopifyError("rate_limited", message);
      }
      if (codes.includes("ACCESS_DENIED")) throw shopifyError("permission_denied", message);
      if (!payload.data) throw shopifyError("provider_error", message);
    }
    if (!payload.data) throw shopifyError("provider_error", "Shopify Admin API returned no data.");
    return payload.data;
  }
}

/** Throws invalid_input when a mutation returned userErrors. */
export function assertNoUserErrors(operation: string, errors: UserError[] | undefined): void {
  if (!errors || errors.length === 0) return;
  const detail = errors
    .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
    .join("; ");
  throw shopifyError("invalid_input", `${operation} failed: ${detail}`);
}
