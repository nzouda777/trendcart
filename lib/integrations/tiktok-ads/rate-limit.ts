import { createHash } from "node:crypto";

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { IntegrationError } from "@/lib/domain/contracts";

/*
 * Upstash-backed rate limits and locks for the TikTok adapters (Ads and
 * Posting both import this file). Without UPSTASH_REDIS_REST_URL/TOKEN
 * (mock mode, dev, tests) every call is a no-op, so nothing here can block
 * local work.
 *
 * Buckets follow TikTok's published limits, kept a little under them:
 * - Content Posting: creator_info 20/min, video/init 6/min, status/fetch
 *   30/min, all per user access token.
 * - Marketing API: limited per app and per advertiser in QPS; we stay at
 *   10 requests per second per advertiser (or per app for OAuth calls).
 */

export type RateBucket =
  | "ads.api"
  | "ads.oauth"
  | "login.oauth"
  | "posting.creator_info"
  | "posting.init"
  | "posting.status";

const BUCKETS: Record<RateBucket, { tokens: number; window: Duration }> = {
  "ads.api": { tokens: 10, window: "1 s" },
  "ads.oauth": { tokens: 20, window: "1 m" },
  "login.oauth": { tokens: 60, window: "1 m" },
  "posting.creator_info": { tokens: 18, window: "1 m" },
  "posting.init": { tokens: 5, window: "1 m" },
  "posting.status": { tokens: 27, window: "1 m" },
};

/** Never put a token in a Redis key: hash it. */
export function keyForSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url").slice(0, 22);
}

export interface RateLimiter {
  /** Waits up to `maxWaitMs` for a slot; throws IntegrationError("rate_limited") otherwise. */
  take(bucket: RateBucket, key: string, maxWaitMs?: number): Promise<void>;
  /** Runs `fn` under a short distributed lock; returns null when someone else holds it. */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null>;
}

export const noopRateLimiter: RateLimiter = {
  async take() {},
  async withLock(_key, _ttl, fn) {
    return fn();
  },
};

function createUpstashRateLimiter(redis: Redis, provider: string): RateLimiter {
  const limiters = new Map<RateBucket, Ratelimit>();
  const limiterFor = (bucket: RateBucket) => {
    let rl = limiters.get(bucket);
    if (!rl) {
      const { tokens, window } = BUCKETS[bucket];
      rl = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(tokens, window),
        prefix: `tc:rl:${bucket}`,
      });
      limiters.set(bucket, rl);
    }
    return rl;
  };

  return {
    async take(bucket, key, maxWaitMs = 5_000) {
      const res = await limiterFor(bucket).blockUntilReady(key, maxWaitMs);
      if (!res.success) {
        throw new IntegrationError(provider, "rate_limited", `Local rate limit hit (${bucket}).`);
      }
    },
    async withLock(key, ttlMs, fn) {
      const lockKey = `tc:lock:${key}`;
      const token = crypto.randomUUID();
      const ok = await redis.set(lockKey, token, { nx: true, px: ttlMs });
      if (ok !== "OK") return null;
      try {
        return await fn();
      } finally {
        // Only release our own lock.
        if ((await redis.get<string>(lockKey)) === token) await redis.del(lockKey);
      }
    },
  };
}

let shared: RateLimiter | undefined;

/** The process-wide limiter: Upstash when configured, otherwise a no-op. */
export function getRateLimiter(provider = "tiktok"): RateLimiter {
  if (shared) return shared;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  shared =
    url && token ? createUpstashRateLimiter(new Redis({ url, token }), provider) : noopRateLimiter;
  return shared;
}
