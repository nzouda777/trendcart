import "server-only";

/**
 * Outbound HTTP for the sourcing/AI adapters, routed through the brand proxy
 * when the caller's CallContext carries one (decrypted by the service layer).
 *
 * - `http(s)://user:pass@host:port` -> undici ProxyAgent (HTTP CONNECT)
 * - `socks5://user:pass@host:port`  -> undici Socks5ProxyAgent
 * - no proxy                        -> SSRF-guarded undici Agent (net-guard.ts)
 *
 * Dispatchers are cached per proxy URL (bounded) so connections are pooled
 * across calls in the same function instance. Never log the proxy URL: it
 * carries credentials.
 */
import {
  fetch as undiciFetch,
  ProxyAgent,
  Socks5ProxyAgent,
  type Dispatcher,
  type RequestInit,
  type Response,
} from "undici";

import { IntegrationError, type CallContext } from "@/lib/domain/contracts";

import { findBlockedAddress, guardedDispatcher } from "./net-guard";

export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CACHED_DISPATCHERS = 32;

const dispatchers = new Map<string, Dispatcher>();

export type ProxyKind = "http" | "socks5";

/** Proxy schemes this module can dial (keep lib/services proxy validation in sync). */
export const PROXY_SCHEMES = ["http:", "https:", "socks:", "socks5:", "socks5h:"] as const;
const SOCKS_SCHEMES = new Set(["socks:", "socks5:", "socks5h:"]);

/** Validates a proxy URL and tells which agent it needs. Throws invalid_input. */
export function proxyKind(proxyUrl: string): ProxyKind {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    throw new IntegrationError(
      "proxy",
      "invalid_input",
      "The brand proxy URL is not a valid URL.",
      {
        retryable: false,
      },
    );
  }
  if (url.protocol === "http:" || url.protocol === "https:") return "http";
  if (SOCKS_SCHEMES.has(url.protocol)) return "socks5";
  throw new IntegrationError(
    "proxy",
    "invalid_input",
    `Unsupported proxy scheme "${url.protocol}". Use http, https, socks5 or socks5h.`,
    { retryable: false },
  );
}

function buildDispatcher(proxyUrl: string): Dispatcher {
  if (proxyKind(proxyUrl) === "socks5") {
    const url = new URL(proxyUrl);
    const username = decodeURIComponent(url.username) || undefined;
    const password = decodeURIComponent(url.password) || undefined;
    url.username = "";
    url.password = "";
    // undici dials SOCKS5 with the target hostname (remote DNS), so socks5h behaves the same.
    const target = url.href.replace(/^(socks|socks5h):/, "socks5:");
    return new Socks5ProxyAgent(target, { username, password });
  }
  return new ProxyAgent(proxyUrl);
}

/**
 * The dispatcher for a call: undefined (direct) without proxy, otherwise a
 * cached proxy agent for that URL.
 */
export function selectDispatcher(proxyUrl: string | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined;
  const cached = dispatchers.get(proxyUrl);
  if (cached) return cached;

  const dispatcher = buildDispatcher(proxyUrl);
  if (dispatchers.size >= MAX_CACHED_DISPATCHERS) {
    const oldest = dispatchers.keys().next().value;
    if (oldest !== undefined) {
      void dispatchers
        .get(oldest)
        ?.close()
        .catch(() => undefined);
      dispatchers.delete(oldest);
    }
  }
  dispatchers.set(proxyUrl, dispatcher);
  return dispatcher;
}

/** Test hook: drops cached dispatchers. */
export function resetDispatcherCache(): void {
  for (const d of dispatchers.values()) void d.close().catch(() => undefined);
  dispatchers.clear();
}

export type HttpClientOptions = {
  /** Base fetch; tests inject a fake. Defaults to undici's fetch. */
  fetch?: HttpFetch;
  timeoutMs?: number;
  /** Dispatcher for direct (non-proxied) requests. Defaults to the SSRF-guarded agent. */
  directDispatcher?: Dispatcher;
};

/**
 * A fetch bound to the caller's network path and a default timeout. Callers
 * may still pass their own `signal`.
 * - With a brand proxy: the proxy agent (the proxy resolves the target; the
 *   proxy URL itself is validated as public by lib/services).
 * - Without: the SSRF-guarded agent (net-guard.ts), which refuses to connect
 *   to non-public addresses on every connection, redirect hops included.
 */
export function createHttpClient(
  ctx: Pick<CallContext, "proxyUrl">,
  options: HttpClientOptions = {},
): HttpFetch {
  const base = options.fetch ?? (undiciFetch as HttpFetch);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dispatcher =
    selectDispatcher(ctx.proxyUrl) ?? options.directDispatcher ?? guardedDispatcher();

  return (input, init = {}) =>
    base(input, {
      ...init,
      dispatcher,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
}

/** Maps an HTTP failure to the contract's IntegrationError. */
export function httpStatusError(
  provider: string,
  status: number,
  detail: string,
): IntegrationError {
  const message = `${provider} responded ${status}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
  if (status === 401 || status === 403) {
    return new IntegrationError(provider, "permission_denied", message, { retryable: false });
  }
  if (status === 402) {
    return new IntegrationError(
      provider,
      "provider_error",
      `${message} (provider credits exhausted)`,
      {
        retryable: false,
      },
    );
  }
  if (status === 404 || status === 410) return new IntegrationError(provider, "not_found", message);
  if (status === 429) return new IntegrationError(provider, "rate_limited", message);
  if (status === 400 || status === 422) {
    return new IntegrationError(provider, "invalid_input", message, { retryable: false });
  }
  return new IntegrationError(provider, "provider_error", message);
}

/** Wraps network-level failures (DNS, reset, timeout) as retryable provider errors. */
export function networkError(provider: string, cause: unknown): IntegrationError {
  if (cause instanceof IntegrationError) return cause;
  const blockedAddress = findBlockedAddress(cause);
  if (blockedAddress) {
    return new IntegrationError(
      provider,
      "invalid_input",
      "This link points to a private or internal address.",
      {
        cause: blockedAddress,
        retryable: false,
      },
    );
  }
  const name = cause instanceof Error ? cause.name : "Error";
  const timedOut = name === "TimeoutError" || name === "AbortError";
  return new IntegrationError(
    provider,
    "provider_error",
    timedOut ? `${provider} request timed out.` : `${provider} request failed (${name}).`,
    { cause, retryable: true },
  );
}
