import { describe, expect, it } from "vitest";

import { IntegrationError, type PageCopy, type VideoCandidate } from "@/lib/domain/contracts";
import { transition } from "@/lib/domain/state-machine";
import { newCandidates, relatedVideoQuery } from "@/lib/media/candidates";
import { ensureTikTokAdsVideo, shopifyVideoAlt, tiktokAdsFileName } from "@/lib/media/videos";
import {
  adAccountUnusableReason,
  dailyBudgetMinimum,
  MAX_DAILY_BUDGET,
  maxDailyBudget,
} from "@/lib/services/campaign-read";

import {
  advertiserBudget,
  buildCampaignSpec,
  campaignName,
  MAX_ADS,
  withBudget,
} from "./campaign-spec";
import { isComplianceOutdated } from "./compliance-claims";
import {
  claimsVersion,
  complianceClaims,
  hasIncompleteAiReview,
  videosToCheck,
} from "./steps/videos";

const specInput = {
  productId: "11111111-2222-3333-4444-555555555555",
  productName: "Galaxy Lamp",
  brand: { name: "Acme", country: "FR", defaultTestBudget: 25 },
  landingPageUrl: "https://demo.myshopify.com/products/galaxy-lamp",
  adTexts: ["Light up your nights", "A sky in your room"],
  videos: [
    { id: "v1aaaaaaaa", tiktokVideoId: "tt1" },
    { id: "v2bbbbbbbb", tiktokVideoId: "tt2" },
    { id: "v3cccccccc", tiktokVideoId: "tt3" },
  ],
};

describe("campaign spec", () => {
  it("builds one ad group in the brand country with one ad per video, paused-ready", () => {
    const spec = buildCampaignSpec(specInput);
    expect(spec.name).toBe(campaignName(specInput.productId, "Galaxy Lamp"));
    expect(spec.name).toContain("TC-11111111");
    expect(spec.objective).toBe("TRAFFIC");
    expect(spec.budget).toEqual({ mode: "daily", amount: 25, level: "ad_group" });
    const group = spec.adGroups[0]!;
    expect(group.countries).toEqual(["FR"]);
    expect(group.ads.map((a) => a.videoId)).toEqual(["tt1", "tt2", "tt3"]);
    expect(group.ads.map((a) => a.adText)).toEqual([
      "Light up your nights",
      "A sky in your room",
      "Light up your nights",
    ]);
    expect(group.ads[0]!.identity).toEqual({ type: "custom", displayName: "Acme" });
  });

  it("needs a default test budget and at least one video; caps ads and clips texts", () => {
    expect(() =>
      buildCampaignSpec({ ...specInput, brand: { ...specInput.brand, defaultTestBudget: null } }),
    ).toThrow(/default test budget/);
    expect(() => buildCampaignSpec({ ...specInput, videos: [] })).toThrow(IntegrationError);
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `v${i}xxxxxxx`,
      tiktokVideoId: `t${i}`,
    }));
    const spec = buildCampaignSpec({ ...specInput, videos: many, adTexts: ["x".repeat(150)] });
    expect(spec.adGroups[0]!.ads).toHaveLength(MAX_ADS);
    expect(spec.adGroups[0]!.ads[0]!.adText.length).toBeLessThanOrEqual(100);
    expect(withBudget(spec, 80).budget).toEqual({ mode: "daily", amount: 80, level: "ad_group" });
  });
});

const candidate = (n: number): VideoCandidate => ({
  tiktokUrl: `https://www.tiktok.com/@a/video/7000000000000000${String(n).padStart(3, "0")}`,
  tiktokVideoId: `7000000000000000${n}`,
  author: { username: "a" },
  caption: "c",
  thumbnailUrl: "https://p.example/t.jpg",
  stats: { views: 1, likes: 1, comments: 0, shares: 0 },
  durationSec: 12,
});

