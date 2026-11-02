import { describe, expect, it, vi } from "vitest";

import { isTikTokVideoUrl, tiktokVideoUrlSchema } from "@/lib/domain/contracts";
import { resolveIntegrationsMode } from "@/lib/integrations/mode";

import { safeNextPath } from "./paths";
import { authRateLimitOptions, createUpstashRateLimitStorage } from "./rate-limit";

describe("safeNextPath (S1)", () => {
  const ORIGIN = "https://app.trendcart.test";

  it("keeps same-origin paths, query and hash", () => {
    expect(safeNextPath("/app/products?x=1#top")).toBe("/app/products?x=1#top");
    expect(safeNextPath("/sign-up/invite/abc")).toBe("/sign-up/invite/abc");
    expect(safeNextPath("/app/../app/brands")).toBe("/app/brands");
  });

  it("refuses anything a browser could resolve to another origin", () => {
    for (const bad of [
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/\t\\evil.example",
      "/\\evil.example",
      "/%09/evil.example/../",
      "//evil.example",
      "/\u0000/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      const out = safeNextPath(bad);
      expect(new URL(out, ORIGIN).origin, JSON.stringify(bad)).toBe(ORIGIN);
    }
    expect(safeNextPath("/\t/evil.example")).toBe("/app");
    expect(safeNextPath("//evil.example", "")).toBe("");
  });
});

describe("resolveIntegrationsMode (S8)", () => {
  it("defaults to mock outside production", () => {
    expect(resolveIntegrationsMode({})).toBe("mock");
    expect(resolveIntegrationsMode({ VERCEL_ENV: "preview" })).toBe("mock");
    expect(resolveIntegrationsMode({ INTEGRATIONS_MODE: "live" })).toBe("live");
  });

  it("refuses mock or unset mode on Vercel production", () => {
    expect(() => resolveIntegrationsMode({ VERCEL_ENV: "production" })).toThrow(/must be set/);
    expect(() =>
      resolveIntegrationsMode({ VERCEL_ENV: "production", INTEGRATIONS_MODE: "mock" }),
    ).toThrow(/not allowed/);
    expect(resolveIntegrationsMode({ VERCEL_ENV: "production", INTEGRATIONS_MODE: "live" })).toBe(
      "live",
    );
    expect(() => resolveIntegrationsMode({ INTEGRATIONS_MODE: "nope" })).toThrow();
  });
});

describe("tiktokVideoUrlSchema (N5)", () => {
  it("accepts video and short links", () => {
    for (const ok of [
      "https://www.tiktok.com/@demo.user/video/7412345678901234567",
      "https://www.tiktok.com/@demo/video/7412345678901234567?is_from_webapp=1",
      "https://www.tiktok.com/@demo/photo/7412345678901234567",
      "https://m.tiktok.com/v/7412345678901234567.html",
      "https://www.tiktok.com/embed/v2/7412345678901234567",
      "https://vm.tiktok.com/ZMabc123/",
      "https://vt.tiktok.com/ZSabc123",
      "https://www.tiktok.com/t/ZTabc123/",
    ]) {
      expect(tiktokVideoUrlSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejects profiles, tags, other hosts and odd URLs", () => {
    for (const bad of [
      "https://www.tiktok.com/@demo",
      "https://www.tiktok.com/tag/gadgets",
      "https://www.tiktok.com/music/x-123",
      "https://www.tiktok.com/@demo/video/123",
      "https://evil-tiktok.com/@demo/video/7412345678901234567",
      "https://user:pass@www.tiktok.com/@demo/video/7412345678901234567",
      "https://www.tiktok.com:8443/@demo/video/7412345678901234567",
      "ftp://www.tiktok.com/@demo/video/7412345678901234567",
      "https://vm.tiktok.com/",
    ]) {
      expect(isTikTokVideoUrl(bad), bad).toBe(false);
    }
  });
});

describe("auth rate limiting (S5)", () => {
  it("uses memory without Upstash and Upstash custom storage when configured", () => {
    const memory = authRateLimitOptions({});
    expect(memory).toMatchObject({ enabled: true, storage: "memory" });
    expect(memory.customRules?.["/sign-in/*"]).toEqual({ window: 60, max: 5 });
    expect(memory.customRules?.["/two-factor/*"]).toEqual({ window: 60, max: 5 });
    expect(memory.customRules?.["/sign-up/*"]).toEqual({ window: 60, max: 3 });

    const upstash = authRateLimitOptions({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    });
    expect(upstash.customStorage).toBeDefined();
    expect(upstash.storage).toBeUndefined();
  });

  it("counts atomically per key and reports retryAfter", async () => {
    const counts = new Map<string, number>();
    const expire = vi.fn();
    const fake = {
      multi() {
        const ops: (() => unknown)[] = [];
        const chain = {
          incr(k: string) {
            ops.push(() => {
              const n = (counts.get(k) ?? 0) + 1;
              counts.set(k, n);
              return n;
            });
            return chain;
          },
          expire(k: string, s: number, opt: string) {
            ops.push(() => expire(k, s, opt) ?? 1);
            return chain;
          },
          async exec() {
            return ops.map((op) => op());
          },
        };
        return chain;
      },
      ttl: vi.fn(async () => 42),
    };
    const storage = createUpstashRateLimitStorage(
      fake as unknown as Parameters<typeof createUpstashRateLimitStorage>[0],
    );
    const rule = { window: 60, max: 2 };
    expect(await storage.consume("1.2.3.4|/sign-in/email", rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect((await storage.consume("1.2.3.4|/sign-in/email", rule)).allowed).toBe(true);
    expect(await storage.consume("1.2.3.4|/sign-in/email", rule)).toEqual({
      allowed: false,
      retryAfter: 42,
    });
    expect((await storage.consume("5.6.7.8|/sign-in/email", rule)).allowed).toBe(true);
    expect(expire).toHaveBeenCalledWith("tc:auth-rl:1.2.3.4|/sign-in/email", 60, "nx");
  });
});
