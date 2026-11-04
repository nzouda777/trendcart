import "server-only";

import { z } from "zod";

import {
  campaignIdsSchema,
  IntegrationError,
  oauthStartSchema,
  tiktokAdsCredentialsSchema,
  tiktokAdvertiserSchema,
  type CampaignIds,
  type HourlyStat,
  type OAuthStart,
  type TikTokAdsClient,
  type TikTokAdsCredentials,
  type TikTokAdvertiser,
  type TikTokIdentity,
} from "@/lib/domain/contracts";

import {
  ADS_AUTH_URL,
  ADS_PROD_BASE,
  readAdsConfig,
  resourceBase,
  TIKTOK_ADS_PROVIDER,
  type TikTokAdsConfig,
} from "./config";
import { adsRequest, withRetry, type AdsRequest } from "./http";
import { getRateLimiter, keyForSecret, type RateLimiter } from "./rate-limit";
import {
  foldHourlyStats,
  isValidTimeZone,
  localDatesFor,
  REPORT_METRICS,
  reportDataSchema,
  statsWindow,
  type ReportRow,
} from "./report";
import { assertNotUnderTest, realSleep, type Env } from "./safety";
import {
  adCreateBody,
  adGroupCreateBody,
  assertCreatesDisabled,
  campaignCreateBody,
  CreatedEnabledError,
  identityKey,
  validateSpecForTikTok,
  type ResolvedIdentity,
} from "./spec";

/*
 * Live TikTok Ads (Marketing API v1.3, see config.ts for hosts).
 *
 * Endpoints (paths under /open_api/v1.3):
 *   oauth2/access_token, oauth2/advertiser/get, advertiser/info
 *   file/video/ad/upload (UPLOAD_BY_URL), file/video/ad/info,
 *   file/image/ad/upload (UPLOAD_BY_URL: avatar and video cover)
 *   identity/get, identity/create (CUSTOMIZED_USER)
 *   tt_video/authorize, tt_video/info (Spark Ads, AUTH_CODE)
 *   campaign|adgroup|ad /create, /get, /status/update
 *   report/integrated/get
 *
 * Every call takes an "ads.api" token per advertiser (Upstash), and is
 * retried only on transient errors (see http.ts withRetry): rate limits
 * always, 5xx/timeouts only for reads, status updates and creates that carry
 * a request_id. createPausedCampaign looks entities up by name before
 * creating them, so a retried workflow step resumes instead of duplicating.
 */

export type LiveTikTokAdsOptions = {
  fetch?: typeof fetch;
  env?: Env;
  rateLimiter?: RateLimiter;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Test-only: lets launchCampaign run under vitest when `fetch` is an
   * injected stub (never the global fetch). Ignored outside tests.
   */
  allowStubbedSideEffectsUnderTest?: boolean;
};

const ATTEMPTS = 3;
/** Ids per status/update call (documented maximum is higher; stay small). */
const STATUS_BATCH = 20;
const PAGE_SIZE = 100;

const id = z.union([z.string(), z.number()]).transform(String);

const accessTokenDataSchema = z.object({
  access_token: z.string().min(1),
  advertiser_ids: z.array(id).default([]),
  /** Permission scope ids granted by the advertiser. */
  scope: z.array(z.union([z.string(), z.number()])).default([]),
});

const advertiserGetDataSchema = z.object({
  list: z
    .array(z.object({ advertiser_id: id, advertiser_name: z.string().default("") }))
    .default([]),
});

const advertiserInfoDataSchema = z.object({
  list: z
    .array(
      z.object({
        advertiser_id: id,
        name: z.string().optional(),
        currency: z.string().optional(),
        timezone: z.string().optional(),
        display_timezone: z.string().optional(),
      }),
    )
    .default([]),
});

const pageInfoSchema = z
  .object({ page: z.number().optional(), total_page: z.number().optional() })
  .optional();

const videoUploadDataSchema = z
  .union([z.array(z.object({ video_id: id })).min(1), z.object({ video_id: id })])
  .transform((d) => (Array.isArray(d) ? d[0]!.video_id : d.video_id));

const videoInfoDataSchema = z.object({
  list: z
    .array(
      z.object({
        video_id: id,
        video_cover_url: z.string().nullish(),
        poster_url: z.string().nullish(),
      }),
    )
    .default([]),
});

const imageUploadDataSchema = z
  .union([z.array(z.object({ image_id: id })).min(1), z.object({ image_id: id })])
  .transform((d) => (Array.isArray(d) ? d[0]!.image_id : d.image_id));

