/**
 * The paused TikTok campaign Trendcart prepares after GATE 3 (pure, tested):
 * one campaign, one ad group in the brand country, one ad per approved video,
 * the brand's default test budget per day on the ad group (converted to the
 * advertiser currency with the rate recorded at GATE 3), lowest-cost
 * bidding, traffic to the published Shopify page, the page copy ad texts in
 * rotation, and a custom identity with the brand name. Spark Ads (creator
 * authorization codes) come later.
 */
import {
  daypartingString,
  MAX_AD_GROUPS,
  type CampaignPresetSettings,
} from "@/lib/domain/campaign-presets";
import { campaignSpecSchema, IntegrationError, type CampaignSpec } from "@/lib/domain/contracts";

export const CALL_TO_ACTION = "SHOP_NOW";
const MAX_AD_TEXT = 100;
const MAX_NAME = 120;
/** TikTok allows up to 20 ads per ad group. */
export const MAX_ADS = 20;

export type CampaignSpecInput = {
  productId: string;
  productName: string | null;
  brand: { name: string; country: string; defaultTestBudget: number | null };
  /**
   * 1 brand unit = fxRate advertiser units (human-supplied at GATE 3 when the
   * ad account bills in another currency). Default 1.
   */
  fxRate?: number;
  /** Decimal places of the advertiser currency (default 2). */
  budgetDecimals?: number;
  /** Published Shopify product URL. */
  landingPageUrl: string;
  /** Page copy ad texts (≤ 100 chars each), used in rotation. */
  adTexts: readonly string[];
  /** Approved videos in order, with their TikTok Ads video id for this advertiser. */
  videos: readonly { id: string; tiktokVideoId: string }[];
  /**
   * Saved "brand new campaign" preset. Absent: the built-in settings (one ad
   * group in the brand country, daily brand default, lowest cost, traffic).
   */
  preset?: { id: string; settings: CampaignPresetSettings };
};

