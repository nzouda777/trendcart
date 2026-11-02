import { describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/domain/contracts";
import { assertNoMediaUrl, candidateMetadata } from "@/lib/media/candidates";

import {
  createMemoryLimiter,
  createRedisLimiter,
  withWorkspaceSlot,
  type RedisLike,
} from "./concurrency";
import { gateHookToken } from "./pipeline";
import { backoffDelay, ConcurrencyLimitError, MAX_DELAY_MS, withBackoff } from "./retry";

describe("withBackoff", () => {
  it("retries retryable errors only, up to the max", async () => {
    const sleep = vi.fn(async () => undefined);
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new IntegrationError("x", "provider_error", "502"))
      .mockResolvedValueOnce("ok");
    await expect(withBackoff(flaky, { sleep })).resolves.toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(1);

    const fatal = vi.fn().mockRejectedValue(new IntegrationError("x", "invalid_input", "bad"));
    await expect(withBackoff(fatal, { sleep })).rejects.toThrow("bad");
    expect(fatal).toHaveBeenCalledTimes(1);

    const plain = vi.fn().mockRejectedValue(new Error("bug"));
    await expect(withBackoff(plain, { sleep })).rejects.toThrow("bug");
    expect(plain).toHaveBeenCalledTimes(1);

    const busy = vi.fn().mockRejectedValue(new ConcurrencyLimitError());
    await expect(withBackoff(busy, { sleep, maxAttempts: 4 })).rejects.toBeInstanceOf(
      ConcurrencyLimitError,
    );
    expect(busy).toHaveBeenCalledTimes(4);
  });

  it("grows the delay exponentially up to a cap", () => {
    const max = () => 1;
    expect(backoffDelay(1, max)).toBe(500);
    expect(backoffDelay(2, max)).toBe(1000);
    expect(backoffDelay(3, max)).toBe(2000);
    expect(backoffDelay(10, max)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(3, () => 0)).toBe(0);
  });
});

describe("concurrency limiter", () => {
  it("memory limiter enforces the limit, releases, and expires leases", async () => {
    let t = 0;
    const limiter = createMemoryLimiter(() => t);
    const opts = { limit: 2, ttlMs: 1000 };
    const l1 = await limiter.tryAcquire("k", opts);
    const l2 = await limiter.tryAcquire("k", opts);
    expect(await limiter.tryAcquire("k", opts)).toBeNull();
    expect(await limiter.tryAcquire("other", opts)).not.toBeNull();
    await l1!.release();
    expect(await limiter.tryAcquire("k", opts)).not.toBeNull();
    void l2;
    t = 5000; // every lease expired
    expect(await limiter.tryAcquire("k", opts)).not.toBeNull();
  });

  it("withWorkspaceSlot releases the slot even when the step throws", async () => {
    const limiter = createMemoryLimiter();
    for (let i = 0; i < 5; i++) {
      await expect(
        withWorkspaceSlot(limiter, "ws", "upload", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }
    await expect(withWorkspaceSlot(limiter, "ws", "upload", async () => 1)).resolves.toBe(1);
  });

  it("redis limiter runs the acquire script and removes the lease on release", async () => {
    const members = new Set<string>();
    const redis: RedisLike = {
      eval: vi.fn(async (_script, _keys, args) => {
        const [, , limit, id] = args as [number, number, number, string];
        if (members.size >= limit) return 0;
        members.add(id);
        return 1;
      }),
      zrem: vi.fn(async (_key, ...ids) => {
        ids.forEach((id) => members.delete(id));
        return ids.length;
      }),
    };
    const limiter = createRedisLimiter(redis, () => 42);
    const lease = await limiter.tryAcquire("tc:limit:ai:ws", { limit: 1, ttlMs: 1000 });
    expect(lease).not.toBeNull();
    expect(await limiter.tryAcquire("tc:limit:ai:ws", { limit: 1, ttlMs: 1000 })).toBeNull();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("ZADD"),
      ["tc:limit:ai:ws"],
      [42, 1000, 1, expect.any(String)],
    );
    await lease!.release();
    expect(members.size).toBe(0);
  });
});

describe("video candidates", () => {
  it("never keeps the provider media URL", () => {
    const meta = candidateMetadata({
      tiktokUrl: "https://www.tiktok.com/@a/video/1",
      tiktokVideoId: "1",
      author: { username: "a" },
      caption: "c",
      thumbnailUrl: "https://cdn.example/t.jpg",
      stats: { views: 1, likes: 1, comments: 1, shares: 1 },
      durationSec: 10,
      mediaUrl: "https://cdn.example/signed.mp4",
      width: 1080,
      height: 1920,
    });
    expect(JSON.stringify(meta)).not.toContain("signed.mp4");
    expect(meta).toMatchObject({ width: 1080, height: 1920 });
    expect(() => assertNoMediaUrl(meta)).not.toThrow();
    expect(() => assertNoMediaUrl({ mediaUrl: "x" })).toThrow();
  });
});

describe("gate hook tokens", () => {
  it("are unique per workspace, product and gate", () => {
    expect(gateHookToken("w", "p", "launch")).toBe("tc:gate:w:p:launch");
    expect(gateHookToken("w", "p", "launch")).not.toBe(gateHookToken("w", "p", "supplier_choice"));
  });
});