const identityGetDataSchema = z.object({
  identity_list: z
    .array(
      z.object({
        identity_id: id,
        identity_type: z.string().optional(),
        display_name: z.string().optional(),
      }),
    )
    .default([]),
  page_info: pageInfoSchema,
});

const identityCreateDataSchema = z.object({ identity_id: id });

const sparkInfoDataSchema = z.object({
  item_info: z.object({ item_id: id }).partial().optional(),
  user_info: z.object({ identity_id: id }).partial().optional(),
  identity_id: id.optional(),
});

const campaignListSchema = z.object({
  list: z
    .array(
      z.object({
        campaign_id: id,
        campaign_name: z.string().default(""),
        operation_status: z.string().optional(),
      }),
    )
    .default([]),
  page_info: pageInfoSchema,
});
const adGroupListSchema = z.object({
  list: z
    .array(
      z.object({
        adgroup_id: id,
        adgroup_name: z.string().default(""),
        campaign_id: id.optional(),
        operation_status: z.string().optional(),
      }),
    )
    .default([]),
  page_info: pageInfoSchema,
});
const adListSchema = z.object({
  list: z
    .array(
      z.object({
        ad_id: id,
        ad_name: z.string().default(""),
        adgroup_id: id.optional(),
        campaign_id: id.optional(),
        operation_status: z.string().optional(),
      }),
    )
    .default([]),
  page_info: pageInfoSchema,
});

const campaignCreateDataSchema = z.object({ campaign_id: id });
const adGroupCreateDataSchema = z.object({ adgroup_id: id });
const adCreateDataSchema = z
  .object({ ad_ids: z.array(id).optional(), ad_id: id.optional() })
  .transform((d, ctx) => {
    const adId = d.ad_ids?.[0] ?? d.ad_id;
    if (!adId) {
      ctx.addIssue({ code: "custom", message: "ad/create returned no ad id" });
      return z.NEVER;
    }
    return adId;
  });

