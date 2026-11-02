import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  IntegrationError,
  type ProductAnalysis,
  type ResolvedTikTokVideo,
} from "@/lib/domain/contracts";
import { InvalidTransitionError } from "@/lib/domain/state-machine";
import { approval, auditLog, brand, job, product, usageMonthly, video } from "@/lib/db/schema";
import { createMemoryLimiter, workspaceLimitKey } from "@/lib/workflows/concurrency";
import { loadRejectionHint } from "@/lib/workflows/steps/analyze";

import { createBrand } from "../brands";
import { ServiceError } from "../errors";
import { createMemoryRateLimiter } from "../rate-limit";
import {
  confirmProduct,
  getProduct,
  importFromProductLink,
  importFromTikTok,
  listProducts,
  rejectProduct,
  retryStep,
} from "../products";

import { fakeIntegrations, newBrandInput, setupTestEnv, testDeps, type TestEnv } from "./helpers";

let env: TestEnv;
let brandId: string;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(auditLog);
  await env.db.delete(usageMonthly);
  await env.db.delete(brand);
  brandId = (await createBrand(env.a.owner, newBrandInput())).id;
});

const TIKTOK_URL = "https://www.tiktok.com/@shop/video/7350000000000000001";

const resolved: ResolvedTikTokVideo = {
  tiktokUrl: TIKTOK_URL,
  tiktokVideoId: "7350000000000000001",
  author: { username: "shop", displayName: "Shop" },
  caption: "This lamp is amazing #tiktokmademebuyit",
  thumbnailUrl: "https://p16.tiktokcdn.example/thumb.jpg",
  stats: { views: 1000, likes: 100, comments: 10, shares: 5 },
  durationSec: 21,
  mediaUrl: "https://v16.tiktokcdn.example/signed/video.mp4?expires=123",
  mediaUrlExpiresAt: "2026-10-25T13:00:00.000Z",
  width: 1080,
  height: 1920,
};

const analysis: ProductAnalysis = {
  productName: "Sunset projection lamp",
  category: "Home decor",
  description: "A lamp that projects a sunset.",
  features: ["USB powered"],
  sellingPoints: ["Cozy light"],
  keywords: ["sunset lamp"],
  bestFrameSec: 3,
  referenceImageUrl: "https://p16.tiktokcdn.example/thumb.jpg",
  confidence: 0.92,
};

const usage = [{ provider: "google" as const, model: "gemini", costUsd: 0.0125 }];

function happyIntegrations() {
  const resolveVideo = vi.fn(async () => resolved);
  const analyze = vi.fn(async () => ({ data: analysis, usage }));
  return {
    resolveVideo,
    analyze,
    integrations: fakeIntegrations({
      tiktokData: { resolveVideo },
      productAnalyzer: { analyze },
    }),
  };
}

