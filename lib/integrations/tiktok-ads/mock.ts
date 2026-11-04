import { createHash } from "node:crypto";

import { z } from "zod";

import {
  campaignIdsSchema,
  IntegrationError,
  oauthStartSchema,
  tiktokAdsCredentialsSchema,
  type CampaignIds,
  type HourlyStat,
  type TikTokAdsClient,
  type TikTokAdvertiser,
} from "@/lib/domain/contracts";

import { validateBudgetUpdate } from "./budget";
import { TIKTOK_ADS_PROVIDER } from "./config";
import { STATS_MAX_WINDOW_HOURS } from "./limits";
import { statsWindow } from "./report";
import { TOTAL_BUDGET_DAYS, validateSpecForTikTok } from "./spec";

/*
 * Deterministic in-memory TikTok Ads. Never touches the network.
 *
 * buildAuthUrl points straight back at our own callback with a fake code,
 * so the connect flow completes locally in mock mode. Same inputs always
 * give the same ids and stats.
 *
 * Mirrors live: specs go through the same validateSpecForTikTok (so a spec
 * the live API would reject fails here too), re-creating the same spec
 * returns the same ids without touching their status (live reuses by name)
 * but refuses a same-name campaign that is enabled (like live), launch needs
 * ids created here first, budget updates follow the same minimums and
 * mode/level rules as live and never touch a status, and stats are one row
 * per UTC hour (window capped like live).
 *
 * Advertisers: one EUR and one USD account, so the brand-currency match and
 * mismatch paths (B1) are both testable. Floors apply to USD only (budget.ts).
 */

export const MOCK_ADS_AUTH_CODE = "mock-ads-auth-code";
export const MOCK_ADVERTISERS: TikTokAdvertiser[] = [
  {
    advertiserId: "7000000000000000001",
    name: "Mock Ads Account EU",
    currency: "EUR",
    timezone: "Europe/Paris",
  },
  {
    advertiserId: "7000000000000000002",
    name: "Mock Ads Account US",
    currency: "USD",
    timezone: "America/New_York",
  },
];
/** Codes starting with this fail like an expired/used auth code would. */
export const MOCK_BAD_CODE_PREFIX = "bad-";

function digest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/** Numeric id of `len` digits derived from the inputs (TikTok ids are numeric strings). */
function numericId(prefix: string, len: number, ...parts: string[]): string {
  const hex = digest(...parts);
  let digits = "";
  for (let i = 0; digits.length < len - prefix.length; i += 2) {
    digits += (parseInt(hex.slice(i % 64, (i % 64) + 2), 16) % 10).toString();
  }
  return prefix + digits;
}

const HOUR_MS = 3_600_000;

export type MockEntityStatus = "DISABLE" | "ENABLE";

export interface MockTikTokAdsClient extends TikTokAdsClient {
  updateBudget: NonNullable<TikTokAdsClient["updateBudget"]>;
  /** Test/demo helper: operation status of a campaign, ad group or ad id. */
  statusOf(id: string): MockEntityStatus | undefined;
  /** Test/demo helper: budget amount carried by a campaign or ad group id. */
  budgetOf(id: string): number | undefined;
}

type MockBudget = {
  mode: "daily" | "total";
  level: "campaign" | "ad_group";
  /** Amount per entity that carries it (the campaign, or each ad group). */
  amounts: Map<string, number>;
};

