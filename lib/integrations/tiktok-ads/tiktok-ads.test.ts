import { describe, expect, it, vi } from "vitest";

import {
  campaignIdsSchema,
  hourlyStatSchema,
  IntegrationError,
  tiktokAdvertiserSchema,
  type CampaignIds,
  type CampaignSpec,
} from "@/lib/domain/contracts";

import fx from "./__fixtures__/marketing-api-v1.3.json";
import { ADS_PROD_BASE, ADS_SANDBOX_BASE } from "./config";
import { quoteBigIds, requestIdFor, TimeBudgetError, withRetry } from "./http";
import { STATS_CALL_BUDGET_MS, STATS_MAX_WINDOW_HOURS } from "./limits";
import { createTikTokAdsClient } from "./index";
import { createLiveTikTokAdsClient, type LiveTikTokAdsOptions } from "./live";
import { BUDGET_FLOORS } from "./budget";
import { createMockTikTokAdsClient, MOCK_ADS_AUTH_CODE, MOCK_ADVERTISERS } from "./mock";
import { noopRateLimiter, type RateLimiter } from "./rate-limit";
import { localDatesFor, localToUtc } from "./report";
import { isTestEnvironment, UnsafeActionError } from "./safety";
import {
  adCreateBody,
  adGroupCreateBody,
  assertCreatesDisabled,
  campaignCreateBody,
  CreatedEnabledError,
  validateSpecForTikTok,
} from "./spec";

const oauth = {
  state: "s".repeat(32),
  redirectUri: "http://localhost:3000/api/tiktok/ads/callback",
};
const creds = { advertiserId: "7000000000000000001", accessToken: "mock-ads-token-x" };

