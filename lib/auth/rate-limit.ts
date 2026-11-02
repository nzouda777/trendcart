import { Redis } from "@upstash/redis";
import type { BetterAuthRateLimitOptions } from "better-auth";

/*
 * Rate limiting for the Better Auth endpoints.
 *
 * - Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (shared across
 *   serverless instances, which is what production needs);
 * - otherwise Better Auth's in-memory store (dev and tests: per process).
 *
 * Credential-guessing endpoints get much stricter limits than the default.
 */

type Storage = NonNullable<BetterAuthRateLimitOptions["customStorage"]>;

/** Window in seconds, max requests per window, per client IP and path. */
export const AUTH_RATE_LIMIT_RULES = {
  "/sign-in/*": { window: 60, max: 5 },
  "/sign-up/*": { window: 60, max: 3 },
  "/two-factor/*": { window: 60, max: 5 },
  "/send-verification-email": { window: 300, max: 3 },
  "/request-password-reset": { window: 300, max: 3 },
  "/organization/invite-member": { window: 60, max: 10 },
} as const;

const DEFAULT_RULE = { window: 60, max: 100 };
const KEY_PREFIX = "tc:auth-rl:";

/** Atomic fixed-window counter: INCR + EXPIRE NX in one round trip. */
export function createUpstashRateLimitStorage(redis: Redis): Storage {
  return {
    async consume(key, rule) {
      const k = `${KEY_PREFIX}${key}`;
      const [count] = await redis
        .multi()
        .incr(k)
        .expire(k, rule.window, "nx")
        .exec<[number, number]>();
      if (count <= rule.max) return { allowed: true, retryAfter: null };
      const ttl = await redis.ttl(k);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
    },
  };
}

export function authRateLimitOptions(
  env: Record<string, string | undefined> = process.env,
): BetterAuthRateLimitOptions {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const base = {
    enabled: true,
    window: DEFAULT_RULE.window,
    max: DEFAULT_RULE.max,
    customRules: { ...AUTH_RATE_LIMIT_RULES },
  };
  return url && token
    ? { ...base, customStorage: createUpstashRateLimitStorage(new Redis({ url, token })) }
    : { ...base, storage: "memory" };
}
