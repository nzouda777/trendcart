/**
 * The paused TikTok campaign Trendcart prepares after GATE 3 (pure, tested):
 * one campaign, one ad group in the brand country, one ad per approved video,
 * the brand's default test budget per day on the ad group, lowest-cost
 * bidding, traffic to the published Shopify page, the page copy ad texts in
 * rotation, and a custom identity with the brand name. Spark Ads (creator
 * authorization codes) come later.
 */
import {
  campaignSpecSchema,
  IntegrationError,
  type CampaignSpec,
} from "@/lib/domain/contracts";

export const CALL_TO_ACTION = "SHOP_NOW";
const MAX_AD_TEXT = 100;
const MAX_NAME = 120;
/** TikTok allows up to 20 ads per ad group. */
export const MAX_ADS = 20;

export type CampaignSpecInput = {
  productId: string;
  productName: string | null;
  brand: { name: string; country: string; defaultTestBudget: number | null };
  /** Published Shopify product URL. */
  landingPageUrl: string;
  /** Page copy ad texts (≤ 100 chars each), used in rotation. */
  adTexts: readonly string[];
  /** Approved videos in order, with their TikTok Ads video id for this advertiser. */
  videos: readonly { id: string; tiktokVideoId: string }[];
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

export function buildCampaignSpec(input: CampaignSpecInput): CampaignSpec {
  const budget = input.brand.defaultTestBudget;
  if (budget === null || !(budget > 0)) {
    fatal("Set a default test budget on the brand, then retry.");
  }
  if (input.videos.length === 0) fatal("No approved video to advertise.");
  const texts = input.adTexts.map((t) => clip(t, MAX_AD_TEXT)).filter(Boolean);
  if (texts.length === 0) texts.push(clip(input.productName ?? input.brand.name, MAX_AD_TEXT));

  const spec: CampaignSpec = {
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
        ads: input.videos.slice(0, MAX_ADS).map((v, i) => ({
          name: `Video ${i + 1} · ${v.id.slice(0, 8)}`,
          videoId: v.tiktokVideoId,
          adText: texts[i % texts.length]!,
          callToAction: CALL_TO_ACTION,
          identity: { type: "custom" as const, displayName: clip(input.brand.name, 40) },
        })),
      },
    ],
  };
  const parsed = campaignSpecSchema.safeParse(spec);
  if (!parsed.success) fatal(`The campaign could not be prepared: ${parsed.error.issues[0]?.message}`);
  return spec;
}

/** A spec with a new budget amount (same mode and level). */
export function withBudget(spec: CampaignSpec, amount: number): CampaignSpec {
  return { ...spec, budget: { ...spec.budget, amount } };
}