const spec: CampaignSpec = {
  name: "Test campaign",
  objective: "WEB_CONVERSIONS",
  budget: { mode: "daily", amount: 50, level: "ad_group" },
  pixelId: "PIXEL1",
  optimizationEvent: "SHOPPING",
  landingPageUrl: "https://shop.example.com/products/x",
  adGroups: [
    {
      name: "FR broad",
      countries: ["FR"],
      bidStrategy: "lowest_cost",
      ads: [
        {
          name: "Ad 1",
          videoId: "v10033g50000ctestvideo0001",
          adText: "Great product",
          callToAction: "SHOP_NOW",
          identity: { type: "custom", displayName: "Brand" },
        },
        {
          name: "Ad 2",
          videoId: "v2",
          adText: "Great product",
          callToAction: "SHOP_NOW",
          identity: { type: "spark", authCode: "spark-code" },
        },
      ],
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Recorded-fixture transport                                                 */
/* -------------------------------------------------------------------------- */

type Recorded = { method: string; path: string; query: Record<string, string>; body: unknown };
type Reply = unknown | ((call: Recorded) => unknown);

/**
 * A fetch stub that serves fixture envelopes by "METHOD path". A list of
 * replies is consumed in order (the last one repeats). Every call is recorded.
 */
function fixtureFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: Recorded[] = [];
  const cursors = new Map<string, number>();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/open_api\/v1\.3\//, "");
    const call: Recorded = {
      method: init?.method ?? "GET",
      path,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const key = `${call.method} ${path}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`No fixture for ${key}`);
    const list = Array.isArray(route) ? route : [route];
    const i = cursors.get(key) ?? 0;
    cursors.set(key, i + 1);
    const reply = list[Math.min(i, list.length - 1)];
    const body = typeof reply === "function" ? (reply as (c: Recorded) => unknown)(call) : reply;
    if (body instanceof Response) return body;
    // Raw text: lets a test send int64 ids as JSON numbers, as TikTok may.
    if (typeof body === "string") return new Response(body);
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
  return { fetch, calls, url: (c: Recorded) => c.path };
}

const env = { TIKTOK_APP_ID: "app123", TIKTOK_APP_SECRET: "secret", TIKTOK_SANDBOX: "true" };
const fixedNow = () => new Date("2026-11-04T10:00:00.000Z");

function live(fetch: typeof globalThis.fetch, extra: Partial<LiveTikTokAdsOptions> = {}) {
  return createLiveTikTokAdsClient({
    env,
    fetch,
    rateLimiter: noopRateLimiter,
    now: fixedNow,
    sleep: async () => {},
    ...extra,
  });
}

/** Routes for a fresh account: nothing exists yet. */
const freshRoutes = () => ({
  "GET identity/get/": fx.identity_get_empty,
  "POST identity/create/": fx.identity_create,
  "POST tt_video/authorize/": fx.tt_video_authorize,
  "GET tt_video/info/": fx.tt_video_info,
  "GET campaign/get/": [fx.campaign_get_empty, fx.campaign_get_created],
  "POST campaign/create/": fx.campaign_create,
  "POST adgroup/create/": fx.adgroup_create,
  "GET file/video/ad/info/": fx.video_info,
  "POST file/image/ad/upload/": fx.image_upload,
  "POST ad/create/": [fx.ad_create_1, fx.ad_create_2],
  "GET adgroup/get/": fx.adgroup_get_created,
  "GET ad/get/": fx.ad_get_created,
  "POST campaign/status/update/": fx.status_update,
  "POST adgroup/status/update/": fx.status_update,
  "POST ad/status/update/": fx.status_update,
});

/** Routes once the paused campaign exists. */
const createdRoutes = () => ({ ...freshRoutes(), "GET campaign/get/": fx.campaign_get_created });

const createdIds: CampaignIds = {
  campaignId: "1812345678901234567",
  adGroups: [
    { adGroupId: "1812345678901234600", adIds: ["1812345678901234701", "1812345678901234702"] },
  ],
};

/* -------------------------------------------------------------------------- */
/* Mock                                                                       */
/* -------------------------------------------------------------------------- */

describe("tiktok ads mock: contract conformance", () => {
  it("defaults to the mock in mock mode", () => {
    expect(createTikTokAdsClient("mock")).toHaveProperty("statusOf");
  });

  it("auth url loops back to our callback with a code and the state", () => {
    const url = new URL(createMockTikTokAdsClient().buildAuthUrl(oauth));
    expect(url.origin + url.pathname).toBe(oauth.redirectUri);
    expect(url.searchParams.get("state")).toBe(oauth.state);
    expect(url.searchParams.get("auth_code")).toBe(MOCK_ADS_AUTH_CODE);
  });

  it("exchanges a code and lists advertisers matching the schema", async () => {
    const client = createMockTikTokAdsClient();
    const token = await client.exchangeAuthCode({ code: MOCK_ADS_AUTH_CODE });
    expect(token.advertiserIds.length).toBeGreaterThan(0);
    const advertisers = await client.listAdvertisers({ accessToken: token.accessToken });
    for (const a of advertisers) tiktokAdvertiserSchema.parse(a);
    expect(advertisers.map((a) => a.advertiserId)).toEqual(token.advertiserIds);
    await expect(client.exchangeAuthCode({ code: "bad-code" })).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });

  it("uploads deterministically", async () => {
    const a = createMockTikTokAdsClient();
    const input = { videoUrl: "https://cdn.shopify.com/v.mp4", fileName: "v.mp4" };
    expect(await a.uploadVideoByUrl(creds, input)).toEqual(
      await createMockTikTokAdsClient().uploadVideoByUrl(creds, input),
    );
  });

  it("creates everything paused, launches and pauses only known ids", async () => {
    const client = createMockTikTokAdsClient();
    const ids = campaignIdsSchema.parse(await client.createPausedCampaign(creds, spec));
    expect(ids.adGroups[0].adIds).toHaveLength(2);
    const all = [ids.campaignId, ids.adGroups[0].adGroupId, ...ids.adGroups[0].adIds];
    expect(all.every((id) => client.statusOf(id) === "DISABLE")).toBe(true);
    expect(new Set(all).size).toBe(all.length);

    // Paused campaigns spend nothing.
    const paused = await client.getHourlyStats(creds, {
      campaignId: ids.campaignId,
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-01T03:00:00.000Z",
    });
    expect(paused.every((s) => s.spend === 0)).toBe(true);

    await client.launchCampaign(creds, ids);
    expect(all.every((id) => client.statusOf(id) === "ENABLE")).toBe(true);
    await client.pauseCampaign(creds, ids);
    expect(all.every((id) => client.statusOf(id) === "DISABLE")).toBe(true);

    await expect(
      client.launchCampaign(creds, { campaignId: "999", adGroups: [] }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      client.launchCampaign(creds, {
        campaignId: "999",
        adGroups: [{ adGroupId: "998", adIds: ["997"] }],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("re-creating the same spec returns the same ids while paused (like live)", async () => {
    const client = createMockTikTokAdsClient();
    const ids = await client.createPausedCampaign(creds, spec);
    expect(await client.createPausedCampaign(creds, spec)).toEqual(ids);
    expect(client.statusOf(ids.campaignId)).toBe("DISABLE");
  });

  it("refuses to reuse a same-name campaign that is enabled, exactly like live (N4)", async () => {
    const client = createMockTikTokAdsClient();
    const ids = await client.createPausedCampaign(creds, spec);
    await client.launchCampaign(creds, ids);
    await expect(client.createPausedCampaign(creds, spec)).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
    });
    // Nothing was touched by the refused call.
    expect(client.statusOf(ids.campaignId)).toBe("ENABLE");
    await client.pauseCampaign(creds, ids);
    expect(await client.createPausedCampaign(creds, spec)).toEqual(ids);
  });

  it("lists one EUR and one USD advertiser, each with currency and time zone (B1)", async () => {
    const client = createMockTikTokAdsClient();
    const token = await client.exchangeAuthCode({ code: MOCK_ADS_AUTH_CODE });
    const advertisers = await client.listAdvertisers({ accessToken: token.accessToken });
    expect(advertisers.map((a) => a.currency).sort()).toEqual(["EUR", "USD"]);
    expect(advertisers.every((a) => a.timezone)).toBe(true);
    expect(advertisers).toEqual(MOCK_ADVERTISERS);
  });

  it("updateBudget changes amounts only, never a status, and follows live's rules", async () => {
    const client = createMockTikTokAdsClient();
    const ids = await client.createPausedCampaign(creds, spec);
    const group = ids.adGroups[0]!.adGroupId;
    expect(client.budgetOf(group)).toBe(50);
    await client.updateBudget(creds, {
      ids,
      budget: { mode: "daily", amount: 80, level: "ad_group" },
    });
    expect(client.budgetOf(group)).toBe(80);
    const all = [ids.campaignId, group, ...ids.adGroups[0]!.adIds];
    expect(all.every((x) => client.statusOf(x) === "DISABLE")).toBe(true);

    // Launched: still never touches a status.
    await client.launchCampaign(creds, ids);
    await client.updateBudget(creds, {
      ids,
      budget: { mode: "daily", amount: 60, level: "ad_group" },
    });
    expect(all.every((x) => client.statusOf(x) === "ENABLE")).toBe(true);

    for (const budget of [
      { mode: "total", amount: 500, level: "ad_group" },
      { mode: "daily", amount: 500, level: "campaign" },
      { mode: "daily", amount: 10.005, level: "ad_group" },
    ] as const) {
      await expect(client.updateBudget(creds, { ids, budget })).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    await expect(
      client.updateBudget(creds, {
        ids: { campaignId: "999", adGroups: [{ adGroupId: "998", adIds: ["997"] }] },
        budget: { mode: "daily", amount: 60, level: "ad_group" },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("updateBudget refuses a value below TikTok's minimum for the advertiser currency", async () => {
    const client = createMockTikTokAdsClient();
    const usd = {
      ...creds,
      advertiserId: MOCK_ADVERTISERS.find((a) => a.currency === "USD")!.advertiserId,
    };
    const ids = await client.createPausedCampaign(usd, spec);
    const floor = BUDGET_FLOORS.USD!.adGroupDaily;
    await expect(
      client.updateBudget(usd, {
        ids,
        budget: { mode: "daily", amount: floor - 1, level: "ad_group" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(client.budgetOf(ids.adGroups[0]!.adGroupId)).toBe(50);
    await client.updateBudget(usd, {
      ids,
      budget: { mode: "daily", amount: floor, level: "ad_group" },
    });
    expect(client.budgetOf(ids.adGroups[0]!.adGroupId)).toBe(floor);

    const cbo = await client.createPausedCampaign(usd, {
      ...spec,
      name: "CBO",
      budget: { mode: "daily", amount: 100, level: "campaign" },
    });
    await expect(
      client.updateBudget(usd, {
        ids: cbo,
        budget: { mode: "daily", amount: BUDGET_FLOORS.USD!.campaign - 1, level: "campaign" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects the same specs live would reject", async () => {
    const client = createMockTikTokAdsClient();
    await expect(
      client.createPausedCampaign(creds, { ...spec, pixelId: undefined }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      client.createPausedCampaign(creds, {
        ...spec,
        adGroups: [{ ...spec.adGroups[0], countries: ["AQ"] }],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("returns one parseable stat per hour, deterministically", async () => {
    const client = createMockTikTokAdsClient();
    const input = {
      campaignId: "1700000000000000000",
      from: "2026-10-01T00:30:00.000Z",
      to: "2026-10-01T05:00:00.000Z",
    };
    const stats = await client.getHourlyStats(creds, input);
    expect(stats).toHaveLength(5);
    expect(stats[0].hour).toBe("2026-10-01T00:00:00.000Z");
    for (const s of stats) hourlyStatSchema.parse(s);
    expect(await createMockTikTokAdsClient().getHourlyStats(creds, input)).toEqual(stats);
    await expect(
      client.getHourlyStats(creds, { ...input, to: "2026-09-30T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // Bounded like live: at most STATS_MAX_WINDOW_HOURS per call.
    await expect(
      client.getHourlyStats(creds, {
        ...input,
        from: "2026-10-01T00:00:00.000Z",
        to: new Date(
          Date.parse("2026-10-01T00:00:00.000Z") + (STATS_MAX_WINDOW_HOURS + 1) * 3_600_000,
        ).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

/* -------------------------------------------------------------------------- */
/* Never created enabled                                                      */
/* -------------------------------------------------------------------------- */

describe("never created enabled", () => {
  const parsed = validateSpecForTikTok(spec);
  const custom = {
    type: "custom" as const,
    identityId: "i",
    videoId: "v",
    coverImageId: "img",
  };

  it("every create payload is DISABLE, whatever the spec", () => {
    for (const budget of [
      { mode: "daily", amount: 10, level: "campaign" },
      { mode: "total", amount: 100, level: "ad_group" },
    ] as const) {
      const s = validateSpecForTikTok({ ...spec, budget });
      expect(campaignCreateBody("a", s).operation_status).toBe("DISABLE");
      expect(adGroupCreateBody("a", "c", s, s.adGroups[0], fixedNow()).operation_status).toBe(
        "DISABLE",
      );
      const ad = adCreateBody("a", "g", s, s.adGroups[0].ads[0], custom);
      expect(ad.creatives.every((c) => c.operation_status === "DISABLE")).toBe(true);
    }
  });

  it("the guard refuses anything not explicitly DISABLE (TikTok defaults to ENABLE)", () => {
    expect(() => assertCreatesDisabled("campaign", { campaign_name: "x" })).toThrow(
      CreatedEnabledError,
    );
    expect(() => assertCreatesDisabled("adgroup", { operation_status: "ENABLE" })).toThrow(
      CreatedEnabledError,
    );
    expect(() => assertCreatesDisabled("ad", { creatives: [] })).toThrow(CreatedEnabledError);
    expect(() =>
      assertCreatesDisabled("ad", {
        creatives: [{ operation_status: "DISABLE" }, { operation_status: "ENABLE" }],
      }),
    ).toThrow(CreatedEnabledError);
    expect(() =>
      assertCreatesDisabled(
        "ad",
        adCreateBody("a", "g", parsed, parsed.adGroups[0].ads[0], custom),
      ),
    ).not.toThrow();
  });

  it("live sends DISABLE on every create and never an ENABLE status update", async () => {
    const { fetch, calls } = fixtureFetch(freshRoutes());
    await live(fetch).createPausedCampaign(creds, spec);
    const creates = calls.filter((c) => /^(campaign|adgroup|ad)\/create\/$/.test(c.path));
    expect(creates.map((c) => c.path)).toEqual([
      "campaign/create/",
      "adgroup/create/",
      "ad/create/",
      "ad/create/",
    ]);
    for (const c of creates) {
      const body = c.body as {
        operation_status?: string;
        creatives?: { operation_status: string }[];
      };
      const statuses = body.creatives?.map((x) => x.operation_status) ?? [body.operation_status];
      expect(statuses).toEqual(statuses.map(() => "DISABLE"));
    }
    expect(calls.some((c) => c.path.endsWith("status/update/"))).toBe(false);
  });

  it("if TikTok reports anything enabled after creation, it is disabled again and the call fails", async () => {
    const routes = freshRoutes();
    const enabledAds = structuredClone(fx.ad_get_created);
    enabledAds.data.list[1].operation_status = "ENABLE";
    const { fetch, calls } = fixtureFetch({ ...routes, "GET ad/get/": enabledAds });
    await expect(live(fetch).createPausedCampaign(creds, spec)).rejects.toBeInstanceOf(
      CreatedEnabledError,
    );
    const updates = calls.filter((c) => c.path.endsWith("status/update/"));
    expect(updates.map((c) => c.path)).toEqual([
      "campaign/status/update/",
      "adgroup/status/update/",
      "ad/status/update/",
    ]);
    expect(
      updates.every((c) => (c.body as { operation_status: string }).operation_status === "DISABLE"),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Live, recorded fixtures, no network                                        */
/* -------------------------------------------------------------------------- */

describe("tiktok ads live: auth and advertisers", () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

  it("builds the advertiser authorization url", () => {
    const client = live(vi.fn());
    const url = new URL(client.buildAuthUrl(oauth));
    expect(url.origin + url.pathname).toBe("https://business-api.tiktok.com/portal/auth");
    expect(url.searchParams.get("app_id")).toBe("app123");
    expect(url.searchParams.get("redirect_uri")).toBe(oauth.redirectUri);
  });

  it("exchanges auth_code on oauth2/access_token (v1.3) and maps the envelope", async () => {
    const fetch = vi.fn(async () =>
      json({
        code: 0,
        message: "OK",
        data: { access_token: "tok", advertiser_ids: ["1", 2], scope: [1, 4] },
      }),
    );
    const client = live(fetch);
    expect(await client.exchangeAuthCode({ code: "abc" })).toEqual({
      accessToken: "tok",
      advertiserIds: ["1", "2"],
      scopes: ["1", "4"],
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/");
    expect(JSON.parse(String(init.body))).toEqual({
      app_id: "app123",
      secret: "secret",
      auth_code: "abc",
    });
  });

  it("maps token errors to auth_expired", async () => {
    const fetch = vi.fn(async () => json({ code: 40105, message: "Access token is incorrect" }));
    await expect(live(fetch).listAdvertisers({ accessToken: "x" })).rejects.toMatchObject({
      code: "auth_expired",
    });
  });

  it("never lists an advertiser without its currency (B1)", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2/advertiser/get")
        ? json({ code: 0, data: { list: [{ advertiser_id: 42, advertiser_name: "Acme" }] } })
        : json({ code: 40001, message: "no permission" }),
    );
    await expect(live(fetch).listAdvertisers({ accessToken: "tok" })).rejects.toMatchObject({
      code: "provider_error",
    });

    const noCurrency = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2/advertiser/get")
        ? json({ code: 0, data: { list: [{ advertiser_id: 42, advertiser_name: "Acme" }] } })
        : json({ code: 0, data: { list: [{ advertiser_id: "42", timezone: "UTC" }] } }),
    );
    await expect(live(noCurrency).listAdvertisers({ accessToken: "tok" })).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("in sandbox, reads advertiser/info from production when the sandbox host refuses the token", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("oauth2/advertiser/get")) {
        return json({
          code: 0,
          data: { list: [{ advertiser_id: "42", advertiser_name: "Acme" }] },
        });
      }
      if (u.startsWith(ADS_SANDBOX_BASE)) return json({ code: 40105, message: "bad token" });
      return json({
        code: 0,
        data: { list: [{ advertiser_id: "42", currency: "USD", timezone: "America/New_York" }] },
      });
    });
    expect(await live(fetch).listAdvertisers({ accessToken: "tok" })).toEqual([
      { advertiserId: "42", name: "Acme", currency: "USD", timezone: "America/New_York" },
    ]);
    const infoHosts = fetch.mock.calls
      .map((c) => String((c as unknown[])[0]))
      .filter((u) => u.includes("advertiser/info"))
      .map((u) => new URL(u).origin);
    expect(infoHosts).toEqual([new URL(ADS_SANDBOX_BASE).origin, new URL(ADS_PROD_BASE).origin]);
  });

  it("keeps int64 advertiser ids exact and prefers the IANA display time zone", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2/advertiser/get")
        ? new Response(
            '{"code":0,"data":{"list":[{"advertiser_id":7000000000000000001,"advertiser_name":"EU"}]}}',
          )
        : new Response(
            JSON.stringify(fx.advertiser_info_paris).replace(
              '"7000000000000000001"',
              "7000000000000000001",
            ),
          ),
    );
    expect(await live(fetch).listAdvertisers({ accessToken: "tok" })).toEqual([
      {
        advertiserId: "7000000000000000001",
        name: "EU",
        currency: "EUR",
        timezone: "Europe/Paris",
      },
    ]);
  });
});

describe("tiktok ads live: sandbox and transport", () => {
  it("resource calls go to the sandbox host unless TIKTOK_SANDBOX=false", async () => {
    for (const [sandbox, base] of [
      ["true", ADS_SANDBOX_BASE],
      [undefined, ADS_SANDBOX_BASE],
      ["false", ADS_PROD_BASE],
    ] as const) {
      const fetch = vi.fn(async () => new Response(JSON.stringify(fx.video_upload)));
      await createLiveTikTokAdsClient({
        env: { ...env, TIKTOK_SANDBOX: sandbox },
        fetch,
        rateLimiter: noopRateLimiter,
      }).uploadVideoByUrl(creds, { videoUrl: "https://cdn.shopify.com/v.mp4", fileName: "v.mp4" });
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(`${base}/file/video/ad/upload/`);
    }
  });

  it("quotes int64 ids before JSON.parse", () => {
    const text =
      '{"campaign_id":1812345678901234567,"ad_ids":[1812345678901234701, 1812345678901234702],"spend":12345678901234567}';
    expect(JSON.parse(quoteBigIds(text))).toEqual({
      campaign_id: "1812345678901234567",
      ad_ids: ["1812345678901234701", "1812345678901234702"],
      spend: 12345678901234567,
    });
  });

  it("request ids are deterministic int64 strings", () => {
    const a = requestIdFor("campaign", "1", "x");
    expect(a).toBe(requestIdFor("campaign", "1", "x"));
    expect(a).not.toBe(requestIdFor("campaign", "1", "y"));
    expect(/^\d+$/.test(a) && BigInt(a) < BigInt(2) ** BigInt(63)).toBe(true);
  });

  it("retries rate limits always, ambiguous errors only when idempotent", async () => {
    const sleep = vi.fn(async () => {});
    const rate = new IntegrationError("t", "rate_limited", "r");
    const upstream = new IntegrationError("t", "provider_error", "p");
    const bad = new IntegrationError("t", "invalid_input", "i");

    let n = 0;
    await expect(
      withRetry({ attempts: 3, idempotent: false, sleep }, async () => {
        if (n++ === 0) throw rate;
        return "ok";
      }),
    ).resolves.toBe("ok");

    const once = vi.fn(async () => {
      throw upstream;
    });
    await expect(withRetry({ attempts: 3, idempotent: false, sleep }, once)).rejects.toBe(upstream);
    expect(once).toHaveBeenCalledTimes(1);

    const thrice = vi.fn(async () => {
      throw upstream;
    });
    await expect(withRetry({ attempts: 3, idempotent: true, sleep }, thrice)).rejects.toBe(
      upstream,
    );
    expect(thrice).toHaveBeenCalledTimes(3);

    const never = vi.fn(async () => {
      throw bad;
    });
    await expect(withRetry({ attempts: 3, idempotent: true, sleep }, never)).rejects.toBe(bad);
    expect(never).toHaveBeenCalledTimes(1);
  });

  it("takes an ads.api token per advertiser on every call", async () => {
    const take = vi.fn(async () => {});
    const limiter: RateLimiter = { take, withLock: async (_k, _t, fn) => fn() };
    const { fetch } = fixtureFetch({ "POST file/video/ad/upload/": fx.video_upload });
    await live(fetch, { rateLimiter: limiter }).uploadVideoByUrl(creds, {
      videoUrl: "https://cdn.shopify.com/v.mp4",
      fileName: "v.mp4",
    });
    expect(take).toHaveBeenCalledWith("ads.api", `adv:${creds.advertiserId}`);
  });
});

describe("tiktok ads live: uploadVideoByUrl", () => {
  const input = {
    videoUrl: "https://cdn.shopify.com/s/files/v.mp4",
    fileName: "trendcart-video-1.mp4",
  };

  it("posts UPLOAD_BY_URL and returns the video id", async () => {
    const { fetch, calls } = fixtureFetch({ "POST file/video/ad/upload/": fx.video_upload });
    expect(await live(fetch).uploadVideoByUrl(creds, input)).toEqual({
      videoId: "v10033g50000ctestvideo0001",
    });
    expect(calls[0]!.body).toEqual({
      advertiser_id: creds.advertiserId,
      upload_type: "UPLOAD_BY_URL",
      video_url: input.videoUrl,
      file_name: input.fileName,
    });
  });

  it("retries a rate limit but never an ambiguous failure (would duplicate the upload)", async () => {
    const ok = fixtureFetch({ "POST file/video/ad/upload/": [fx.rate_limited, fx.video_upload] });
    await expect(live(ok.fetch).uploadVideoByUrl(creds, input)).resolves.toBeTruthy();
    expect(ok.calls).toHaveLength(2);

    const ko = fixtureFetch({ "POST file/video/ad/upload/": [fx.system_error, fx.video_upload] });
    await expect(live(ko.fetch).uploadVideoByUrl(creds, input)).rejects.toMatchObject({
      code: "provider_error",
    });
    expect(ko.calls).toHaveLength(1);
  });
});

describe("tiktok ads live: createPausedCampaign", () => {
  it("creates identity, campaign, ad group and ads, and returns every id", async () => {
    const { fetch, calls } = fixtureFetch(freshRoutes());
    const ids = await live(fetch).createPausedCampaign(creds, spec);
    expect(ids).toEqual(createdIds);

    const body = (path: string, i = 0) =>
      calls.filter((c) => c.path === path)[i]!.body as Record<string, unknown>;
    expect(body("identity/create/")).toEqual({
      advertiser_id: creds.advertiserId,
      display_name: "Brand",
    });
    expect(body("tt_video/authorize/")).toEqual({
      advertiser_id: creds.advertiserId,
      auth_code: "spark-code",
    });
    expect(body("campaign/create/")).toMatchObject({
      campaign_name: "Test campaign",
      objective_type: "WEB_CONVERSIONS",
      budget_mode: "BUDGET_MODE_INFINITE",
      budget_optimize_on: false,
      request_id: requestIdFor("campaign", creds.advertiserId, "Test campaign"),
    });
    expect(body("adgroup/create/")).toMatchObject({
      campaign_id: createdIds.campaignId,
      adgroup_name: "FR broad",
      location_ids: ["3017382"],
      placements: ["PLACEMENT_TIKTOK"],
      budget_mode: "BUDGET_MODE_DAY",
      budget: 50,
      schedule_type: "SCHEDULE_FROM_NOW",
      schedule_start_time: "2026-11-04 10:00:00",
      optimization_goal: "CONVERT",
      billing_event: "OCPM",
      pixel_id: "PIXEL1",
      optimization_event: "SHOPPING",
      bid_type: "BID_TYPE_NO_BID",
      gender: "GENDER_UNLIMITED",
    });
    expect((body("ad/create/", 0).creatives as unknown[])[0]).toMatchObject({
      ad_name: "Ad 1",
      identity_type: "CUSTOMIZED_USER",
      identity_id: "7300000000000000888",
      video_id: "v10033g50000ctestvideo0001",
      image_ids: ["ad-site-i18n-sg/20261104cover0001"],
      landing_page_url: spec.landingPageUrl,
      call_to_action: "SHOP_NOW",
    });
    // Spark: the creator's post (int64 id kept exact), no uploaded video.
    const spark = (body("ad/create/", 1).creatives as Record<string, unknown>[])[0]!;
    expect(spark).toMatchObject({
      identity_type: "AUTH_CODE",
      identity_id: "creator-identity-1",
      tiktok_item_id: "7431234567890123456",
    });
    expect(spark).not.toHaveProperty("video_id");
  });

  it("is idempotent: a re-run finds everything by name and creates nothing", async () => {
    const { fetch, calls } = fixtureFetch({
      ...freshRoutes(),
      "GET identity/get/": fx.identity_get_brand,
      "GET campaign/get/": fx.campaign_get_created,
    });
    expect(await live(fetch).createPausedCampaign(creds, spec)).toEqual(createdIds);
    expect(calls.filter((c) => c.path.endsWith("/create/"))).toEqual([]);
  });

  it("resumes a half-created campaign: only the missing ad is created", async () => {
    const oneAd = structuredClone(fx.ad_get_created);
    oneAd.data.list = [oneAd.data.list[0]!];
    const { fetch, calls } = fixtureFetch({
      ...freshRoutes(),
      "GET campaign/get/": fx.campaign_get_created,
      "GET ad/get/": [oneAd, fx.ad_get_created],
      "POST ad/create/": fx.ad_create_2,
    });
    expect(await live(fetch).createPausedCampaign(creds, spec)).toEqual(createdIds);
    expect(
      calls
        .filter((c) => c.path.endsWith("/create/") && c.path !== "identity/create/")
        .map((c) => c.path),
    ).toEqual(["ad/create/"]);
  });

  it("refuses to reuse a same-name campaign that is already enabled", async () => {
    const enabled = structuredClone(fx.campaign_get_created);
    enabled.data.list[0]!.operation_status = "ENABLE";
    const { fetch, calls } = fixtureFetch({ ...freshRoutes(), "GET campaign/get/": enabled });
    await expect(live(fetch).createPausedCampaign(creds, spec)).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(calls.some((c) => c.path === "campaign/create/")).toBe(false);
  });

  it("an already-authorized Spark code still resolves through tt_video/info", async () => {
    const { fetch } = fixtureFetch({
      ...freshRoutes(),
      "POST tt_video/authorize/": fx.tt_video_authorize_already,
    });
    await expect(live(fetch).createPausedCampaign(creds, spec)).resolves.toEqual(createdIds);
  });

  it("keeps int64 ids sent as JSON numbers exact (campaign id, Spark item id)", async () => {
    const asNumbers = (o: unknown) =>
      JSON.stringify(o).replace(/"(campaign_id|item_id)":"(\d{16,})"/g, '"$1":$2');
    const { fetch, calls } = fixtureFetch({
      ...freshRoutes(),
      "GET tt_video/info/": asNumbers(fx.tt_video_info),
      "POST campaign/create/": asNumbers(fx.campaign_create),
      "GET campaign/get/": [fx.campaign_get_empty, asNumbers(fx.campaign_get_created)],
    });
    expect(await live(fetch).createPausedCampaign(creds, spec)).toEqual(createdIds);
    const ads = calls.filter((c) => c.path === "ad/create/");
    expect(
      (ads[1]!.body as { creatives: { tiktok_item_id: string }[] }).creatives[0]!.tiktok_item_id,
    ).toBe("7431234567890123456");
    await expect(live(fetch).createPausedCampaign(creds, spec)).resolves.toEqual(createdIds);
  });

  it("a video still processing fails retryably", async () => {
    const { fetch } = fixtureFetch({
      ...freshRoutes(),
      "GET file/video/ad/info/": fx.video_info_processing,
    });
    await expect(live(fetch).createPausedCampaign(creds, spec)).rejects.toMatchObject({
      code: "provider_error",
      retryable: true,
    });
  });

  it("validates the spec before any request", async () => {
    const { fetch } = fixtureFetch({});
    const client = live(fetch);
    const bad: CampaignSpec[] = [
      { ...spec, optimizationEvent: undefined },
      { ...spec, landingPageUrl: "http://shop.example.com/x" },
      { ...spec, adGroups: [{ ...spec.adGroups[0], bidStrategy: "cost_cap" }] },
      { ...spec, adGroups: [{ ...spec.adGroups[0], ageGroups: ["18-24"] }] },
      { ...spec, adGroups: [spec.adGroups[0], spec.adGroups[0]] },
    ];
    for (const s of bad) {
      await expect(client.createPausedCampaign(creds, s)).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps campaign budget (CBO), total budget and cost cap", () => {
    const s = validateSpecForTikTok({
      ...spec,
      objective: "TRAFFIC",
      pixelId: undefined,
      optimizationEvent: undefined,
      budget: { mode: "total", amount: 300, level: "campaign" },
      adGroups: [
        { ...spec.adGroups[0], bidStrategy: "cost_cap", bidAmount: 0.4, gender: "female" },
      ],
    });
    expect(campaignCreateBody("a", s)).toMatchObject({
      budget_optimize_on: true,
      budget_mode: "BUDGET_MODE_TOTAL",
      budget: 300,
    });
    const g = adGroupCreateBody("a", "c", s, s.adGroups[0], fixedNow());
    expect(g).toMatchObject({
      optimization_goal: "CLICK",
      billing_event: "CPC",
      bid_type: "BID_TYPE_CUSTOM",
      bid_price: 0.4,
      gender: "GENDER_FEMALE",
      schedule_type: "SCHEDULE_START_END",
      schedule_end_time: "2026-11-11 10:00:00",
    });
    expect(g).not.toHaveProperty("budget");
    expect(g).not.toHaveProperty("pixel_id");
  });
});

describe("tiktok ads live: launch and pause", () => {
  it("launch is blocked under test without the stub opt-in, before any request", async () => {
    const { fetch } = fixtureFetch(createdRoutes());
    await expect(live(fetch).launchCampaign(creds, createdIds)).rejects.toBeInstanceOf(
      UnsafeActionError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the opt-in is ignored with the global fetch", async () => {
    const client = createLiveTikTokAdsClient({
      env,
      rateLimiter: noopRateLimiter,
      allowStubbedSideEffectsUnderTest: true,
    });
    await expect(client.launchCampaign(creds, createdIds)).rejects.toBeInstanceOf(
      UnsafeActionError,
    );
  });

  it("a test env cannot be hidden by passing a fixture env", () => {
    expect(isTestEnvironment({})).toBe(true);
  });

  it("enables ads, then ad groups, then the campaign (stubbed transport)", async () => {
    const { fetch, calls } = fixtureFetch(createdRoutes());
    await live(fetch, { allowStubbedSideEffectsUnderTest: true }).launchCampaign(creds, createdIds);
    const updates = calls.filter((c) => c.path.endsWith("status/update/"));
    expect(
      updates.map((c) => [c.path, (c.body as { operation_status: string }).operation_status]),
    ).toEqual([
      ["ad/status/update/", "ENABLE"],
      ["adgroup/status/update/", "ENABLE"],
      ["campaign/status/update/", "ENABLE"],
    ]);
    expect(updates[0]!.body).toMatchObject({ ad_ids: createdIds.adGroups[0]!.adIds });
  });

  it("launch refuses ids that are not part of the campaign", async () => {
    const { fetch, calls } = fixtureFetch(createdRoutes());
    const foreign = { ...createdIds, adGroups: [{ adGroupId: "1", adIds: ["2"] }] };
    await expect(
      live(fetch, { allowStubbedSideEffectsUnderTest: true }).launchCampaign(creds, foreign),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(calls.some((c) => c.path.endsWith("status/update/"))).toBe(false);
  });

  it("pause disables the campaign first, then ad groups and ads", async () => {
    const { fetch, calls } = fixtureFetch(createdRoutes());
    await live(fetch).pauseCampaign(creds, createdIds);
    expect(
      calls.map((c) => [c.path, (c.body as { operation_status: string }).operation_status]),
    ).toEqual([
      ["campaign/status/update/", "DISABLE"],
      ["adgroup/status/update/", "DISABLE"],
      ["ad/status/update/", "DISABLE"],
    ]);
  });
});

describe("tiktok ads live: updateBudget", () => {
  const usdInfo = {
    code: 0,
    message: "OK",
    data: {
      list: [{ advertiser_id: creds.advertiserId, currency: "USD", timezone: "America/New_York" }],
    },
  };
  const withModes = (campaignMode: string, groupMode: string) => ({
    "GET advertiser/info/": usdInfo,
    "GET campaign/get/": {
      code: 0,
      data: {
        list: [{ campaign_id: createdIds.campaignId, budget_mode: campaignMode }],
        page_info: { page: 1, total_page: 1 },
      },
    },
    "GET adgroup/get/": {
      code: 0,
      data: {
        list: [{ adgroup_id: createdIds.adGroups[0]!.adGroupId, budget_mode: groupMode }],
        page_info: { page: 1, total_page: 1 },
      },
    },
    "POST adgroup/update/": { code: 0, message: "OK", data: {} },
    "POST campaign/update/": { code: 0, message: "OK", data: {} },
  });
  const posts = (calls: { method: string; path: string }[]) =>
    calls.filter((c) => c.method === "POST").map((c) => c.path);

  it("sets the ad group budget with adgroup/update and never sends a status", async () => {
    const { fetch, calls } = fixtureFetch(withModes("BUDGET_MODE_INFINITE", "BUDGET_MODE_DAY"));
    await live(fetch).updateBudget!(creds, {
      ids: createdIds,
      budget: { mode: "daily", amount: 75.5, level: "ad_group" },
    });
    expect(posts(calls)).toEqual(["adgroup/update/"]);
    const body = calls.find((c) => c.path === "adgroup/update/")!.body;
    expect(body).toEqual({
      advertiser_id: creds.advertiserId,
      adgroup_id: createdIds.adGroups[0]!.adGroupId,
      budget: 75.5,
    });
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("operation_status");
  });

  it("sets a CBO budget with campaign/update", async () => {
    const { fetch, calls } = fixtureFetch(withModes("BUDGET_MODE_DAY", "BUDGET_MODE_DAY"));
    await live(fetch).updateBudget!(creds, {
      ids: createdIds,
      budget: { mode: "daily", amount: 120, level: "campaign" },
    });
    expect(posts(calls)).toEqual(["campaign/update/"]);
    expect(calls.find((c) => c.path === "campaign/update/")!.body).toEqual({
      advertiser_id: creds.advertiserId,
      campaign_id: createdIds.campaignId,
      budget: 120,
    });
  });

  it("refuses, before any write, a value below the minimum, a mode or level change", async () => {
    const cases = [
      // Under the USD ad group daily minimum.
      [
        withModes("BUDGET_MODE_INFINITE", "BUDGET_MODE_DAY"),
        { mode: "daily", amount: BUDGET_FLOORS.USD!.adGroupDaily - 0.01, level: "ad_group" },
      ],
      // Under the USD campaign minimum.
      [
        withModes("BUDGET_MODE_DAY", "BUDGET_MODE_DAY"),
        { mode: "daily", amount: BUDGET_FLOORS.USD!.campaign - 1, level: "campaign" },
      ],
      // Daily → total cannot be switched.
      [
        withModes("BUDGET_MODE_INFINITE", "BUDGET_MODE_DAY"),
        { mode: "total", amount: 1000, level: "ad_group" },
      ],
      // Campaign-level budget on a campaign whose budget lives on its ad groups.
      [
        withModes("BUDGET_MODE_INFINITE", "BUDGET_MODE_DAY"),
        { mode: "daily", amount: 100, level: "campaign" },
      ],
      // Ad group budget on a CBO campaign.
      [
        withModes("BUDGET_MODE_DAY", "BUDGET_MODE_DAY"),
        { mode: "daily", amount: 100, level: "ad_group" },
      ],
    ] as const;
    for (const [routes, budget] of cases) {
      const { fetch, calls } = fixtureFetch(routes);
      await expect(
        live(fetch).updateBudget!(creds, { ids: createdIds, budget }),
      ).rejects.toMatchObject({ code: "invalid_input", retryable: false });
      expect(posts(calls)).toEqual([]);
    }
  });

  it("refuses ids that are not part of the campaign", async () => {
    const { fetch, calls } = fixtureFetch(withModes("BUDGET_MODE_INFINITE", "BUDGET_MODE_DAY"));
    await expect(
      live(fetch).updateBudget!(creds, {
        ids: { campaignId: createdIds.campaignId, adGroups: [{ adGroupId: "123", adIds: [] }] },
        budget: { mode: "daily", amount: 60, level: "ad_group" },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(posts(calls)).toEqual([]);
  });
});

describe("tiktok ads live: getHourlyStats", () => {
  const input = {
    campaignId: "1812345678901234567",
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-01T03:00:00.000Z",
  };

  it("queries the advertiser-local day, paginates, converts to UTC and fills empty hours", async () => {
    const { fetch, calls } = fixtureFetch({
      "GET advertiser/info/": fx.advertiser_info_paris,
      "GET report/integrated/get/": [fx.report_page_1, fx.report_page_2],
    });
    const stats = await live(fetch).getHourlyStats(creds, input);
    for (const s of stats) hourlyStatSchema.parse(s);
    // Paris is UTC+2 in October: local 02:00 → 00:00Z, local 04:00 → 02:00Z.
    expect(stats).toEqual([
      {
        hour: "2026-10-01T00:00:00.000Z",
        spend: 1.5,
        impressions: 300,
        clicks: 6,
        conversions: 1,
        revenue: 29.9,
      },
      {
        hour: "2026-10-01T01:00:00.000Z",
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
      },
      // No purchase value: falls back to spend × ROAS.
      {
        hour: "2026-10-01T02:00:00.000Z",
        spend: 2,
        impressions: 500,
        clicks: 10,
        conversions: 2,
        revenue: 20,
      },
    ]);
    const reports = calls.filter((c) => c.path === "report/integrated/get/");
    expect(reports.map((c) => c.query.page)).toEqual(["1", "2"]);
    expect(reports[0]!.query).toMatchObject({
      advertiser_id: creds.advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      start_date: "2026-10-01",
      end_date: "2026-10-01",
    });
    expect(JSON.parse(reports[0]!.query.dimensions!)).toEqual(["campaign_id", "stat_time_hour"]);
    expect(JSON.parse(reports[0]!.query.filtering!)).toEqual([
      { field_name: "campaign_ids", filter_type: "IN", filter_value: '["1812345678901234567"]' },
    ]);
  });

  it("stays inside its time budget per campaign (S4)", async () => {
    let t = Date.parse("2026-11-04T10:00:00.000Z");
    // Every request takes 12 s of wall clock.
    const { fetch, calls } = fixtureFetch({
      "GET advertiser/info/": () => {
        t += 12_000;
        return fx.advertiser_info_paris;
      },
      "GET report/integrated/get/": () => {
        t += 12_000;
        return fx.report_page_2;
      },
    });
    const client = live(fetch, { now: () => new Date(t) });
    const err = await client
      .getHourlyStats(creds, {
        campaignId: input.campaignId,
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-03T23:00:00.000Z",
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeBudgetError);
    expect((err as TimeBudgetError).retryable).toBe(true);
    // No request started after the budget ran out.
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(STATS_CALL_BUDGET_MS / 12_000));
  });

  it("refuses a window longer than STATS_MAX_WINDOW_HOURS before any request", async () => {
    const { fetch, calls } = fixtureFetch({});
    await expect(
      live(fetch).getHourlyStats(creds, {
        campaignId: input.campaignId,
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-05T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls).toEqual([]);
  });

  it("splits a window crossing local midnight into one query per local day", () => {
    expect(
      localDatesFor(
        "Europe/Paris",
        Date.parse("2026-09-30T21:00:00Z"),
        Date.parse("2026-09-30T23:00:00Z"),
      ),
    ).toEqual(["2026-09-30", "2026-10-01"]);
    expect(new Date(localToUtc("Europe/Paris", "2026-10-25 01:00:00")).toISOString()).toBe(
      "2026-10-24T23:00:00.000Z",
    );
    expect(new Date(localToUtc("America/New_York", "2026-03-08 12:00:00")).toISOString()).toBe(
      "2026-03-08T16:00:00.000Z",
    );
  });

  it("rejects an inverted window like the mock", async () => {
    const { fetch } = fixtureFetch({});
    await expect(
      live(fetch).getHourlyStats(creds, { ...input, to: "2026-09-30T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("safety: tests can never launch a real campaign", () => {
  it("live launchCampaign is blocked under test before any request, even with a production env", async () => {
    const fetch = vi.fn();
    const client = createLiveTikTokAdsClient({
      env: { TIKTOK_APP_ID: "a", TIKTOK_APP_SECRET: "b", TIKTOK_SANDBOX: "false" },
      fetch,
      rateLimiter: noopRateLimiter,
    });
    await expect(
      client.launchCampaign(creds, { campaignId: "1", adGroups: [] }),
    ).rejects.toBeInstanceOf(UnsafeActionError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the test runner runs in mock mode", () => {
    expect(process.env.INTEGRATIONS_MODE ?? "mock").toBe("mock");
  });
});
