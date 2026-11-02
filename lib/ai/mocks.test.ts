/**
 * Mock conformance: every mock output parses with the contract schemas, is
 * deterministic, and the pieces chain (video -> analysis -> listings -> copy).
 */
import { describe, expect, it } from "vitest";

import {
  aiUsageSchema,
  complianceReportSchema,
  pageCopySchema,
  productAnalysisSchema,
  resolvedTikTokVideoSchema,
  supplierListingSchema,
  videoCandidateSchema,
} from "@/lib/domain/contracts";
import { createComplianceChecker } from "@/lib/compliance";
import { createTikTokDataProvider } from "@/lib/integrations/tiktok-data";
import { createSupplierFinder } from "@/lib/sourcing";

import { createCopywriter, createProductAnalyzer } from ".";
import { SAMPLE_PRODUCTS } from "./sample-products";

const ctx = { workspaceId: "ws_mock" };
const tiktok = createTikTokDataProvider("mock");
const analyzer = createProductAnalyzer("mock");
const finder = createSupplierFinder("mock");
const checker = createComplianceChecker("mock");
const copywriter = createCopywriter("mock");

const VIDEO_URLS = [
  "https://www.tiktok.com/@homefinds.daily/video/7412345678901234567",
  "https://www.tiktok.com/@gadget.unboxed/video/7423456789012345678",
  "https://vm.tiktok.com/ZMh7Abc12/",
  "https://m.tiktok.com/v/7434567890123456789.html",
];

describe("mock pipeline conformance", () => {
  it.each(VIDEO_URLS)("chains every mock for %s", async (url) => {
    const video = resolvedTikTokVideoSchema.parse(await tiktok.resolveVideo(ctx, url));
    expect(await tiktok.resolveVideo(ctx, url)).toMatchObject({
      tiktokVideoId: video.tiktokVideoId,
      caption: video.caption,
    });

    const analysis = await analyzer.analyze(ctx, {
      source: "tiktok_video",
      mediaUrl: video.mediaUrl,
      caption: video.caption,
      thumbnailUrl: video.thumbnailUrl,
      language: "en",
    });
    productAnalysisSchema.parse(analysis.data);
    analysis.usage.forEach((u) => aiUsageSchema.parse(u));
    expect(analysis.usage[0]!.costUsd).toBeGreaterThan(0);
    // The mock media URL tells the analyzer which product the video shows.
    const key = new URL(video.mediaUrl).searchParams.get("tc_mock");
    expect(analysis.data.productName).toBe(SAMPLE_PRODUCTS.find((p) => p.key === key)!.productName);

    const listings = await finder.find(ctx, {
      imageUrl: analysis.data.referenceImageUrl,
      keywords: analysis.data.keywords,
      country: "FR",
      currency: "EUR",
    });
    expect(listings.data.length).toBeGreaterThan(0);
    for (const l of listings.data) {
      supplierListingSchema.parse(l);
      expect(l.price.currency).toBe("EUR");
      expect(l.title).toContain(analysis.data.productName);
    }
    listings.usage.forEach((u) => aiUsageSchema.parse(u));

    const report = await checker.check(ctx, {
      durationSec: video.durationSec,
      width: video.width,
      height: video.height,
      caption: video.caption,
      claims: analysis.data.sellingPoints,
      productCategory: analysis.data.category,
      countries: ["FR"],
    });
    complianceReportSchema.parse(report.data);
    expect(report.data.rules.some((r) => r.kind === "technical")).toBe(true);
    expect(report.data.rules.some((r) => r.kind === "policy")).toBe(true);

    for (const language of ["en", "fr"]) {
      const copy = await copywriter.writePage(ctx, {
        analysis: analysis.data,
        supplier: listings.data[0]!,
        language,
        brandName: "Lumen & Co",
      });
      pageCopySchema.parse(copy.data);
      copy.usage.forEach((u) => aiUsageSchema.parse(u));
    }
  });

  it("analyzes product links deterministically", async () => {
    const input = {
      source: "product_link" as const,
      url: "https://shop.example.com/products/portable-blender",
      language: "fr",
    };
    const a = await analyzer.analyze(ctx, input);
    const b = await analyzer.analyze(ctx, input);
    expect(a).toEqual(b);
    expect(a.data.productName).toBe("Portable USB Rechargeable Blender");
    expect(a.data.bestFrameSec).toBeNull();
  });

  it("returns search candidates of the matching product only", async () => {
    const results = await tiktok.searchVideos(ctx, { query: "portable blender", limit: 8 });
    expect(results).toHaveLength(8);
    results.forEach((r) => videoCandidateSchema.parse(r));
    expect(new Set(results.map((r) => r.tiktokVideoId)).size).toBe(8);
    for (const r of results) {
      const resolved = await tiktok.resolveVideo(ctx, r.tiktokUrl);
      expect(new URL(resolved.mediaUrl).searchParams.get("tc_mock")).toBe("portable-blender");
    }
  });

  it("rejects invalid links and empty queries like the live adapter", async () => {
    await expect(tiktok.resolveVideo(ctx, "https://example.com/x")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(tiktok.searchVideos(ctx, { query: "  " })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("live adapters fail loudly without credentials instead of returning fake data", async () => {
    const saved = { serp: process.env.SERPAPI_KEY, fc: process.env.FIRECRAWL_API_KEY };
    delete process.env.SERPAPI_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      await expect(
        createSupplierFinder("live").find(ctx, {
          imageUrl: null,
          keywords: ["x"],
          country: "US",
          currency: "USD",
        }),
      ).rejects.toMatchObject({ code: "permission_denied", retryable: false });
    } finally {
      if (saved.serp !== undefined) process.env.SERPAPI_KEY = saved.serp;
      if (saved.fc !== undefined) process.env.FIRECRAWL_API_KEY = saved.fc;
    }
  });
});

describe("mock analyzer re-analysis after a GATE 1 rejection", () => {
  it("returns a different, deterministic product when names were rejected", async () => {
    const video = await tiktok.resolveVideo(ctx, VIDEO_URLS[0]!);
    const base = { source: "tiktok_video" as const, mediaUrl: video.mediaUrl, language: "en" };
    const first = await analyzer.analyze(ctx, base);
    const hint = {
      rejectedProductNames: [first.data.productName],
      note: "Wrong item, it is the lamp",
    };
    const second = await analyzer.analyze(ctx, { ...base, hint });
    const again = await analyzer.analyze(ctx, { ...base, hint });

    expect(second.data.productName).not.toBe(first.data.productName);
    expect(again).toEqual(second);
    productAnalysisSchema.parse(second.data);

    // Rejecting every name but one lands on the remaining one.
    const all = SAMPLE_PRODUCTS.map((p) => p.productName);
    const keep = all.find((n) => n !== first.data.productName)!;
    const last = await analyzer.analyze(ctx, {
      ...base,
      hint: { rejectedProductNames: all.filter((n) => n !== keep) },
    });
    expect(last.data.productName).toBe(keep);
  });

  it("ignores an empty hint", async () => {
    const input = {
      source: "product_link" as const,
      url: "https://shop.example.com/products/portable-blender",
      language: "en",
    };
    expect(await analyzer.analyze(ctx, { ...input, hint: { rejectedProductNames: [] } })).toEqual(
      await analyzer.analyze(ctx, input),
    );
  });
});
