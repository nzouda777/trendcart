import { z } from "zod";

/*
 * Saved campaign settings ("presets"), per brand, in two kinds:
 *
 * - new_test:  how Trendcart builds the paused test campaign after GATE 3
 *              ("Brand new campaign setup 1", "…setup 2").
 * - duplicate: how a launched campaign is copied into a new paused campaign
 *              ("Campaign duplicate settings 1", …).
 *
 * Every TikTok option that makes an ad group spend more than asked is
 * explicit here, with the spend-safe value as the default: TikTok-only
 * placement (never Pangle / Global App Bundle), search placement off,
 * smooth pacing, lowest-cost bidding. Budgets are in the BRAND currency and
 * converted to the ad account currency with the rate recorded at GATE 3.
 */

export const CAMPAIGN_PRESET_KINDS = ["new_test", "duplicate"] as const;
export const campaignPresetKindSchema = z.enum(CAMPAIGN_PRESET_KINDS);
export type CampaignPresetKind = z.infer<typeof campaignPresetKindSchema>;

export const PRESET_KIND_LABELS: Record<CampaignPresetKind, string> = {
  new_test: "Brand new campaign setups",
  duplicate: "Campaign duplicate settings",
};

/** TikTok Marketing API v1.3 age_groups values. */
export const AGE_GROUPS = [
  "AGE_13_17",
  "AGE_18_24",
  "AGE_25_34",
  "AGE_35_44",
  "AGE_45_54",
  "AGE_55_100",
] as const;
export const AGE_GROUP_LABELS: Record<(typeof AGE_GROUPS)[number], string> = {
  AGE_13_17: "13-17",
  AGE_18_24: "18-24",
  AGE_25_34: "25-34",
  AGE_35_44: "35-44",
  AGE_45_54: "45-54",
  AGE_55_100: "55+",
};

export const OPERATING_SYSTEMS = ["ANDROID", "IOS"] as const;

/** Total-budget campaigns run this many days unless the preset says otherwise. */
export const DEFAULT_TOTAL_DAYS = 7;
export const MAX_TOTAL_DAYS = 90;
/** "One ad group per video" creates at most this many ad groups. */
export const MAX_AD_GROUPS = 10;

const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use 2-letter country codes (e.g. US, FR).");
const language = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, "Use 2-letter language codes (e.g. en, fr).");

export const daypartingSchema = z
  .object({
    /** 0 = Monday … 6 = Sunday. */
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** Start hour included, end hour excluded, 0..24, in the ad account time zone. */
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .refine((d) => d.endHour > d.startHour, {
    message: "The end hour must be after the start hour.",
    path: ["endHour"],
  });
export type Dayparting = z.infer<typeof daypartingSchema>;

export const campaignPresetSettingsSchema = z
  .object({
    objective: z.enum(["TRAFFIC", "WEB_CONVERSIONS"]).default("TRAFFIC"),
    /** Required for WEB_CONVERSIONS. */
    pixelId: z.string().trim().max(64).optional(),
    /** TikTok optimization event code, required for WEB_CONVERSIONS. */
    optimizationEvent: z.string().trim().max(64).optional(),

    budget: z
      .object({
        mode: z.enum(["daily", "total"]).default("daily"),
        /**
         * Brand currency. Null: the brand default test budget (new_test), or
         * the source campaign's budget (duplicate).
         */
        amount: z.number().positive().finite().max(1_000_000).nullable().default(null),
        /** "campaign" = TikTok CBO; "ad_group" = each ad group has the amount. */
        level: z.enum(["campaign", "ad_group"]).default("ad_group"),
        /** Run length of a total budget. */
        totalDays: z.number().int().min(1).max(MAX_TOTAL_DAYS).default(DEFAULT_TOTAL_DAYS),
      })
      .prefault({}),

    bidding: z
      .object({
        strategy: z.enum(["lowest_cost", "cost_cap"]).default("lowest_cost"),
        /** Required for cost_cap, in the ad account currency. */
        bidAmount: z.number().positive().finite().max(100_000).optional(),
        pacing: z.enum(["smooth", "fast"]).default("smooth"),
      })
      .prefault({}),

    /** Null: all day, every day. */
    dayparting: daypartingSchema.nullable().default(null),

    targeting: z
      .object({
        /** Empty: the brand's main country. */
        countries: z.array(country).max(30).default([]),
        /** Empty: all ages TikTok allows. */
        ageGroups: z.array(z.enum(AGE_GROUPS)).default([]),
        gender: z.enum(["all", "male", "female"]).default("all"),
        /** Empty: all languages. */
        languages: z.array(language).max(20).default([]),
        /** Empty: all devices. */
        operatingSystems: z.array(z.enum(OPERATING_SYSTEMS)).default([]),
      })
      .prefault({}),

    placements: z
      .object({
        /** Also show the ads in TikTok search results. */
        searchResults: z.boolean().default(false),
        commentsDisabled: z.boolean().default(false),
        videoDownloadDisabled: z.boolean().default(true),
        shareDisabled: z.boolean().default(false),
      })
      .prefault({}),

    structure: z
      .object({
        /** single: one ad group with every video; per_video: one ad group per video. */
        adGroups: z.enum(["single", "per_video"]).default("single"),
      })
      .prefault({}),
  })
  .superRefine((s, ctx) => {
    if (s.objective === "WEB_CONVERSIONS") {
      if (!s.pixelId) {
        ctx.addIssue({
          code: "custom",
          path: ["pixelId"],
          message: "Website conversions need a TikTok pixel ID.",
        });
      }
      if (!s.optimizationEvent) {
        ctx.addIssue({
          code: "custom",
          path: ["optimizationEvent"],
          message: "Website conversions need an optimization event.",
        });
      }
    }
    if (s.bidding.strategy === "cost_cap" && !s.bidding.bidAmount) {
      ctx.addIssue({
        code: "custom",
        path: ["bidding", "bidAmount"],
        message: "Cost cap needs a bid amount.",
      });
    }
  });

export type CampaignPresetSettings = z.output<typeof campaignPresetSettingsSchema>;
export type CampaignPresetSettingsInput = z.input<typeof campaignPresetSettingsSchema>;

/** The settings Trendcart used before presets existed: the fallback when a brand has none. */
export const BUILT_IN_SETTINGS: CampaignPresetSettings = campaignPresetSettingsSchema.parse({});

/**
 * TikTok `dayparting`: 336 characters, one per half hour, Monday 00:00
 * first, "1" = delivering. Null when every slot is on (no restriction).
 */
export function daypartingString(d: Dayparting | null): string | null {
  if (!d) return null;
  const days = new Set(d.days);
  let out = "";
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < 48; slot++) {
      const hour = slot / 2;
      out += days.has(day) && hour >= d.startHour && hour < d.endHour ? "1" : "0";
    }
  }
  return out.includes("0") ? out : null;
}
