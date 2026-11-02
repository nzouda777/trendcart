import { createHash } from "node:crypto";

import { z } from "zod";

import {
  campaignIdsSchema,
  campaignSpecSchema,
  IntegrationError,
  oauthStartSchema,
  tiktokAdsCredentialsSchema,
  type CampaignIds,
  type HourlyStat,
  type TikTokAdsClient,
  type TikTokAdvertiser,
} from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";

/*
 * Deterministic in-memory TikTok Ads. Never touches the network.
 *
 * buildAuthUrl points straight back at our own callback with a fake code,
 * so the connect flow completes locally in mock mode. Same inputs always
 * give the same ids and stats.
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
const MAX_HOURS = 24 * 31;

export type MockEntityStatus = "DISABLE" | "ENABLE";

export interface MockTikTokAdsClient extends TikTokAdsClient {
  /** Test/demo helper: operation status of a campaign, ad group or ad id. */
  statusOf(id: string): MockEntityStatus | undefined;
}

export function createMockTikTokAdsClient(): MockTikTokAdsClient {
  const statuses = new Map<string, MockEntityStatus>();

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
      const spec = campaignSpecSchema.parse(rawSpec);
      const campaignId = numericId("17", 19, c.advertiserId, spec.name);
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
        statuses.set(id, "DISABLE");
      }
      return ids;
    },

    async launchCampaign(creds, rawIds) {
      tiktokAdsCredentialsSchema.parse(creds);
      for (const id of assertKnown(campaignIdsSchema.parse(rawIds))) statuses.set(id, "ENABLE");
    },

    async pauseCampaign(creds, rawIds) {
      tiktokAdsCredentialsSchema.parse(creds);
      for (const id of assertKnown(campaignIdsSchema.parse(rawIds))) statuses.set(id, "DISABLE");
    },

    async getHourlyStats(creds, input) {
      tiktokAdsCredentialsSchema.parse(creds);
      const { campaignId, from, to } = z
        .object({ campaignId: z.string().min(1), from: z.iso.datetime(), to: z.iso.datetime() })
        .parse(input);
      const start = Math.floor(Date.parse(from) / HOUR_MS) * HOUR_MS;
      const end = Date.parse(to);
      if (end < start) {
        throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", "`to` is before `from`.");
      }
      // A campaign never launched in this mock spends nothing.
      const neverLaunched = statuses.get(campaignId) === "DISABLE";
      const stats: HourlyStat[] = [];
      for (let t = start; t < end && stats.length < MAX_HOURS; t += HOUR_MS) {
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
  };
}