function fatal(message: string): never {
  throw new IntegrationError("workflow", "invalid_input", message, { retryable: false });
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

/** Stable, readable campaign name (same product → same name, so re-runs can be matched). */
export function campaignName(productId: string, productName: string | null): string {
  const label = clip(productName ?? "Product", MAX_NAME - 20);
  return `${label} · TC-${productId.slice(0, 8)}`;
}

/** Money rounded to 2 decimals (TikTok budgets have at most two). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The brand default test budget in the advertiser currency (brand amount x
 * fxRate), rounded to `decimals` (2 for most currencies; pass
 * currencyDecimals(advertiser currency) so JPY-like currencies get 0).
 */
export function advertiserBudget(brandAmount: number, fxRate = 1, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(brandAmount * fxRate * f) / f;
}

export function buildCampaignSpec(input: CampaignSpecInput): CampaignSpec {
  const settings = input.preset?.settings;
  const brandBudget = settings?.budget.amount ?? input.brand.defaultTestBudget;
  if (brandBudget === null || !(brandBudget > 0)) {
    fatal("Set a default test budget on the brand (or a budget in the preset), then retry.");
  }
  const budget = advertiserBudget(brandBudget, input.fxRate, input.budgetDecimals);

  if (!(budget > 0)) fatal("The converted test budget is zero. Check the exchange rate.");

  if (input.videos.length === 0) fatal("No approved video to advertise.");
  const texts = input.adTexts.map((t) => clip(t, MAX_AD_TEXT)).filter(Boolean);
  if (texts.length === 0) texts.push(clip(input.productName ?? input.brand.name, MAX_AD_TEXT));

  const ads = input.videos.slice(0, MAX_ADS).map((v, i) => ({
    name: `Video ${i + 1} · ${v.id.slice(0, 8)}`,
    videoId: v.tiktokVideoId,
    adText: texts[i % texts.length]!,
    callToAction: CALL_TO_ACTION,
    identity: { type: "custom" as const, displayName: clip(input.brand.name, 40) },
  }));

  const spec: CampaignSpec = settings
    ? specFromSettings({
        name: campaignName(input.productId, input.productName),
        landingPageUrl: input.landingPageUrl,
        brandCountry: input.brand.country,
        budget,
        settings,
        presetId: input.preset!.id,
        ads,
        label: "test",
      })
    : {
        name: campaignName(input.productId, input.productName),
        objective: "TRAFFIC",
        budget: { mode: "daily", amount: budget, level: "ad_group" },
        landingPageUrl: input.landingPageUrl,
        adGroups: [
          {
            name: `${input.brand.country} · test`,
            countries: [input.brand.country],
            gender: "all",
            bidStrategy: "lowest_cost",
            ads,
          },
        ],
      };
  const parsed = campaignSpecSchema.safeParse(spec);
  if (!parsed.success)
    fatal(`The campaign could not be prepared: ${parsed.error.issues[0]?.message}`);
  return spec;
}

type SpecAd = CampaignSpec["adGroups"][number]["ads"][number];

/** A spec laid out from preset settings (budget already in the advertiser currency). */
function specFromSettings(input: {
  name: string;
  landingPageUrl: string;
  brandCountry: string;
  budget: number;
  settings: CampaignPresetSettings;
  presetId: string | null;
  ads: readonly SpecAd[];
  label: string;
}): CampaignSpec {
  const { settings: s } = input;
  const countries = s.targeting.countries.length ? s.targeting.countries : [input.brandCountry];
  const where = countries.length > 3 ? `${countries.length} countries` : countries.join("+");
  const group = (name: string, ads: SpecAd[]) => ({
    name,
    countries,
    gender: s.targeting.gender,
    ...(s.targeting.ageGroups.length ? { ageGroups: [...s.targeting.ageGroups] } : {}),
    bidStrategy: s.bidding.strategy,
    ...(s.bidding.strategy === "cost_cap" ? { bidAmount: s.bidding.bidAmount } : {}),
    pacing: s.bidding.pacing,
    ...(daypartingString(s.dayparting) ? { dayparting: daypartingString(s.dayparting)! } : {}),
    ...(s.targeting.languages.length ? { languages: [...s.targeting.languages] } : {}),
    ...(s.targeting.operatingSystems.length
      ? { operatingSystems: [...s.targeting.operatingSystems] }
      : {}),
    searchResults: s.placements.searchResults,
    commentsDisabled: s.placements.commentsDisabled,
    videoDownloadDisabled: s.placements.videoDownloadDisabled,
    shareDisabled: s.placements.shareDisabled,
    ads,
  });
  const adGroups =
    s.structure.adGroups === "per_video"
      ? input.ads
          .slice(0, MAX_AD_GROUPS)
          .map((ad, i) => group(`${where} · ${input.label} · ${i + 1}`, [ad]))
      : [group(`${where} · ${input.label}`, [...input.ads])];
  return {
    name: input.name,
    objective: s.objective,
    ...(s.objective === "WEB_CONVERSIONS"
      ? { pixelId: s.pixelId, optimizationEvent: s.optimizationEvent }
      : {}),
    budget: { mode: s.budget.mode, amount: input.budget, level: s.budget.level },
    ...(s.budget.mode === "total" ? { totalDays: s.budget.totalDays } : {}),
    landingPageUrl: input.landingPageUrl,
    ...(input.presetId ? { presetId: input.presetId } : {}),
    adGroups,
  };
}

/** Name of the n-th copy of a campaign (stable, so a retried duplicate is matched). */
export function duplicateName(sourceName: string, copy: number): string {
  const base = sourceName.replace(/ · copy \d+$/, "");
  return `${clip(base, MAX_NAME + 20)} · copy ${copy}`;
}

/**
 * A new paused campaign copied from a launched one: same ads (videos, texts,
 * identity) and landing page, laid out with the "duplicate" preset. The
 * preset budget is in the brand currency (converted with fxRate); without
 * one the source campaign's budget is kept as is.
 */
export function buildDuplicateSpec(input: {
  source: CampaignSpec;
  copy: number;
  brandCountry: string;
  /** id null: the built-in settings (source budget kept). */
  preset: { id: string | null; settings: CampaignPresetSettings };
  fxRate?: number;
  budgetDecimals?: number;
}): CampaignSpec {
  const seen = new Set<string>();
  const ads: SpecAd[] = [];
  for (const g of input.source.adGroups) {
    for (const ad of g.ads) {
      if (seen.has(ad.videoId)) continue;
      seen.add(ad.videoId);
      ads.push(ad);
    }
  }
  if (ads.length === 0) fatal("The source campaign has no ads to copy.");
  const amount = input.preset.settings.budget.amount;
  const budget =
    amount !== null
      ? advertiserBudget(amount, input.fxRate, input.budgetDecimals)
      : input.source.budget.amount;
  if (!(budget > 0)) fatal("The converted budget is zero. Check the exchange rate.");
  const spec = specFromSettings({
    name: duplicateName(input.source.name, input.copy),
    landingPageUrl: input.source.landingPageUrl,
    brandCountry: input.brandCountry,
    budget,
    settings: input.preset.settings,
    presetId: input.preset.id,
    ads: ads.slice(0, MAX_ADS),
    label: `copy ${input.copy}`,
  });
  const parsed = campaignSpecSchema.safeParse(spec);
  if (!parsed.success)
    fatal(`The duplicate could not be prepared: ${parsed.error.issues[0]?.message}`);
  return spec;
}

/** A spec with a new budget amount (same mode and level). */
export function withBudget(spec: CampaignSpec, amount: number): CampaignSpec {
  return { ...spec, budget: { ...spec.budget, amount } };
}