describe("related video candidates", () => {
  it("queries the first keyword, falls back to the name", () => {
    expect(relatedVideoQuery({ keywords: ["  galaxy  lamp "], productName: "X" })).toBe(
      "galaxy lamp",
    );
    expect(relatedVideoQuery({ keywords: [" "], productName: "Lamp" })).toBe("Lamp");
    expect(relatedVideoQuery(null)).toBeNull();
  });

  it("keeps new unique URLs only, in ranking order, bounded", () => {
    const found = [candidate(1), candidate(2), candidate(1), candidate(3), candidate(4)];
    const out = newCandidates(found, new Set([candidate(2).tiktokUrl]), 2);
    expect(out.map((c) => c.tiktokVideoId)).toEqual([
      candidate(1).tiktokVideoId,
      candidate(3).tiktokVideoId,
    ]);
  });

  it("checks pending and approved videos without a report for the current claims", () => {
    const claims = complianceClaims(null);
    expect(claims).toEqual([]);
    const version = claimsVersion(["a"]);
    expect(claimsVersion(["a"])).toBe(version);
    expect(claimsVersion(["b"])).not.toBe(version);
    const rows = [
      { id: "1", approval: "pending", compliance: null, metadata: {} },
      {
        id: "2",
        approval: "pending",
        compliance: { overall: "pass" },
        metadata: { claimsVersion: version },
      },
      {
        id: "3",
        approval: "pending",
        compliance: { overall: "pass" },
        metadata: { claimsVersion: "old" },
      },
      { id: "4", approval: "approved", compliance: null, metadata: {} },
      {
        id: "5",
        approval: "pending",
        compliance: null,
        metadata: { claimsVersion: version, checkError: "gone" },
      },
    ] as unknown as Parameters<typeof videosToCheck>[0];
    // "4": approved without a report for these claims, re-checked (report only, N13).
    expect(videosToCheck(rows, version).map((r) => r.id)).toEqual(["1", "3", "4"]);
  });

  it("re-runs an incomplete AI review once per claims version, never a rejected video", () => {
    const version = claimsVersion(["a"]);
    const incomplete = {
      overall: "fail",
      rules: [{ ruleId: "policy.ai_review", kind: "policy", verdict: "fail", reason: "x" }],
    };
    const rows = [
      {
        id: "1",
        approval: "pending",
        compliance: incomplete,
        metadata: { claimsVersion: version },
      },
      {
        id: "2",
        approval: "pending",
        compliance: incomplete,
        metadata: { claimsVersion: version, aiReviewRetried: version },
      },
      {
        id: "3",
        approval: "rejected",
        compliance: incomplete,
        metadata: { claimsVersion: "old" },
      },
      {
        id: "4",
        approval: "approved",
        compliance: { overall: "pass", rules: [] },
        metadata: { claimsVersion: "old" },
      },
    ] as unknown as Parameters<typeof videosToCheck>[0];
    expect(hasIncompleteAiReview(rows[0]!.compliance)).toBe(true);
    expect(hasIncompleteAiReview(rows[3]!.compliance)).toBe(false);
    expect(videosToCheck(rows, version).map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("flags a report made against other ad texts as outdated", () => {
    const copy = { adTexts: ["Light up"], highlights: ["Warm"] } as unknown as PageCopy;
    const current = claimsVersion(complianceClaims(copy));
    expect(isComplianceOutdated({ overall: "pass" }, { claimsVersion: current }, copy)).toBe(false);
    expect(isComplianceOutdated({ overall: "pass" }, { claimsVersion: "old" }, copy)).toBe(true);
    expect(isComplianceOutdated(null, { claimsVersion: "old" }, copy)).toBe(false);
    expect(isComplianceOutdated({ overall: "pass" }, {}, null)).toBe(false);
  });
});

describe("campaign budget cap, conversion and ad account currency (N9, B1)", () => {
  it("caps a daily budget at 10x the brand default (converted), else the current amount", () => {
    expect(maxDailyBudget(30, 30)).toBe(300);
    expect(maxDailyBudget(30, 33, 1.1)).toBe(330);
    expect(maxDailyBudget(null, 25)).toBe(250);
    expect(maxDailyBudget(500_000, 30)).toBe(MAX_DAILY_BUDGET);
  });

  it("converts the brand default test budget with the GATE 3 rate, 2 decimals", () => {
    expect(advertiserBudget(30)).toBe(30);
    expect(advertiserBudget(30, 1.0837)).toBe(32.51);
    const spec = buildCampaignSpec({ ...specInput, fxRate: 160.25 });
    expect(spec.budget).toEqual({ mode: "daily", amount: 4006.25, level: "ad_group" });
  });

  it("knows TikTok's daily minimum where verified", () => {
    expect(dailyBudgetMinimum("ad_group", "USD")).toBe(20);
    expect(dailyBudgetMinimum("campaign", "USD")).toBe(50);
  });

  it("refuses an inactive ad account or one of unknown currency; another currency is usable", () => {
    expect(adAccountUnusableReason({ status: "active", currency: "EUR" })).toBeNull();
    expect(adAccountUnusableReason({ status: "expiring", currency: "USD" })).toBeNull();
    expect(adAccountUnusableReason({ status: "needs_reauth", currency: "EUR" })).toMatch(
      /reconnected/,
    );
    expect(adAccountUnusableReason({ status: "active", currency: null })).toMatch(/Reconnect/);
  });
});

describe("video lifecycle helpers", () => {
  it("uploads to TikTok Ads once per advertiser, from the Shopify URL", async () => {
    const calls: unknown[] = [];
    const integrations = {
      tiktokAds: {
        uploadVideoByUrl: async (_c: unknown, input: unknown) => {
          calls.push(input);
          return { videoId: "ttv" };
        },
      },
    } as never;
    const creds = { advertiserId: "adv1", accessToken: "t" };
    const first = await ensureTikTokAdsVideo({
      integrations,
      creds,
      video: { id: "vid", shopifyFileUrl: "https://cdn.shopify.com/v.mp4", tiktokVideoIds: {} },
    });
    expect(first).toEqual({ videoId: "ttv", tiktokVideoIds: { adv1: "ttv" }, uploaded: true });
    expect(calls).toEqual([
      { videoUrl: "https://cdn.shopify.com/v.mp4", fileName: tiktokAdsFileName("vid") },
    ]);
    const again = await ensureTikTokAdsVideo({
      integrations,
      creds,
      video: {
        id: "vid",
        shopifyFileUrl: "https://cdn.shopify.com/v.mp4",
        tiktokVideoIds: { adv1: "ttv" },
      },
    });
    expect(again.uploaded).toBe(false);
    expect(calls).toHaveLength(1);
    await expect(
      ensureTikTokAdsVideo({
        integrations,
        creds,
        video: { id: "v", shopifyFileUrl: null, tiktokVideoIds: {} },
      }),
    ).rejects.toBeInstanceOf(IntegrationError);
    expect(shopifyVideoAlt(null)).toBe("Product video");
  });
});

describe("state machine: GATE 3 parts, GATE 4 and launch failure", () => {
  const evidence = (gate: "content_approval" | "launch", parts?: ("page" | "videos")[]) => ({
    id: "a1",
    productId: "p1",
    gate,
    decision: "approved" as const,
    userId: "u1",
    ...(parts ? { parts } : {}),
  });

  it("moves to preparing_campaign only with both GATE 3 parts", () => {
    expect(() =>
      transition("awaiting_content_approval", {
        type: "gate_approved",
        productId: "p1",
        approval: evidence("content_approval", ["videos"]),
      }),
    ).toThrow(/page/);
    expect(
      transition("awaiting_content_approval", {
        type: "gate_approved",
        productId: "p1",
        approval: evidence("content_approval", ["page", "videos"]),
      }),
    ).toBe("preparing_campaign");
  });

  it("prepare → GATE 4 → launched; a failed launch retries to ready_to_launch", () => {
    expect(
      transition("preparing_campaign", { type: "step_succeeded", step: "prepare_campaign" }),
    ).toBe("ready_to_launch");
    expect(
      transition("ready_to_launch", {
        type: "gate_approved",
        productId: "p1",
        approval: evidence("launch"),
      }),
    ).toBe("launched");
    expect(transition("ready_to_launch", { type: "step_failed", step: "launch", error: "x" })).toBe(
      "failed",
    );
    expect(transition("failed", { type: "retry", step: "launch" })).toBe("ready_to_launch");
    expect(() =>
      transition("ready_to_launch", { type: "step_succeeded", step: "launch" }),
    ).toThrow();
  });
});