const anyData = z.unknown();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createLiveTikTokAdsClient(options: LiveTikTokAdsOptions = {}): TikTokAdsClient {
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? realSleep;
  const limiter = () => options.rateLimiter ?? getRateLimiter(TIKTOK_ADS_PROVIDER);
  const config = (): TikTokAdsConfig => readAdsConfig(env);
  const timezones = new Map<string, string>();

  /** One rate-limited, retried Marketing API call for an advertiser. */
  async function call<T>(
    creds: TikTokAdsCredentials,
    req: Omit<AdsRequest, "url" | "accessToken"> & { path: string },
    schema: z.ZodType<T>,
    idempotent: boolean,
  ): Promise<T> {
    const cfg = config();
    return withRetry({ attempts: ATTEMPTS, idempotent, sleep }, async () => {
      await limiter().take("ads.api", `adv:${creds.advertiserId}`);
      return adsRequest(
        fetchImpl,
        {
          method: req.method,
          url: `${resourceBase(cfg)}/${req.path}`,
          accessToken: creds.accessToken,
          query: req.query,
          body: req.body,
        },
        schema,
      );
    });
  }

  async function getAll<T extends { list: unknown[]; page_info?: { total_page?: number } }>(
    creds: TikTokAdsCredentials,
    path: string,
    query: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T["list"]> {
    const items: T["list"] = [];
    for (let page = 1; page <= 50; page++) {
      const data = await call(
        creds,
        { method: "GET", path, query: { ...query, page, page_size: PAGE_SIZE } },
        schema,
        true,
      );
      items.push(...data.list);
      if (page >= (data.page_info?.total_page ?? 1)) break;
    }
    return items;
  }

  async function advertiserDetails(
    cfg: TikTokAdsConfig,
    accessToken: string,
    ids: string[],
  ): Promise<Map<string, z.infer<typeof advertiserInfoDataSchema>["list"][number]>> {
    const details = new Map<string, z.infer<typeof advertiserInfoDataSchema>["list"][number]>();
    // advertiser/info accepts up to 100 ids per call.
    for (const batch of chunk(ids, 100)) {
      await limiter().take("ads.api", `app:${cfg.appId}`);
      const data = await adsRequest(
        fetchImpl,
        {
          method: "GET",
          url: `${resourceBase(cfg)}/advertiser/info/`,
          accessToken,
          query: {
            advertiser_ids: batch,
            fields: ["advertiser_id", "name", "currency", "timezone", "display_timezone"],
          },
        },
        advertiserInfoDataSchema,
      );
      for (const a of data.list) details.set(a.advertiser_id, a);
    }
    return details;
  }

  /** Advertiser IANA time zone for reports; UTC when TikTok gives none. */
  async function advertiserTimeZone(creds: TikTokAdsCredentials): Promise<string> {
    const cached = timezones.get(creds.advertiserId);
    if (cached) return cached;
    const data = await call(
      creds,
      {
        method: "GET",
        path: "advertiser/info/",
        query: {
          advertiser_ids: [creds.advertiserId],
          fields: ["advertiser_id", "timezone", "display_timezone"],
        },
      },
      advertiserInfoDataSchema,
      true,
    );
    const a = data.list.find((x) => x.advertiser_id === creds.advertiserId) ?? data.list[0];
    const tz = [a?.display_timezone, a?.timezone].find(isValidTimeZone) ?? "UTC";
    timezones.set(creds.advertiserId, tz);
    return tz;
  }

  /* ---------------------------- identities ---------------------------- */

  async function uploadImageByUrl(creds: TikTokAdsCredentials, imageUrl: string, name: string) {
    return call(
      creds,
      {
        method: "POST",
        path: "file/image/ad/upload/",
        body: {
          advertiser_id: creds.advertiserId,
          upload_type: "UPLOAD_BY_URL",
          image_url: imageUrl,
          file_name: name,
        },
      },
      imageUploadDataSchema,
      false,
    );
  }

  async function customIdentityId(
    creds: TikTokAdsCredentials,
    identity: Extract<TikTokIdentity, { type: "custom" }>,
  ): Promise<string> {
    // Reuse an existing custom identity with the same display name.
    const existing = await getAll(
      creds,
      "identity/get/",
      { advertiser_id: creds.advertiserId, identity_type: "CUSTOMIZED_USER" },
      identityGetDataSchema.transform((d) => ({ list: d.identity_list, page_info: d.page_info })),
    );
    const match = existing.find((i) => i.display_name === identity.displayName);
    if (match) return match.identity_id;

    const imageUri = identity.avatarUrl
      ? await uploadImageByUrl(
          creds,
          identity.avatarUrl,
          `avatar-${keyForSecret(identity.avatarUrl)}-${now().getTime()}`,
        )
      : undefined;
    const created = await call(
      creds,
      {
        method: "POST",
        path: "identity/create/",
        body: {
          advertiser_id: creds.advertiserId,
          display_name: identity.displayName,
          ...(imageUri ? { image_uri: imageUri } : {}),
        },
      },
      identityCreateDataSchema,
      false,
    );
    return created.identity_id;
  }

  async function sparkIdentity(
    creds: TikTokAdsCredentials,
    authCode: string,
  ): Promise<{ identityId: string; tiktokItemId: string }> {
    // Bind the creator's post to the advertiser. Re-authorizing an already
    // bound code is rejected by TikTok: tt_video/info is the source of truth.
    try {
      await call(
        creds,
        {
          method: "POST",
          path: "tt_video/authorize/",
          body: { advertiser_id: creds.advertiserId, auth_code: authCode },
        },
        anyData,
        true,
      );
    } catch (error) {
      if (!(error instanceof IntegrationError) || error.code !== "invalid_input") throw error;
    }
    const info = await call(
      creds,
      {
        method: "GET",
        path: "tt_video/info/",
        query: { advertiser_id: creds.advertiserId, auth_code: authCode },
      },
      sparkInfoDataSchema,
      true,
    );
    const identityId = info.user_info?.identity_id ?? info.identity_id;
    const tiktokItemId = info.item_info?.item_id;
    if (!identityId || !tiktokItemId) {
      throw new IntegrationError(
        TIKTOK_ADS_PROVIDER,
        "invalid_input",
        "The Spark Ads authorization code did not resolve to a post. Ask the creator for a new code.",
        { retryable: false },
      );
    }
    return { identityId, tiktokItemId };
  }

  async function videoCoverImageId(creds: TikTokAdsCredentials, videoId: string) {
    const info = await call(
      creds,
      {
        method: "GET",
        path: "file/video/ad/info/",
        query: { advertiser_id: creds.advertiserId, video_ids: [videoId] },
      },
      videoInfoDataSchema,
      true,
    );
    const v = info.list.find((x) => x.video_id === videoId);
    if (!v) {
      throw new IntegrationError(
        TIKTOK_ADS_PROVIDER,
        "not_found",
        `Video ${videoId} is not in this ad account.`,
        { retryable: false },
      );
    }
    const cover = v.video_cover_url || v.poster_url;
    if (!cover) {
      // Still processing after upload: the workflow step retries later.
      throw new IntegrationError(
        TIKTOK_ADS_PROVIDER,
        "provider_error",
        `Video ${videoId} is still processing.`,
      );
    }
    return uploadImageByUrl(creds, cover, `cover-${videoId}-${now().getTime()}`);
  }

  /* ----------------------------- entities ----------------------------- */

  const campaignsByName = (creds: TikTokAdsCredentials, name: string) =>
    getAll(
      creds,
      "campaign/get/",
      {
        advertiser_id: creds.advertiserId,
        filtering: { campaign_name: name },
        fields: ["campaign_id", "campaign_name", "operation_status"],
      },
      campaignListSchema,
    ).then((list) => list.filter((c) => c.campaign_name === name));

  const adGroupsOf = (creds: TikTokAdsCredentials, campaignId: string) =>
    getAll(
      creds,
      "adgroup/get/",
      {
        advertiser_id: creds.advertiserId,
        filtering: { campaign_ids: [campaignId] },
        fields: ["adgroup_id", "adgroup_name", "campaign_id", "operation_status"],
      },
      adGroupListSchema,
    );

  const adsOf = (creds: TikTokAdsCredentials, campaignId: string) =>
    getAll(
      creds,
      "ad/get/",
      {
        advertiser_id: creds.advertiserId,
        filtering: { campaign_ids: [campaignId] },
        fields: ["ad_id", "ad_name", "adgroup_id", "campaign_id", "operation_status"],
      },
      adListSchema,
    );

  /** Sends a create only after the never-spend guard has passed. */
  async function createDisabled<T>(
    creds: TikTokAdsCredentials,
    kind: "campaign" | "adgroup" | "ad",
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    assertCreatesDisabled(kind, body);
    // Campaign and ad group creates carry a request_id: safe to retry.
    return call(
      creds,
      { method: "POST", path: `${kind}/create/`, body },
      schema,
      kind !== "ad",
    );
  }

  async function setStatus(
    creds: TikTokAdsCredentials,
    kind: "campaign" | "adgroup" | "ad",
    ids: string[],
    status: "ENABLE" | "DISABLE",
  ) {
    const key = `${kind}_ids`;
    for (const batch of chunk(ids, STATUS_BATCH)) {
      await call(
        creds,
        {
          method: "POST",
          path: `${kind}/status/update/`,
          body: { advertiser_id: creds.advertiserId, [key]: batch, operation_status: status },
        },
        anyData,
        true,
      );
    }
  }

  async function disableAll(creds: TikTokAdsCredentials, ids: CampaignIds) {
    // Campaign first: one call stops every delivery under it.
    await setStatus(creds, "campaign", [ids.campaignId], "DISABLE");
    await setStatus(creds, "adgroup", ids.adGroups.map((g) => g.adGroupId), "DISABLE");
    await setStatus(creds, "ad", ids.adGroups.flatMap((g) => g.adIds), "DISABLE");
  }

  /** Every id in `ids` must exist under `ids.campaignId` (like the mock's known-ids check). */
  async function assertIdsBelong(creds: TikTokAdsCredentials, ids: CampaignIds) {
    const [campaigns, groups, ads] = await Promise.all([
      getAll(
        creds,
        "campaign/get/",
        {
          advertiser_id: creds.advertiserId,
          filtering: { campaign_ids: [ids.campaignId] },
          fields: ["campaign_id", "campaign_name", "operation_status"],
        },
        campaignListSchema,
      ),
      adGroupsOf(creds, ids.campaignId),
      adsOf(creds, ids.campaignId),
    ]);
    const known = new Set([
      ...campaigns.map((c) => c.campaign_id),
      ...groups.map((g) => g.adgroup_id),
      ...ads.map((a) => a.ad_id),
    ]);
    const all = [ids.campaignId, ...ids.adGroups.flatMap((g) => [g.adGroupId, ...g.adIds])];
    const missing = all.find((x) => !known.has(x));
    if (missing) {
      throw new IntegrationError(
        TIKTOK_ADS_PROVIDER,
        "not_found",
        `Entity ${missing} is not part of campaign ${ids.campaignId}.`,
        { retryable: false },
      );
    }
    return { campaigns, groups, ads };
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
        advertiserIds: data.advertiser_ids,
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
      const ids = data.list.map((a) => a.advertiser_id);

      // Currency and timezone are nice to have: never fail the connection on them.
      let details = new Map<string, z.infer<typeof advertiserInfoDataSchema>["list"][number]>();
      try {
        details = await advertiserDetails(cfg, accessToken, ids);
      } catch {
        // ignore: e.g. sandbox host with a production token
      }

      return data.list.map((a) => {
        const d = details.get(a.advertiser_id);
        const tz = [d?.display_timezone, d?.timezone].find(isValidTimeZone);
        return tiktokAdvertiserSchema.parse({
          advertiserId: a.advertiser_id,
          name: a.advertiser_name || d?.name || a.advertiser_id,
          currency: d?.currency && /^[A-Z]{3}$/.test(d.currency) ? d.currency : undefined,
          timezone: tz ?? (d?.timezone || undefined),
        });
      });
    },

    async uploadVideoByUrl(rawCreds, input) {
      const creds = tiktokAdsCredentialsSchema.parse(rawCreds);
      const { videoUrl, fileName } = z
        .object({ videoUrl: z.url(), fileName: z.string().min(1).max(100) })
        .parse(input);
      // Not idempotent (no request_id): retried on rate limits only. The
      // caller stores the returned id per advertiser and never re-uploads.
      const videoId = await call(
        creds,
        {
          method: "POST",
          path: "file/video/ad/upload/",
          body: {
            advertiser_id: creds.advertiserId,
            upload_type: "UPLOAD_BY_URL",
            video_url: videoUrl,
            file_name: fileName,
          },
        },
        videoUploadDataSchema,
        false,
      );
      return { videoId };
    },

    async createPausedCampaign(rawCreds, rawSpec): Promise<CampaignIds> {
      const creds = tiktokAdsCredentialsSchema.parse(rawCreds);
      const spec = validateSpecForTikTok(rawSpec);

      // Identities first: nothing is created if a Spark code or video is bad.
      const identities = new Map<string, string>();
      const sparkItems = new Map<string, { identityId: string; tiktokItemId: string }>();
      for (const ad of spec.adGroups.flatMap((g) => g.ads)) {
        const key = identityKey(ad.identity);
        if (ad.identity.type === "custom" && !identities.has(key)) {
          identities.set(key, await customIdentityId(creds, ad.identity));
        } else if (ad.identity.type === "spark" && !sparkItems.has(key)) {
          sparkItems.set(key, await sparkIdentity(creds, ad.identity.authCode));
        }
      }

      // Campaign: reuse by exact name (idempotent re-run), else create DISABLED.
      const [found, ...more] = await campaignsByName(creds, spec.name);
      if (more.length > 0) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          `Several campaigns are named "${spec.name}" in this ad account.`,
          { retryable: false },
        );
      }
      if (found && found.operation_status === "ENABLE") {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          `Campaign "${spec.name}" already exists and is enabled; it will not be reused as a paused campaign.`,
          { retryable: false },
        );
      }
      const campaignId =
        found?.campaign_id ??
        (
          await createDisabled(
            creds,
            "campaign",
            campaignCreateBody(creds.advertiserId, spec),
            campaignCreateDataSchema,
          )
        ).campaign_id;

      const existingGroups = found ? await adGroupsOf(creds, campaignId) : [];
      const existingAds = found ? await adsOf(creds, campaignId) : [];
      const covers = new Map<string, string>();

      const adGroups: CampaignIds["adGroups"] = [];
      for (const group of spec.adGroups) {
        const adGroupId =
          existingGroups.find((g) => g.adgroup_name === group.name)?.adgroup_id ??
          (
            await createDisabled(
              creds,
              "adgroup",
              adGroupCreateBody(creds.advertiserId, campaignId, spec, group, now()),
              adGroupCreateDataSchema,
            )
          ).adgroup_id;

        const adIds: string[] = [];
        for (const ad of group.ads) {
          const reuse = existingAds.find(
            (a) => a.ad_name === ad.name && (!a.adgroup_id || a.adgroup_id === adGroupId),
          );
          if (reuse) {
            adIds.push(reuse.ad_id);
            continue;
          }
          const key = identityKey(ad.identity);
          let resolved: ResolvedIdentity;
          if (ad.identity.type === "spark") {
            resolved = { type: "spark", ...sparkItems.get(key)! };
          } else {
            let cover = covers.get(ad.videoId);
            if (!cover) {
              cover = await videoCoverImageId(creds, ad.videoId);
              covers.set(ad.videoId, cover);
            }
            resolved = {
              type: "custom",
              identityId: identities.get(key)!,
              videoId: ad.videoId,
              coverImageId: cover,
            };
          }
          adIds.push(
            await createDisabled(
              creds,
              "ad",
              adCreateBody(creds.advertiserId, adGroupId, spec, ad, resolved),
              adCreateDataSchema,
            ),
          );
        }
        adGroups.push({ adGroupId, adIds });
      }
      const ids = campaignIdsSchema.parse({ campaignId, adGroups });

      // Defence in depth: read back and make sure nothing came out enabled.
      const { campaigns, groups, ads } = await assertIdsBelong(creds, ids);
      const mine = new Set([
        ids.campaignId,
        ...ids.adGroups.flatMap((g) => [g.adGroupId, ...g.adIds]),
      ]);
      const enabled = [
        ...campaigns.map((c) => [c.campaign_id, c.operation_status] as const),
        ...groups.map((g) => [g.adgroup_id, g.operation_status] as const),
        ...ads.map((a) => [a.ad_id, a.operation_status] as const),
      ].filter(([eid, status]) => mine.has(eid) && status === "ENABLE");
      if (enabled.length > 0) {
        await disableAll(creds, ids);
        throw new CreatedEnabledError(
          `TikTok reported ${enabled.length} entities enabled after a paused create; they were disabled again.`,
        );
      }
      return ids;
    },

    async launchCampaign(rawCreds, rawIds): Promise<void> {
      // Spends money: blocked under test unless the transport is a stub.
      assertNotUnderTest(TIKTOK_ADS_PROVIDER, "launchCampaign", env, {
        injectedFetch: options.fetch,
        allowStubbedSideEffectsUnderTest: options.allowStubbedSideEffectsUnderTest,
      });
      const creds = tiktokAdsCredentialsSchema.parse(rawCreds);
      const ids = campaignIdsSchema.parse(rawIds);
      if (ids.adGroups.length === 0 || ids.adGroups.some((g) => g.adIds.length === 0)) {
        throw new IntegrationError(
          TIKTOK_ADS_PROVIDER,
          "invalid_input",
          "A campaign needs at least one ad group with ads to launch.",
          { retryable: false },
        );
      }
      await assertIdsBelong(creds, ids);
      // Bottom-up: ads, then ad groups, the campaign last. Delivery starts
      // only when all three levels are enabled, so it starts complete.
      await setStatus(creds, "ad", ids.adGroups.flatMap((g) => g.adIds), "ENABLE");
      await setStatus(creds, "adgroup", ids.adGroups.map((g) => g.adGroupId), "ENABLE");
      await setStatus(creds, "campaign", [ids.campaignId], "ENABLE");
    },

    async pauseCampaign(rawCreds, rawIds): Promise<void> {
      const creds = tiktokAdsCredentialsSchema.parse(rawCreds);
      const ids = campaignIdsSchema.parse(rawIds);
      await disableAll(creds, ids);
    },

    async getHourlyStats(rawCreds, input): Promise<HourlyStat[]> {
      const creds = tiktokAdsCredentialsSchema.parse(rawCreds);
      const { campaignId, from, to } = z
        .object({ campaignId: z.string().min(1), from: z.iso.datetime(), to: z.iso.datetime() })
        .parse(input);
      const { start, end } = statsWindow(from, to);
      if (end <= start) return [];
      const tz = await advertiserTimeZone(creds);

      const rows: ReportRow[] = [];
      for (const date of localDatesFor(tz, start, end)) {
        for (let page = 1; page <= 20; page++) {
          const data = await call(
            creds,
            {
              method: "GET",
              path: "report/integrated/get/",
              query: {
                advertiser_id: creds.advertiserId,
                report_type: "BASIC",
                data_level: "AUCTION_CAMPAIGN",
                dimensions: ["campaign_id", "stat_time_hour"],
                metrics: REPORT_METRICS,
                start_date: date,
                end_date: date,
                filtering: [
                  {
                    field_name: "campaign_ids",
                    filter_type: "IN",
                    filter_value: JSON.stringify([campaignId]),
                  },
                ],
                page,
                page_size: 1000,
              },
            },
            reportDataSchema,
            true,
          );
          rows.push(
            ...data.list.filter(
              (r) => !r.dimensions.campaign_id || r.dimensions.campaign_id === campaignId,
            ),
          );
          if (page >= (data.page_info?.total_page ?? 1)) break;
        }
      }
      return foldHourlyStats(tz, rows, start, end);
    },
  };
}
