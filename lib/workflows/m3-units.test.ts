import { describe, expect, it } from "vitest";

import { IntegrationError, type VideoCandidate } from "@/lib/domain/contracts";
import { transition } from "@/lib/domain/state-machine";
import { newCandidates, relatedVideoQuery } from "@/lib/media/candidates";
import { ensureTikTokAdsVideo, shopifyVideoAlt, tiktokAdsFileName } from "@/lib/media/videos";

import { buildCampaignSpec, campaignName, MAX_ADS, withBudget } from "./campaign-spec";
import { claimsVersion, complianceClaims, videosToCheck } from "./steps/videos";

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

  it("checks pending videos without a report for the current claims", () => {
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
    expect(videosToCheck(rows, version).map((r) => r.id)).toEqual(["1", "3"]);
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
