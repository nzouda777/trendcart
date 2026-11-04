/**
 * Per-workspace concurrency limits for pipeline steps (AI analysis, sourcing,
 * uploads), so one workspace cannot exhaust shared provider quotas.
 *
 * A limit is a counting semaphore of expiring leases stored in a Redis sorted
 * set (`member = lease id`, `score = acquired at`). Leases expire after
 * `ttlMs`, so a crashed step frees its slot on its own. Acquire runs as one
 * Lua script, so it is atomic on Upstash.
 *
 * Without UPSTASH_REDIS_REST_URL/TOKEN (local dev, tests) an in-process
 * limiter is used; it only limits within one server instance.
 */
import { Redis } from "@upstash/redis";

import { ConcurrencyLimitError } from "./retry";

export type Lease = { release(): Promise<void> };

export interface ConcurrencyLimiter {
  /** A lease, or null when `limit` leases are already held for `key`. */
  tryAcquire(key: string, options: { limit: number; ttlMs: number }): Promise<Lease | null>;
}

/** Concurrent steps per workspace, per kind of work. */
export const WORKSPACE_LIMITS = {
  /** AI analysis, copywriting, compliance (provider rate limits and cost). */
  ai: 3,
  /** Video transfers to Shopify / TikTok (bandwidth, function time). */
  upload: 2,
} as const;
export type LimitKind = keyof typeof WORKSPACE_LIMITS;

/** Longer than any step may run (well under the Vercel function limit). */
export const LEASE_TTL_MS = 5 * 60_000;

export function workspaceLimitKey(workspaceId: string, kind: LimitKind) {
  return `tc:limit:${kind}:${workspaceId}`;
}

/** Runs `fn` holding a workspace slot, or throws ConcurrencyLimitError (retryable). */
export async function withWorkspaceSlot<T>(
  limiter: ConcurrencyLimiter,
  workspaceId: string,
  kind: LimitKind,
  fn: () => Promise<T>,
): Promise<T> {
  const lease = await limiter.tryAcquire(workspaceLimitKey(workspaceId, kind), {
    limit: WORKSPACE_LIMITS[kind],
    ttlMs: LEASE_TTL_MS,
  });
  if (!lease) throw new ConcurrencyLimitError();
  try {
    return await fn();
  } finally {
    await lease.release().catch(() => undefined);
  }
}

/**
 * A mutual-exclusion lock on `name` (a semaphore of one lease, same store as
 * the workspace limits), or null when someone holds it. Expires after
 * `ttlMs` if the holder dies. Release it in a `finally`.
 */
export async function tryLock(
  limiter: ConcurrencyLimiter,
  name: string,
  ttlMs: number = LEASE_TTL_MS,
): Promise<Lease | null> {
  return limiter.tryAcquire(`tc:lock:${name}`, { limit: 1, ttlMs });
}

/* -------------------------------------------------------------------------- */
/* Upstash                                                                    */
/* -------------------------------------------------------------------------- */

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl)
if redis.call('ZCARD', key) < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, ttl)
  return 1
end
return 0
`;

/** The subset of @upstash/redis used here (lets tests pass a fake). */
export type RedisLike = {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<number>;
};

export function createRedisLimiter(
  redis: RedisLike,
  now: () => number = Date.now,
): ConcurrencyLimiter {
  return {
    async tryAcquire(key, { limit, ttlMs }) {
      const id = crypto.randomUUID();
      const ok = await redis.eval(ACQUIRE_SCRIPT, [key], [now(), ttlMs, limit, id]);
      if (Number(ok) !== 1) return null;
      return { release: async () => void (await redis.zrem(key, id)) };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* In-memory (dev and tests)                                                  */
/* -------------------------------------------------------------------------- */

export function createMemoryLimiter(now: () => number = Date.now): ConcurrencyLimiter {
  const leases = new Map<string, Map<string, number>>();
  return {
    async tryAcquire(key, { limit, ttlMs }) {
      const held = leases.get(key) ?? new Map<string, number>();
      leases.set(key, held);
      const t = now();
      for (const [id, at] of held) if (at <= t - ttlMs) held.delete(id);
      if (held.size >= limit) return null;
      const id = crypto.randomUUID();
      held.set(id, t);
      return { release: async () => void held.delete(id) };
    },
  };
}

let shared: ConcurrencyLimiter | undefined;

/** Upstash when configured, otherwise a process-local limiter. */
export function getConcurrencyLimiter(): ConcurrencyLimiter {
  if (shared) return shared;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  shared =
    url && token
      ? createRedisLimiter(new Redis({ url, token }) as unknown as RedisLike)
      : createMemoryLimiter();
  return shared;
}
