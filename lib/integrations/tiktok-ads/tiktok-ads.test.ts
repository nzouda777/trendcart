import { describe, expect, it, vi } from "vitest";

import {
  campaignIdsSchema,
  hourlyStatSchema,
  IntegrationError,
  tiktokAdvertiserSchema,
  type CampaignSpec,
} from "@/lib/domain/contracts";

import { createTikTokAdsClient } from "./index";
import { createLiveTikTokAdsClient } from "./live";
import { createMockTikTokAdsClient, MOCK_ADS_AUTH_CODE } from "./mock";
import { noopRateLimiter } from "./rate-limit";
import { NotImplementedIntegrationError, UnsafeActionError } from "./safety";

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
  optimizationEvent: "COMPLETE_PAYMENT",
  landingPageUrl: "https://shop.example.com/products/x",
  adGroups: [
    {
      name: "FR broad",
      countries: ["FR"],
      bidStrategy: "lowest_cost",
      ads: [
        {
          name: "Ad 1",
          videoId: "v1",
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
    ).rejects.toMatchObject({ code: "not_found" });
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
  });
});

describe("tiktok ads live (stubbed fetch, no network)", () => {
  const env = { TIKTOK_APP_ID: "app123", TIKTOK_APP_SECRET: "secret", TIKTOK_SANDBOX: "true" };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

  it("builds the advertiser authorization url", () => {
    const client = createLiveTikTokAdsClient({ env, fetch: vi.fn(), rateLimiter: noopRateLimiter });
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
    const client = createLiveTikTokAdsClient({ env, fetch, rateLimiter: noopRateLimiter });
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
    const client = createLiveTikTokAdsClient({ env, fetch, rateLimiter: noopRateLimiter });
    await expect(client.listAdvertisers({ accessToken: "x" })).rejects.toMatchObject({
      code: "auth_expired",
    });
  });

  it("lists advertisers even when advertiser/info fails", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2/advertiser/get")
        ? json({ code: 0, data: { list: [{ advertiser_id: 42, advertiser_name: "Acme" }] } })
        : json({ code: 40001, message: "no permission" }),
    );
    const client = createLiveTikTokAdsClient({ env, fetch, rateLimiter: noopRateLimiter });
    expect(await client.listAdvertisers({ accessToken: "tok" })).toEqual([
      { advertiserId: "42", name: "Acme" },
    ]);
  });

  it("M3 methods throw a typed not-implemented error", async () => {
    const client = createLiveTikTokAdsClient({ env, fetch: vi.fn(), rateLimiter: noopRateLimiter });
    await expect(client.createPausedCampaign(creds, spec)).rejects.toBeInstanceOf(
      NotImplementedIntegrationError,
    );
  });
});

describe("safety: tests can never launch a real campaign", () => {
  it("live launchCampaign is blocked under test before any request", async () => {
    const fetch = vi.fn();
    const client = createLiveTikTokAdsClient({
      env: { ...process.env, TIKTOK_APP_ID: "a", TIKTOK_APP_SECRET: "b", TIKTOK_SANDBOX: "false" },
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