describe("importFromTikTok — happy path", () => {
  it("creates the product, analyses it and stops at GATE 1", async () => {
    const { integrations, resolveVideo, analyze } = happyIntegrations();
    const result = await importFromTikTok(
      env.a.creative,
      { url: `${TIKTOK_URL}?is_from_webapp=1&sender_device=pc`, brandId },
      testDeps(integrations),
    );

    expect(result.created).toBe(true);
    const p = result.product;
    expect(p).toMatchObject({
      status: "awaiting_product_confirmation",
      gate: "product_confirmation",
      name: "Sunset projection lamp",
      sourceType: "tiktok_video",
      sourceUrl: TIKTOK_URL,
      thumbnailUrl: resolved.thumbnailUrl,
      analysis,
    });

    // The analyzer got the fresh media URL and the brand language.
    expect(resolveVideo).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: env.wsA, brandId }),
      TIKTOK_URL,
    );
    expect(analyze).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "tiktok_video",
        mediaUrl: resolved.mediaUrl,
        language: "fr",
      }),
    );

    // Video row: metadata only, never the provider media URL.
    expect(p.videos).toHaveLength(1);
    expect(p.videos[0]).toMatchObject({ origin: "imported", author: "shop" });
    const [videoRow] = await env.a.owner.db.select(video);
    expect(JSON.stringify(videoRow)).not.toContain("signed/video.mp4");

    // Job progress and usage.
    expect(p.jobs).toHaveLength(1);
    expect(p.jobs[0]).toMatchObject({ step: "analyze", status: "succeeded", attempts: 1 });
    expect(p.jobs[0].aiCostUsd).toBeCloseTo(0.0125);
    const [u] = await env.a.owner.db.select(usageMonthly);
    expect(u).toMatchObject({ apiCalls: 1 });
    expect(u.aiCostUsd).toBeCloseTo(0.0125);
  });

  it("is idempotent: importing the same link again returns the existing product", async () => {
    const { integrations, analyze } = happyIntegrations();
    const deps = testDeps(integrations);
    const first = await importFromTikTok(env.a.creative, { url: TIKTOK_URL, brandId }, deps);
    const second = await importFromTikTok(
      env.a.media_buyer,
      { url: `${TIKTOK_URL}#comments`, brandId },
      deps,
    );
    expect(second.created).toBe(false);
    expect(second.product.id).toBe(first.product.id);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("imports product links through the analyzer only", async () => {
    const analyze = vi.fn(async () => ({ data: analysis, usage: [] }));
    const result = await importFromProductLink(
      env.a.creative,
      { url: "https://shop.example.com/products/lamp?variant=2#reviews", brandId },
      testDeps(fakeIntegrations({ productAnalyzer: { analyze } })),
    );
    expect(result.product.status).toBe("awaiting_product_confirmation");
    expect(result.product.sourceUrl).toBe("https://shop.example.com/products/lamp?variant=2");
    expect(analyze).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "product_link" }),
    );
    expect(result.product.videos).toEqual([]);
  });

  it("validates URLs", async () => {
    const deps = testDeps(fakeIntegrations());
    await expect(
      importFromTikTok(env.a.creative, { url: "https://example.com/v/1", brandId }, deps),
    ).rejects.toThrow();
    await expect(
      importFromProductLink(env.a.creative, { url: TIKTOK_URL, brandId }, deps),
    ).rejects.toThrow(/TikTok link/);
    await expect(
      importFromProductLink(env.a.creative, { url: "javascript:alert(1)", brandId }, deps),
    ).rejects.toThrow();
  });
});

