import { describe, expect, it } from "vitest";

import {
  BUILT_IN_SETTINGS,
  campaignPresetSettingsSchema,
  daypartingString,
} from "@/lib/domain/campaign-presets";
import {
  adGroupCreateBody,
  assertCreatesDisabled,
  validateSpecForTikTok,
} from "@/lib/integrations/tiktok-ads/spec";

import { buildCampaignSpec, buildDuplicateSpec, duplicateName } from "./campaign-spec";

const base = {
  productId: "prod_12345678",
  productName: "LED lamp",
  brand: { name: "Demo", country: "US", defaultTestBudget: 30 },
  landingPageUrl: "https://shop.example/products/led",
  adTexts: ["Light up your room"],
  videos: [
    { id: "vid_aaaaaaaa", tiktokVideoId: "v1" },
    { id: "vid_bbbbbbbb", tiktokVideoId: "v2" },
    { id: "vid_cccccccc", tiktokVideoId: "v3" },
  ],
};

describe("campaign preset settings", () => {
  it("defaults to the spend-safe values", () => {
    expect(BUILT_IN_SETTINGS.objective).toBe("TRAFFIC");
    expect(BUILT_IN_SETTINGS.bidding).toMatchObject({ strategy: "lowest_cost", pacing: "smooth" });
    expect(BUILT_IN_SETTINGS.placements.searchResults).toBe(false);
    expect(BUILT_IN_SETTINGS.budget).toMatchObject({ amount: null, mode: "daily" });
  });

  it("requires a pixel and an event for website conversions, a bid for cost cap", () => {
    const r = campaignPresetSettingsSchema.safeParse({
      objective: "WEB_CONVERSIONS",
      bidding: { strategy: "cost_cap" },
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["pixelId", "optimizationEvent", "bidding.bidAmount"]),
    );
  });

  it("encodes dayparting as 336 half-hour slots from Monday", () => {
    const s = daypartingString({ days: [0], startHour: 9, endHour: 17 })!;
    expect(s).toHaveLength(336);
    expect(s.slice(0, 18)).toBe("0".repeat(18));
    expect(s.slice(18, 34)).toBe("1".repeat(16));
    expect(s.slice(34)).toBe("0".repeat(302));
    expect(daypartingString({ days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 })).toBeNull();
    expect(daypartingString(null)).toBeNull();
  });
});

describe("buildCampaignSpec with a preset", () => {
  it("keeps the built-in spec when no preset is given", () => {
    const spec = buildCampaignSpec(base);
    expect(spec.adGroups).toHaveLength(1);
    expect(spec.adGroups[0]!.searchResults).toBeUndefined();
    expect(spec.presetId).toBeUndefined();
  });

  it("lays out one ad group per video with the preset targeting and budget", () => {
    const settings = campaignPresetSettingsSchema.parse({
      budget: { amount: 20, level: "ad_group" },
      structure: { adGroups: "per_video" },
      targeting: { countries: ["US", "CA"], ageGroups: ["AGE_25_34"], operatingSystems: ["IOS"] },
      dayparting: { days: [5, 6], startHour: 18, endHour: 23 },
    });
    const spec = buildCampaignSpec({ ...base, fxRate: 2, preset: { id: "p1", settings } });
    expect(spec.presetId).toBe("p1");
    expect(spec.budget).toEqual({ mode: "daily", amount: 40, level: "ad_group" });
    expect(spec.adGroups).toHaveLength(3);
    for (const g of spec.adGroups) {
      expect(g.ads).toHaveLength(1);
      expect(g.countries).toEqual(["US", "CA"]);
      expect(g.operatingSystems).toEqual(["IOS"]);
      expect(g.dayparting).toHaveLength(336);
    }
    expect(new Set(spec.adGroups.map((g) => g.name)).size).toBe(3);
    expect(() => validateSpecForTikTok(spec)).not.toThrow();
  });

  it("falls back to the brand default budget when the preset has none", () => {
    const spec = buildCampaignSpec({ ...base, preset: { id: "p", settings: BUILT_IN_SETTINGS } });
    expect(spec.budget.amount).toBe(30);
  });
});

describe("buildDuplicateSpec", () => {
  const source = buildCampaignSpec(base);

  it("copies the ads, keeps the source budget without a preset amount, numbers the copy", () => {
    const spec = buildDuplicateSpec({
      source,
      copy: 2,
      brandCountry: "US",
      preset: { id: null, settings: BUILT_IN_SETTINGS },
    });
    expect(spec.name).toBe(`${source.name} · copy 2`);
    expect(spec.budget.amount).toBe(source.budget.amount);
    expect(spec.adGroups.flatMap((g) => g.ads.map((a) => a.videoId))).toEqual(["v1", "v2", "v3"]);
    expect(spec.landingPageUrl).toBe(source.landingPageUrl);
    expect(spec.presetId).toBeUndefined();
  });

  it("uses the preset budget converted to the advertiser currency and CBO", () => {
    const settings = campaignPresetSettingsSchema.parse({
      budget: { amount: 100, level: "campaign" },
    });
    const spec = buildDuplicateSpec({
      source,
      copy: 1,
      brandCountry: "US",
      preset: { id: "dup1", settings },
      fxRate: 1.5,
    });
    expect(spec.budget).toEqual({ mode: "daily", amount: 150, level: "campaign" });
    expect(spec.presetId).toBe("dup1");
  });

  it("does not stack copy suffixes", () => {
    expect(duplicateName("Lamp · TC-1 · copy 1", 3)).toBe("Lamp · TC-1 · copy 3");
  });
});

describe("adGroupCreateBody with preset options", () => {
  it("sends the spend-limiting options explicitly and stays DISABLE", () => {
    const settings = campaignPresetSettingsSchema.parse({
      bidding: { pacing: "fast" },
      targeting: { languages: ["en"] },
      placements: { commentsDisabled: true },
    });
    const spec = validateSpecForTikTok(
      buildCampaignSpec({ ...base, preset: { id: "p", settings } }),
    );
    const body = adGroupCreateBody("adv", "camp", spec, spec.adGroups[0]!, new Date(0));
    expect(body).toMatchObject({
      placements: ["PLACEMENT_TIKTOK"],
      search_result_enabled: false,
      comment_disabled: true,
      video_download_disabled: true,
      share_disabled: false,
      pacing: "PACING_MODE_FAST",
      languages: ["en"],
      operation_status: "DISABLE",
    });
    expect(() => assertCreatesDisabled("adgroup", body)).not.toThrow();
  });

  it("runs a total budget for the preset's number of days", () => {
    const settings = campaignPresetSettingsSchema.parse({
      budget: { mode: "total", amount: 140, totalDays: 14 },
    });
    const spec = validateSpecForTikTok(
      buildCampaignSpec({ ...base, preset: { id: "p", settings } }),
    );
    const body = adGroupCreateBody("adv", "camp", spec, spec.adGroups[0]!, new Date(0));
    expect(body.schedule_end_time).toBe("1970-01-15 00:00:00");
  });
});