export function createMockTikTokAdsClient(): MockTikTokAdsClient {
  const statuses = new Map<string, MockEntityStatus>();
  /** Budget per campaign id. */
  const budgets = new Map<string, MockBudget>();

  const tokenFor = (code: string) => `mock-ads-token-${digest("ads", code).slice(0, 24)}`;

  function assertKnown(ids: CampaignIds) {
    const all = [ids.campaignId, ...ids.adGroups.flatMap((g) => [g.adGroupId, ...g.adIds])];
    const missing = all.find((id) => !statuses.has(id));
    if (missing) {
      throw new IntegrationError(
        TIKTOK_ADS_PROVIDER,
        "not_found",
        `Unknown mock entity ${missing}.`,
      );
    }
    return all;
  }

  return {
    buildAuthUrl(oauth) {
      const { state, redirectUri } = oauthStartSchema.parse(oauth);
      const url = new URL(redirectUri);
      url.searchParams.set("auth_code", MOCK_ADS_AUTH_CODE);
      url.searchParams.set("code", MOCK_ADS_AUTH_CODE);
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeAuthCode({ code }) {
      if (!code || code.startsWith(MOCK_BAD_CODE_PREFIX)) {
        throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", "Invalid auth_code.");
      }
      return {
        accessToken: tokenFor(code),
        advertiserIds: MOCK_ADVERTISERS.map((a) => a.advertiserId),
        scopes: ["1", "2", "3", "4"],
      };
    },

    async listAdvertisers({ accessToken }) {
      if (!accessToken.startsWith("mock-ads-token-")) {
        throw new IntegrationError(TIKTOK_ADS_PROVIDER, "auth_expired", "Invalid access token.");
      }
      return MOCK_ADVERTISERS.map((a) => ({ ...a }));
    },

    async uploadVideoByUrl(creds, input) {
      const c = tiktokAdsCredentialsSchema.parse(creds);
      const { videoUrl, fileName } = z
        .object({ videoUrl: z.url(), fileName: z.string().min(1) })
        .parse(input);
      return { videoId: `v10033g50000${digest(c.advertiserId, videoUrl, fileName).slice(0, 20)}` };
    },

    async createPausedCampaign(creds, rawSpec) {
      const c = tiktokAdsCredentialsSchema.parse(creds);
      const spec = validateSpecForTikTok(rawSpec);
      const campaignId = numericId("17", 19, c.advertiserId, spec.name);
      // Like live: an enabled campaign of the same name is never reused.
      if (statuses.get(campaignId) === "ENABLE") {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          `Campaign "${spec.name}" already exists and is enabled; it will not be reused as a paused campaign.`,
          { retryable: false },
        );
      }
      const ids = campaignIdsSchema.parse({
        campaignId,
        adGroups: spec.adGroups.map((g, gi) => {
          const adGroupId = numericId("18", 19, campaignId, String(gi), g.name);
          return {
            adGroupId,
            adIds: g.ads.map((ad, ai) =>
              numericId("19", 19, adGroupId, String(ai), ad.name, ad.videoId),
            ),
          };
        }),
      });
      for (const id of [
        ids.campaignId,
        ...ids.adGroups.flatMap((g) => [g.adGroupId, ...g.adIds]),
      ]) {
        // Like live's name lookup: an existing entity keeps its status.
        if (!statuses.has(id)) statuses.set(id, "DISABLE");
      }
      if (!budgets.has(campaignId)) {
        const carriers =
          spec.budget.level === "campaign" ? [campaignId] : ids.adGroups.map((g) => g.adGroupId);
        budgets.set(campaignId, {
          mode: spec.budget.mode,
          level: spec.budget.level,
          amounts: new Map(carriers.map((x) => [x, spec.budget.amount])),
        });
      }
      return ids;
    },

    async launchCampaign(creds, rawIds) {
      tiktokAdsCredentialsSchema.parse(creds);
      const ids = campaignIdsSchema.parse(rawIds);
      if (ids.adGroups.length === 0 || ids.adGroups.some((g) => g.adIds.length === 0)) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          "A campaign needs at least one ad group with ads to launch.",
          { retryable: false },
        );
      }
      for (const id of assertKnown(ids)) statuses.set(id, "ENABLE");
    },

    async pauseCampaign(creds, rawIds) {
      tiktokAdsCredentialsSchema.parse(creds);
      for (const id of assertKnown(campaignIdsSchema.parse(rawIds))) statuses.set(id, "DISABLE");
    },

    async updateBudget(creds, input) {
      const c = tiktokAdsCredentialsSchema.parse(creds);
      const ids = campaignIdsSchema.parse(input.ids);
      const currency = MOCK_ADVERTISERS.find((a) => a.advertiserId === c.advertiserId)?.currency;
      const budget = validateBudgetUpdate(input.budget, currency, TOTAL_BUDGET_DAYS);
      assertKnown(ids);
      const current = budgets.get(ids.campaignId);
      if (!current) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "not_found",
          `Unknown mock campaign ${ids.campaignId}.`,
        );
      }
      if (current.level !== budget.level) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          budget.level === "campaign"
            ? "This campaign's budget is set on its ad groups, not on the campaign."
            : "This campaign's budget is set on the campaign, not on its ad groups.",
          { retryable: false },
        );
      }
      if (current.mode !== budget.mode) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          `The budget mode cannot change after creation (requested ${budget.mode}).`,
          { retryable: false },
        );
      }
      const targets =
        budget.level === "campaign" ? [ids.campaignId] : ids.adGroups.map((g) => g.adGroupId);
      if (targets.length === 0) {
        throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", "No ad group to update.", {
          retryable: false,
        });
      }
      // Amounts only: statuses are never touched.
      for (const t of targets) current.amounts.set(t, budget.amount);
    },

    async getHourlyStats(creds, input) {
      tiktokAdsCredentialsSchema.parse(creds);
      const { campaignId, from, to } = z
        .object({ campaignId: z.string().min(1), from: z.iso.datetime(), to: z.iso.datetime() })
        .parse(input);
      const { start, end } = statsWindow(from, to);
      if (end - start > STATS_MAX_WINDOW_HOURS * HOUR_MS) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          `A stats window is at most ${STATS_MAX_WINDOW_HOURS} hours.`,
          { retryable: false },
        );
      }
      // A campaign never launched in this mock spends nothing.
      const neverLaunched = statuses.get(campaignId) === "DISABLE";
      const stats: HourlyStat[] = [];
      for (let t = start; t < end; t += HOUR_MS) {
        const hour = new Date(t).toISOString();
        if (neverLaunched) {
          stats.push({ hour, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
          continue;
        }
        const h = digest(campaignId, hour);
        const impressions = 500 + (parseInt(h.slice(0, 4), 16) % 4500);
        const clicks = Math.floor(
          impressions * (0.005 + (parseInt(h.slice(4, 6), 16) % 20) / 1000),
        );
        const conversions = Math.floor(clicks * ((parseInt(h.slice(6, 8), 16) % 8) / 100));
        const spend = Math.round(impressions * 0.008 * 100) / 100;
        const revenue = Math.round(conversions * 29.9 * 100) / 100;
        stats.push({ hour, spend, impressions, clicks, conversions, revenue });
      }
      return stats;
    },

    statusOf(id) {
      return statuses.get(id);
    },

    budgetOf(id) {
      for (const b of budgets.values()) {
        const amount = b.amounts.get(id);
        if (amount !== undefined) return amount;
      }
      return undefined;
    },
  };
}
