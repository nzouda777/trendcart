import "server-only";

import { z } from "zod";

import {
  oauthStartSchema,
  tiktokAdvertiserSchema,
  type CampaignIds,
  type HourlyStat,
  type OAuthStart,
  type TikTokAdsClient,
  type TikTokAdvertiser,
} from "@/lib/domain/contracts";

import {
  ADS_AUTH_URL,
  ADS_PROD_BASE,
  readAdsConfig,
  resourceBase,
  TIKTOK_ADS_PROVIDER,
  type TikTokAdsConfig,
} from "./config";
import { adsRequest } from "./http";
import { getRateLimiter, keyForSecret, type RateLimiter } from "./rate-limit";
import { assertNotUnderTest, NotImplementedIntegrationError, type Env } from "./safety";

export type LiveTikTokAdsOptions = {
  fetch?: typeof fetch;
  env?: Env;
  rateLimiter?: RateLimiter;
};

const accessTokenDataSchema = z.object({
  access_token: z.string().min(1),
  advertiser_ids: z.array(z.union([z.string(), z.number()])).default([]),
  /** Permission scope ids granted by the advertiser. */
  scope: z.array(z.union([z.string(), z.number()])).default([]),
});

const advertiserGetDataSchema = z.object({
  list: z
    .array(
      z.object({
        advertiser_id: z.union([z.string(), z.number()]),
        advertiser_name: z.string().default(""),
      }),
    )
    .default([]),
});

const advertiserInfoDataSchema = z.object({
  list: z
    .array(
      z.object({
        advertiser_id: z.union([z.string(), z.number()]),
        name: z.string().optional(),
        currency: z.string().optional(),
        timezone: z.string().optional(),
      }),
    )
    .default([]),
});

export function createLiveTikTokAdsClient(options: LiveTikTokAdsOptions = {}): TikTokAdsClient {
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const limiter = () => options.rateLimiter ?? getRateLimiter(TIKTOK_ADS_PROVIDER);
  const config = (): TikTokAdsConfig => readAdsConfig(env);

  async function advertiserDetails(
    cfg: TikTokAdsConfig,
    accessToken: string,
    ids: string[],
  ): Promise<Map<string, { currency?: string; timezone?: string; name?: string }>> {
    const details = new Map<string, { currency?: string; timezone?: string; name?: string }>();
    // advertiser/info accepts up to 100 ids per call.
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await limiter().take("ads.api", `app:${cfg.appId}`);
      const data = await adsRequest(
        fetchImpl,
        {
          method: "GET",
          url: `${resourceBase(cfg)}/advertiser/info/`,
          accessToken,
          query: {
            advertiser_ids: batch,
            fields: ["advertiser_id", "name", "currency", "timezone"],
          },
        },
        advertiserInfoDataSchema,
      );
      for (const a of data.list) {
        details.set(String(a.advertiser_id), {
          name: a.name,
          currency: a.currency,
          timezone: a.timezone,
        });
      }
    }
    return details;
  }

  return {
    buildAuthUrl(oauth: OAuthStart): string {
      const { state, redirectUri } = oauthStartSchema.parse(oauth);
      const url = new URL(ADS_AUTH_URL);
      url.searchParams.set("app_id", config().appId);
      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", redirectUri);
      return url.toString();
    },

    async exchangeAuthCode({ code }) {
      const cfg = config();
      await limiter().take("ads.oauth", `app:${cfg.appId}`);
      const data = await adsRequest(
        fetchImpl,
        {
          method: "POST",
          url: `${ADS_PROD_BASE}/oauth2/access_token/`,
          body: { app_id: cfg.appId, secret: cfg.appSecret, auth_code: code },
        },
        accessTokenDataSchema,
      );
      return {
        accessToken: data.access_token,
        advertiserIds: data.advertiser_ids.map(String),
        scopes: data.scope.map(String),
      };
    },

    async listAdvertisers({ accessToken }): Promise<TikTokAdvertiser[]> {
      const cfg = config();
      await limiter().take("ads.oauth", `token:${keyForSecret(accessToken)}`);
      const data = await adsRequest(
        fetchImpl,
        {
          method: "GET",
          url: `${ADS_PROD_BASE}/oauth2/advertiser/get/`,
          accessToken,
          query: { app_id: cfg.appId, secret: cfg.appSecret },
        },
        advertiserGetDataSchema,
      );
      const ids = data.list.map((a) => String(a.advertiser_id));

      // Currency and timezone are nice to have: never fail the connection on them.
      let details = new Map<string, { currency?: string; timezone?: string; name?: string }>();
      try {
        details = await advertiserDetails(cfg, accessToken, ids);
      } catch {
        // ignore: e.g. sandbox host with a production token
      }

      return data.list.map((a) => {
        const id = String(a.advertiser_id);
        const d = details.get(id);
        return tiktokAdvertiserSchema.parse({
          advertiserId: id,
          name: a.advertiser_name || d?.name || id,
          currency: d?.currency && /^[A-Z]{3}$/.test(d.currency) ? d.currency : undefined,
          timezone: d?.timezone || undefined,
        });
      });
    },

    async uploadVideoByUrl(): Promise<{ videoId: string }> {
      // TODO(M3): POST /file/video/ad/upload/ with upload_type=UPLOAD_BY_URL,
      // video_url, file_name; poll /file/video/ad/info/ until processed.
      throw new NotImplementedIntegrationError(TIKTOK_ADS_PROVIDER, "uploadVideoByUrl");
    },

    async createPausedCampaign(): Promise<CampaignIds> {
      // TODO(M3): /campaign/create/, /adgroup/create/, /ad/create/ with
      // operation_status=DISABLE on every entity; identity via
      // /identity/create/ (CUSTOMIZED_USER) or Spark Ads auth code
      // (/tt_video/authorize/ + identity_type=AUTH_CODE).
      throw new NotImplementedIntegrationError(TIKTOK_ADS_PROVIDER, "createPausedCampaign");
    },

    async launchCampaign(): Promise<void> {
      // Spends money: never reachable from tests, even once implemented.
      assertNotUnderTest(TIKTOK_ADS_PROVIDER, "launchCampaign", env);
      // TODO(M3): /campaign/status/update/, /adgroup/status/update/,
      // /ad/status/update/ with operation_status=ENABLE (ads → ad groups → campaign last).
      throw new NotImplementedIntegrationError(TIKTOK_ADS_PROVIDER, "launchCampaign");
    },

    async pauseCampaign(): Promise<void> {
      // TODO(M3): status/update endpoints with operation_status=DISABLE (campaign first).
      throw new NotImplementedIntegrationError(TIKTOK_ADS_PROVIDER, "pauseCampaign");
    },

    async getHourlyStats(): Promise<HourlyStat[]> {
      // TODO(M3): GET /report/integrated/get/ report_type=BASIC,
      // data_level=AUCTION_CAMPAIGN, dimensions=["campaign_id","stat_time_hour"],
      // metrics spend, impressions, clicks, conversion, total_complete_payment_rate.
      throw new NotImplementedIntegrationError(TIKTOK_ADS_PROVIDER, "getHourlyStats");
    },
  };
}
