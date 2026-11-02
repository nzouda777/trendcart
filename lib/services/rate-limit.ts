import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import type { ServiceDeps } from "./deps";
import { ServiceError } from "./errors";

/*
 * Per-workspace rate limits for expensive service actions.
 *
 * Imports: each new import runs an AI analysis, so a workspace may start at
 * most IMPORT_RATE_LIMIT_PER_HOUR (default 20) new imports per sliding hour.
 * Re-importing an existing link is free and not counted.
 *
 * Upstash sliding window when UPSTASH_REDIS_REST_URL/TOKEN are set; otherwise
 * an in-process sliding window (dev and tests; per server instance only).
 */

export type RateLimitResult = { success: boolean; remaining: number; reset: number };

export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

export const DEFAULT_IMPORTS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

export function importsPerHour(
  env: Partial<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.IMPORT_RATE_LIMIT_PER_HOUR;
  if (raw === undefined || raw.trim() === "") return DEFAULT_IMPORTS_PER_HOUR;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("IMPORT_RATE_LIMIT_PER_HOUR must be a positive integer.");
  }
  return value;
}

/** In-process sliding window. */
export function createMemoryRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async limit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
      const success = recent.length < max;
      if (success) recent.push(t);
      hits.set(key, recent);
      const reset = (recent[0] ?? t) + windowMs;
      return { success, remaining: Math.max(0, max - recent.length), reset };
    },
  };
}

let importLimiter: RateLimiter | undefined;

function getImportLimiter(): RateLimiter {
  if (importLimiter) return importLimiter;
  const max = importsPerHour();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const upstash = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(max, "1 h"),
      prefix: "tc:rl:import",
    });
    importLimiter = {
      async limit(key) {
        const r = await upstash.limit(key);
        return { success: r.success, remaining: r.remaining, reset: r.reset };
      },
    };
  } else {
    importLimiter = createMemoryRateLimiter(max, HOUR_MS);
  }
  return importLimiter;
}

/** Throws ServiceError("rate_limited") when the workspace used its hourly imports. */
export async function enforceImportLimit(workspaceId: string, deps: ServiceDeps): Promise<void> {
  const limiter = deps.importLimiter ?? getImportLimiter();
  const result = await limiter.limit(`workspace:${workspaceId}`);
  if (!result.success) {
    const minutes = Math.max(1, Math.ceil((result.reset - Date.now()) / 60_000));
    throw new ServiceError(
      "rate_limited",
      `This workspace reached its hourly import limit. Try again in about ${minutes} min.`,
    );
  }
}

/*
 * Paid rebuilds (QA S5): "none of these" at GATE 2 runs a new supplier search
 * (SerpApi + Firecrawl), a GATE 3 page rejection or regeneration runs a new
 * copywriter call. Each is limited per product and per workspace on a sliding
 * hour, on top of the monthly AI cap.
 */
export const REBUILDS_PER_PRODUCT_PER_HOUR = 10;
export const REBUILDS_PER_WORKSPACE_PER_HOUR = 60;

export type RebuildLimiters = { product: RateLimiter; workspace: RateLimiter };

let rebuildLimiters: RebuildLimiters | undefined;

function createLimiter(max: number, prefix: string): RateLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return createMemoryRateLimiter(max, HOUR_MS);
  const upstash = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(max, "1 h"),
    prefix,
  });
  return {
    async limit(key) {
      const r = await upstash.limit(key);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    },
  };
}

function getRebuildLimiters(): RebuildLimiters {
  rebuildLimiters ??= {
    product: createLimiter(REBUILDS_PER_PRODUCT_PER_HOUR, "tc:rl:rebuild:product"),
    workspace: createLimiter(REBUILDS_PER_WORKSPACE_PER_HOUR, "tc:rl:rebuild:workspace"),
  };
  return rebuildLimiters;
}

function minutesUntil(reset: number) {
  return Math.max(1, Math.ceil((reset - Date.now()) / 60_000));
}

/**
 * Throws ServiceError("rate_limited") when the product, or the workspace, used
 * its hourly paid rebuilds (supplier re-search, page copy rewrite).
 */
export async function enforceRebuildLimit(
  workspaceId: string,
  productId: string,
  deps: ServiceDeps,
): Promise<void> {
  const limiters = deps.rebuildLimiters ?? getRebuildLimiters();
  const perProduct = await limiters.product.limit(`workspace:${workspaceId}:product:${productId}`);
  if (!perProduct.success) {
    throw new ServiceError(
      "rate_limited",
      `This product was rebuilt ${REBUILDS_PER_PRODUCT_PER_HOUR} times in the last hour. Try again in about ${minutesUntil(perProduct.reset)} min.`,
    );
  }
  const perWorkspace = await limiters.workspace.limit(`workspace:${workspaceId}`);
  if (!perWorkspace.success) {
    throw new ServiceError(
      "rate_limited",
      `This workspace reached its hourly limit of ${REBUILDS_PER_WORKSPACE_PER_HOUR} rebuilds. Try again in about ${minutesUntil(perWorkspace.reset)} min.`,
    );
  }
}