describe("import — failure path and retry", () => {
  it("a non-retryable error fails the product with the error stored on the job", async () => {
    const analyze = vi.fn(async () => {
      throw new IntegrationError("gemini", "invalid_input", "Video could not be processed");
    });
    const { integrations: base } = happyIntegrations();
    const integrations = { ...base, productAnalyzer: { analyze } };
    const result = await importFromTikTok(
      env.a.creative,
      { url: TIKTOK_URL, brandId },
      testDeps(integrations),
    );
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.product).toMatchObject({
      status: "failed",
      failedStep: "analyze",
      error: "gemini (invalid_input): Video could not be processed",
    });
    expect(result.product.jobs[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("retryable errors are retried with backoff, then the product can be retried by hand", async () => {
    const analyze = vi
      .fn()
      .mockRejectedValue(new IntegrationError("gemini", "rate_limited", "Slow down"));
    const sleep = vi.fn(async () => undefined);
    const { integrations: base } = happyIntegrations();
    const failing = { ...base, productAnalyzer: { analyze } };

    const result = await importFromTikTok(
      env.a.creative,
      { url: TIKTOK_URL, brandId },
      testDeps(failing, { sleep }),
    );
    expect(analyze).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.product.status).toBe("failed");
    expect(result.product.jobs[0]).toMatchObject({ status: "failed", attempts: 3 });

    // Viewers cannot retry; creatives can.
    await expect(retryStep(env.a.viewer, result.product.id)).rejects.toBeInstanceOf(ForbiddenError);
    const { integrations } = happyIntegrations();
    const retried = await retryStep(env.a.creative, result.product.id, testDeps(integrations));
    expect(retried.status).toBe("awaiting_product_confirmation");
    // Same job row, attempts keep counting.
    expect(retried.jobs).toHaveLength(1);
    expect(retried.jobs[0]).toMatchObject({ status: "succeeded", attempts: 4 });

    await expect(retryStep(env.a.creative, result.product.id)).rejects.toBeInstanceOf(ServiceError);
  });

  it("respects the per-workspace concurrency limit", async () => {
    const limiter = createMemoryLimiter();
    const key = workspaceLimitKey(env.wsA, "ai");
    for (let i = 0; i < 3; i++) await limiter.tryAcquire(key, { limit: 3, ttlMs: 60_000 });

    const { integrations, analyze } = happyIntegrations();
    const result = await importFromTikTok(
      env.a.creative,
      { url: TIKTOK_URL, brandId },
      testDeps(integrations, { limiter }),
    );
    expect(analyze).not.toHaveBeenCalled();
    expect(result.product.status).toBe("failed");
    expect(result.product.error).toMatch(/Too many steps/);

    // Workspace B is unaffected by A's limit.
    const brandB = await createBrand(env.bOwner, newBrandInput("B"));
    const resultB = await importFromTikTok(
      env.bOwner,
      { url: TIKTOK_URL, brandId: brandB.id },
      testDeps(integrations, { limiter }),
    );
    expect(resultB.product.status).toBe("awaiting_product_confirmation");
  });
});

describe("GATE 1 — confirmProduct", () => {
  async function importReady() {
    const { integrations } = happyIntegrations();
    return (
      await importFromTikTok(env.a.creative, { url: TIKTOK_URL, brandId }, testDeps(integrations))
    ).product;
  }

  it("records the approval, advances to sourcing, audits, and runs the source step", async () => {
    const p = await importReady();
    const find = vi.fn(async () => ({ data: [], usage: [] }));
    await expect(confirmProduct(env.a.viewer, { productId: p.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const confirmed = await confirmProduct(
      env.a.creative,
      { productId: p.id, name: "Sunset lamp", note: "Looks right" },
      testDeps(fakeIntegrations({ supplierFinder: { find } })),
    );
    // No listing found is a valid result: the product still reaches GATE 2.
    expect(find).toHaveBeenCalledTimes(1);
    expect(confirmed.status).toBe("awaiting_supplier_choice");
    expect(confirmed.name).toBe("Sunset lamp");
    expect(confirmed.approvals).toHaveLength(1);
    expect(confirmed.approvals[0]).toMatchObject({
      gate: "product_confirmation",
      decision: "approved",
      userId: env.a.creative.actor.userId,
      note: "Looks right",
    });
    expect(confirmed.jobs.find((j) => j.step === "source")).toMatchObject({ status: "succeeded" });

    const audits = await env.a.owner.db.select(auditLog);
    expect(audits.find((a) => a.action === "gate.approve")).toMatchObject({
      targetId: p.id,
      actorUserId: env.a.creative.actor.userId,
    });

    // A second confirmation is refused and records nothing.
    await expect(
      confirmProduct(env.a.creative, { productId: p.id }, testDeps(fakeIntegrations())),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(await env.a.owner.db.count(approval)).toBe(1);
  });

  it("cannot confirm a product that is not at GATE 1", async () => {
    const db = env.a.owner.db;
    const p = await db.insert(product, {
      brandId,
      sourceType: "product_link",
      sourceUrl: "https://shop.example.com/x",
      status: "analyzing",
    });
    await expect(confirmProduct(env.a.owner, { productId: p.id })).rejects.toBeInstanceOf(
      ServiceError,
    );
    expect(await db.count(approval)).toBe(0);
  });
});

describe("product reads and tenant isolation", () => {
  it("lists with filters and hides other workspaces everywhere", async () => {
    const { integrations } = happyIntegrations();
    const deps = testDeps(integrations);
    const p = (await importFromTikTok(env.a.creative, { url: TIKTOK_URL, brandId }, deps)).product;
    await env.a.owner.db.insert(product, {
      brandId,
      sourceType: "product_link",
      sourceUrl: "https://shop.example.com/y",
    });

    const all = await listProducts(env.a.viewer);
    expect(all.total).toBe(2);
    const atGate = await listProducts(env.a.viewer, { status: "awaiting_product_confirmation" });
    expect(atGate.items.map((i) => i.id)).toEqual([p.id]);
    expect(atGate.items[0].thumbnailUrl).toBe(resolved.thumbnailUrl);
    expect((await listProducts(env.a.viewer, { brandId, limit: 1 })).items).toHaveLength(1);
    expect((await getProduct(env.a.viewer, p.id)).id).toBe(p.id);

    const b = env.bOwner;
    expect(await listProducts(b)).toEqual({ items: [], total: 0 });
    expect((await listProducts(b, { brandId })).total).toBe(0);
    await expect(getProduct(b, p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(retryStep(b, p.id, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmProduct(b, { productId: p.id }, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(importFromTikTok(b, { url: TIKTOK_URL, brandId }, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await env.bOwner.db.count(job)).toBe(0);
    expect((await getProduct(env.a.viewer, p.id)).status).toBe("awaiting_product_confirmation");
  });

  it("viewers cannot import", async () => {
    await expect(
      importFromTikTok(env.a.viewer, { url: TIKTOK_URL, brandId }, testDeps(fakeIntegrations())),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("state machine guards surface as errors, never silent changes", async () => {
    const db = env.a.owner.db;
    const p = await db.insert(product, {
      brandId,
      sourceType: "product_link",
      sourceUrl: "https://shop.example.com/z",
      status: "launched",
    });
    await expect(retryStep(env.a.owner, p.id)).rejects.toBeInstanceOf(ServiceError);
    expect(InvalidTransitionError).toBeDefined();
  });
});

describe("analyze step: fresh media and AI budget", () => {
  it("re-resolves the TikTok video when the media URL expired, then succeeds", async () => {
    const resolveVideo = vi.fn(async () => resolved);
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(
        new IntegrationError("tiktok-media", "provider_error", "Media URL responded 403.", {
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({ data: analysis, usage });
    const sleep = vi.fn(async () => undefined);
    const result = await importFromTikTok(
      env.a.creative,
      { url: TIKTOK_URL, brandId },
      testDeps(fakeIntegrations({ tiktokData: { resolveVideo }, productAnalyzer: { analyze } }), {
        sleep,
      }),
    );
    expect(result.product.status).toBe("awaiting_product_confirmation");
    expect(resolveVideo).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledTimes(2);
    // Retried inside the attempt, without waiting for backoff.
    expect(sleep).not.toHaveBeenCalled();
    expect(result.product.jobs[0]).toMatchObject({ status: "succeeded", attempts: 1 });
  });

  it("stops at the monthly AI cap without calling the analyzer", async () => {
    const { integrations, analyze } = happyIntegrations();
    const result = await importFromTikTok(
      env.a.creative,
      { url: TIKTOK_URL, brandId },
      testDeps(integrations, { aiCapUsd: 0 }),
    );
    expect(analyze).not.toHaveBeenCalled();
    expect(result.product).toMatchObject({ status: "failed", failedStep: "analyze" });
    expect(result.product.error).toMatch(/quota_exceeded/);
    expect(result.product.jobs[0].attempts).toBe(1);
  });
});

describe("import link rules and rate limit (QA S2, S6)", () => {
  it("rejects internal product links before anything is stored", async () => {
    const deps = testDeps(fakeIntegrations());
    for (const url of [
      "http://localhost:3000/api/x",
      "http://127.0.0.1/p",
      "http://169.254.169.254/latest/meta-data/",
      "https://user:pass@shop.example.com/p",
      "https://shop.example.com:8443/p",
      "http://printer.local/p",
    ]) {
      await expect(
        importFromProductLink(env.a.creative, { url, brandId }, deps),
        url,
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await env.a.owner.db.count(product)).toBe(0);
  });

  it("uses the shared normalisation (tracking params dropped) for dedupe", async () => {
    const analyze = vi.fn(async () => ({ data: analysis, usage: [] }));
    const deps = testDeps(fakeIntegrations({ productAnalyzer: { analyze } }));
    const first = await importFromProductLink(
      env.a.creative,
      { url: "https://Shop.Example.com/p?utm_source=tt&variant=2", brandId },
      deps,
    );
    expect(first.product.sourceUrl).toBe("https://shop.example.com/p?variant=2");
    const again = await importFromProductLink(
      env.a.creative,
      { url: "https://shop.example.com/p?variant=2&fbclid=abc#top", brandId },
      deps,
    );
    expect(again).toMatchObject({ created: false, product: { id: first.product.id } });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("refuses TikTok profile links as TikTok imports", async () => {
    await expect(
      importFromTikTok(
        env.a.creative,
        { url: "https://www.tiktok.com/@shop", brandId },
        testDeps(fakeIntegrations()),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("limits new imports per workspace; re-imports are not counted", async () => {
    const analyze = vi.fn(async () => ({ data: analysis, usage: [] }));
    const importLimiter = createMemoryRateLimiter(2, 3_600_000);
    const deps = testDeps(fakeIntegrations({ productAnalyzer: { analyze } }), { importLimiter });
    const url = (n: number) => ({ url: `https://shop.example.com/p/${n}`, brandId });

    await importFromProductLink(env.a.creative, url(1), deps);
    await importFromProductLink(env.a.creative, url(2), deps);
    // Re-import of an existing link: free.
    await importFromProductLink(env.a.creative, url(1), deps);
    await expect(importFromProductLink(env.a.creative, url(3), deps)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(await env.a.owner.db.count(product)).toBe(2);

    // Another workspace has its own budget.
    const brandB = await createBrand(env.bOwner, newBrandInput("B"));
    await expect(
      importFromProductLink(env.bOwner, { url: url(3).url, brandId: brandB.id }, deps),
    ).resolves.toMatchObject({ created: true });
  });
});

describe("GATE 1 - rejectProduct", () => {
  const second: ProductAnalysis = { ...analysis, productName: "Galaxy star projector" };

  async function importAtGate() {
    const analyze = vi
      .fn()
      .mockResolvedValueOnce({ data: analysis, usage })
      .mockResolvedValueOnce({ data: second, usage })
      .mockResolvedValue({ data: { ...analysis, productName: "Third try" }, usage });
    const resolveVideo = vi.fn(async () => resolved);
    const deps = testDeps(
      fakeIntegrations({
        tiktokData: { resolveVideo },
        productAnalyzer: { analyze },
        supplierFinder: { find: async () => ({ data: [], usage: [] }) },
      }),
    );
    const p = (await importFromTikTok(env.a.creative, { url: TIKTOK_URL, brandId }, deps)).product;
    return { p, analyze, deps };
  }

  it("is GATE 1 permission only", async () => {
    const { p, deps } = await importAtGate();
    await expect(rejectProduct(env.a.viewer, { productId: p.id }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      rejectProduct(env.system(env.wsA), { productId: p.id }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await env.a.owner.db.count(approval)).toBe(0);
  });

  it("records the rejection, audits it, and re-analyses from scratch", async () => {
    const { p, analyze, deps } = await importAtGate();
    const rejected = await rejectProduct(
      env.a.creative,
      { productId: p.id, note: "It is the projector, not the lamp" },
      deps,
    );

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(rejected).toMatchObject({
      status: "awaiting_product_confirmation",
      gate: "product_confirmation",
      name: "Galaxy star projector",
      analysis: second,
    });
    expect(rejected.approvals[0]).toMatchObject({
      gate: "product_confirmation",
      decision: "rejected",
      userId: env.a.creative.actor.userId,
      note: "It is the projector, not the lamp",
    });
    const [row] = await env.a.owner.db.select(approval);
    expect(row.payload).toMatchObject({
      previousName: "Sunset projection lamp",
      previousAnalysis: { productName: "Sunset projection lamp" },
    });

    // A second analyze job ran (fresh, not a reuse of the first).
    const analyzeJobs = rejected.jobs.filter((j) => j.step === "analyze");
    expect(analyzeJobs).toHaveLength(2);
    expect(analyzeJobs.every((j) => j.status === "succeeded")).toBe(true);

    const audits = await env.a.owner.db.select(auditLog);
    expect(audits.find((a) => a.action === "gate.reject")).toMatchObject({
      targetId: p.id,
      actorUserId: env.a.creative.actor.userId,
    });

    // A second rejection works the same way, then the product can be confirmed.
    const again = await rejectProduct(env.a.media_buyer, { productId: p.id }, deps);
    expect(again.name).toBe("Third try");
    expect(again.approvals.filter((a) => a.decision === "rejected")).toHaveLength(2);
    const confirmed = await confirmProduct(env.a.creative, { productId: p.id }, deps);
    expect(confirmed.status).toBe("awaiting_supplier_choice");
  });

  it("is refused outside GATE 1 and across workspaces", async () => {
    const { p, deps } = await importAtGate();
    await expect(rejectProduct(env.bOwner, { productId: p.id }, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await confirmProduct(env.a.creative, { productId: p.id }, deps);
    await expect(rejectProduct(env.a.creative, { productId: p.id }, deps)).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(
      (await env.a.owner.db.select(approval)).filter((a) => a.decision === "rejected"),
    ).toHaveLength(0);
  });

  it("a failed re-analysis (AI cap) fails the step and can be retried", async () => {
    const { p, analyze, deps } = await importAtGate();
    const failed = await rejectProduct(
      env.a.creative,
      { productId: p.id },
      { ...deps, aiCapUsd: 0 },
    );
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(failed).toMatchObject({ status: "failed", failedStep: "analyze", analysis: null });
    expect(failed.error).toMatch(/quota_exceeded/);
    // The rejection stays recorded even though the re-analysis failed.
    expect(failed.approvals[0]).toMatchObject({ decision: "rejected" });

    const retried = await retryStep(env.a.creative, p.id, deps);
    expect(retried).toMatchObject({ status: "awaiting_product_confirmation", analysis: second });
  });
});

describe("GATE 1 rejections feed the re-analysis (hint)", () => {
  it("passes notes and wrong names, most recent first; none on the first analysis", async () => {
    const names = ["Sunset projection lamp", "Galaxy star projector", "Moon lamp"];
    const analyze = vi.fn();
    for (const productName of names) {
      analyze.mockResolvedValueOnce({ data: { ...analysis, productName }, usage });
    }
    const deps = testDeps(
      fakeIntegrations({
        tiktokData: { resolveVideo: vi.fn(async () => resolved) },
        productAnalyzer: { analyze },
      }),
    );
    const p = (await importFromTikTok(env.a.creative, { url: TIKTOK_URL, brandId }, deps)).product;
    expect(analyze.mock.calls[0][1]).not.toHaveProperty("hint");

    await rejectProduct(env.a.creative, { productId: p.id, note: "It is a projector" }, deps);
    expect(analyze.mock.calls[1][1].hint).toEqual({
      note: "It is a projector",
      rejectedProductNames: ["Sunset projection lamp"],
    });

    // A rejection without a note still reports the wrong name.
    await rejectProduct(env.a.creative, { productId: p.id }, deps);
    expect(analyze.mock.calls[2][1].hint).toEqual({
      note: "It is a projector",
      rejectedProductNames: ["Galaxy star projector", "Sunset projection lamp"],
    });
  });

  it("caps the hint to the contract limits", async () => {
    const db = env.a.owner.db;
    const p = await db.insert(product, {
      brandId,
      sourceType: "product_link",
      sourceUrl: "https://shop.example.com/hint",
    });
    const base = Date.now();
    await db.insertMany(
      approval,
      Array.from({ length: 25 }, (_, i) => ({
        productId: p.id,
        gate: "product_confirmation" as const,
        userId: env.a.owner.actor.userId,
        decision: "rejected" as const,
        note: `note ${i} ${"x".repeat(200)}`,
        payload: { previousName: `Name ${i}` },
        createdAt: new Date(base + i * 1000),
      })),
    );
    const hint = await loadRejectionHint(db, p.id);
    expect(hint?.rejectedProductNames).toHaveLength(20);
    expect(hint?.rejectedProductNames?.[0]).toBe("Name 24");
    expect(hint?.note?.length).toBeLessThanOrEqual(2000);
    expect(hint?.note?.startsWith("note 24")).toBe(true);
    expect(await loadRejectionHint(db, "missing")).toBeNull();
  });
});
