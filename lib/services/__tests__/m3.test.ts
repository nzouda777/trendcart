import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";

import { ForbiddenError } from "@/lib/auth/errors";
import { encrypt } from "@/lib/crypto";
import { IntegrationError, type Integrations } from "@/lib/domain/contracts";
import {
  approval,
  auditLog,
  brand,
  campaign,
  campaignStatsHourly,
  product,
  shopifyConnection,
  tiktokAdConnection,
  tiktokPost,
  tiktokProfileConnection,
  usageMonthly,
  video,
} from "@/lib/db/schema";
import { createIntegrations } from "@/lib/integrations";
import { tokenColumns } from "@/lib/integrations/shopify/credentials";
import type { MockTikTokAdsClient } from "@/lib/integrations/tiktok-ads/mock";

import { createBrand } from "../brands";
import { launchCampaign, pauseCampaign, resumeCampaign, updateCampaignBudget } from "../campaigns";
import { connectionAad } from "../connections";
import { syncAllCampaignStats } from "../internal/campaign-stats";
import {
  approvePage,
  getProductPipeline,
  goBackOneStep,
  listSuppliers,
  selectSupplier,
} from "../pipeline";
import { confirmProduct, importFromTikTok, retryStep } from "../products";
import {
  approveVideo,
  approveVideos,
  publishToProfile,
  recheckVideo,
  refreshTikTokPosts,
  rejectVideo,
} from "../videos";

import { newBrandInput, setupTestEnv, testDeps, type TestEnv } from "./helpers";

let env: TestEnv;
let brandId: string;
let urlSeq = 0;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(auditLog);
  await env.db.delete(usageMonthly);
  // Restrict FKs (posts → profiles, campaigns → ad accounts) go first.
  await env.db.delete(tiktokPost);
  await env.db.delete(campaign);
  await env.db.delete(brand);
  brandId = (await createBrand(env.a.owner, { ...newBrandInput(), defaultTestBudget: 30 })).id;
});

const nextTikTokUrl = () =>
  `https://www.tiktok.com/@shop/video/73600000000000${String(++urlSeq).padStart(5, "0")}`;

async function insertStore() {
  const id = crypto.randomUUID();
  const far = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
  return env.a.owner.db.insert(shopifyConnection, {
    id,
    brandId,
    shopDomain: "demo-store.myshopify.com",
    scopes: ["write_products"],
    status: "active",
    templateSuffix: "trendcart",
    ...tokenColumns(id, {
      shopDomain: "demo-store.myshopify.com",
      accessToken: "shpat_mock_test",
      scopes: ["write_products"],
      refreshToken: "shprt_mock_test",
      expiresAt: far,
      refreshTokenExpiresAt: far,
    }),
  });
}

async function insertAdAccount(
  advertiserId = "7000000000000000001",
  currency: string | null = "EUR",
) {
  const id = crypto.randomUUID();
  return env.a.owner.db.insert(tiktokAdConnection, {
    id,
    brandId,
    advertiserId,
    name: "Mock Ads Account EU",
    currency,
    accessTokenEnc: encrypt("mock-ads-token-test", { aad: connectionAad.tiktokAdsAccessToken(id) }),
    status: "active",
  });
}

async function insertProfile() {
  const id = crypto.randomUUID();
  return env.a.owner.db.insert(tiktokProfileConnection, {
    id,
    brandId,
    openId: `open-${id.slice(0, 8)}`,
    displayName: "Mock Creator",
    accessTokenEnc: encrypt("mock-access-test", {
      aad: connectionAad.tiktokProfileAccessToken(id),
    }),
    expiresAt: new Date(Date.now() + 3600_000),
    status: "active",
  });
}

/** Real mock adapters (one instance each), with spies on the video lifecycle calls. */
function mocks(overrides: Partial<Integrations> = {}) {
  const base = createIntegrations("mock");
  const attachVideoFromUrl = vi.fn(base.shopify.attachVideoFromUrl);
  const deleteProductMedia = vi.fn(base.shopify.deleteProductMedia);
  const shopify = Object.assign(Object.create(base.shopify) as object, base.shopify, {
    attachVideoFromUrl,
    deleteProductMedia,
  }) as Integrations["shopify"];
  const searchVideos = vi.fn(base.tiktokData.searchVideos);
  const check = vi.fn(base.complianceChecker.check);
  const integrations: Integrations = {
    ...base,
    shopify,
    tiktokData: { ...base.tiktokData, searchVideos },
    complianceChecker: { check },
    ...overrides,
  };
  return {
    integrations,
    ads: base.tiktokAds as MockTikTokAdsClient,
    attachVideoFromUrl,
    deleteProductMedia,
    searchVideos,
    check,
  };
}

/** Import → GATE 1 → GATE 2 → build (page + videos) → GATE 3, page not approved yet. */
async function atGate3(m = mocks()) {
  await insertStore();
  const deps = testDeps(m.integrations);
  const imported = await importFromTikTok(env.a.creative, { url: nextTikTokUrl(), brandId }, deps);
  const productId = imported.product.id;
  await confirmProduct(env.a.creative, { productId }, deps);
  const suppliers = await listSuppliers(env.a.creative, productId);
  await selectSupplier(
    env.a.creative,
    { productId, supplierMatchId: suppliers[0]!.id, acceptLowMargin: true },
    deps,
  );
  const at3 = await getProductPipeline(env.a.viewer, productId);
  expect(at3.status).toBe("awaiting_content_approval");
  return { productId, deps, copyVersion: at3.pageCopyVersion!, ...m };
}

/** Same, page approved. */
async function atGate3PageApproved(m = mocks()) {
  const at3 = await atGate3(m);
  await approvePage(
    env.a.creative,
    { productId: at3.productId, copyVersion: at3.copyVersion },
    at3.deps,
  );
  return at3;
}

function usable(p: Awaited<ReturnType<typeof getProductPipeline>>) {
  return p.videos.filter((v) => v.compliance && v.compliance.overall !== "fail");
}

describe("M3 build step: related videos and compliance", () => {
  it("stores candidates with metadata only and a compliance report each", async () => {
    const { productId, searchVideos, check } = await atGate3PageApproved();
    const p = await getProductPipeline(env.a.viewer, productId);
    expect(p.contentParts).toEqual({ page: "approved", videos: "pending" });
    expect(searchVideos).toHaveBeenCalled();
    expect(p.videos.some((v) => v.origin === "imported")).toBe(true);
    expect(p.videos.some((v) => v.origin === "related_search")).toBe(true);
    expect(p.videos.length).toBeLessThanOrEqual(1 + 6);
    for (const v of p.videos) {
      expect(v.compliance ?? v.checkError).toBeTruthy();
      expect(JSON.stringify(v.metadata)).not.toMatch(/mediaUrl|playUrl|downloadUrl/);
    }
    // The checker got a fresh media URL that was never stored.
    const mediaUrl = check.mock.calls[0]![1].mediaUrl;
    expect(mediaUrl).toMatch(/^https:/);
    const rows = await env.a.owner.db.select(video, { where: eq(video.productId, productId) });
    expect(JSON.stringify(rows)).not.toContain(mediaUrl!);
  });
});

describe("M3 GATE 3 videos → GATE 4 → launch → stats (mock end to end)", () => {
  it("runs from GATE 3 to a launched campaign with hourly stats and a private post", async () => {
    const adAccount = await insertAdAccount();
    const profile = await insertProfile();
    const m = await atGate3PageApproved();
    const { productId, deps } = m;
    let p = await getProductPipeline(env.a.viewer, productId);
    const [first, second] = usable(p);
    expect(first).toBeDefined();

    // Role checks: viewers cannot approve videos, creatives cannot launch.
    await expect(
      approveVideo(env.a.viewer, { productId, videoId: first!.id }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Approve → uploaded once to the Shopify product.
    p = await approveVideo(env.a.creative, { productId, videoId: first!.id }, deps);
    expect(p.videos.find((v) => v.id === first!.id)).toMatchObject({
      approval: "approved",
      onShopify: true,
    });
    expect(m.attachVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(m.attachVideoFromUrl.mock.calls[0]![1]).toMatchObject({ idempotencyKey: first!.id });
    // Approving again is a no-op.
    await approveVideo(env.a.creative, { productId, videoId: first!.id }, deps);
    expect(m.attachVideoFromUrl).toHaveBeenCalledTimes(1);

    // Approve then reject another one → its Shopify media is deleted.
    if (second) {
      await approveVideo(env.a.creative, { productId, videoId: second.id }, deps);
      p = await rejectVideo(env.a.creative, { productId, videoId: second.id }, deps);
      expect(p.videos.find((v) => v.id === second.id)).toMatchObject({
        approval: "rejected",
        onShopify: false,
        shopifyFileUrl: null,
      });
      expect(m.deleteProductMedia).toHaveBeenCalledTimes(1);
    }

    // Approved videos on Shopify block a step back to GATE 2.
    await expect(goBackOneStep(env.a.owner, { productId }, deps)).rejects.toMatchObject({
      code: "invalid_state",
    });

    // Videos part → preparing_campaign → paused campaign (inline) → GATE 4.
    p = await approveVideos(env.a.media_buyer, { productId }, deps);
    expect(p.status).toBe("ready_to_launch");
    expect(p.gate).toBe("launch");
    expect(p.videosChoice).toMatchObject({ videoIds: [first!.id], adConnectionId: adAccount.id });
    expect(p.campaign).toMatchObject({ status: "paused", launchedAt: null });
    expect(p.campaign!.config.budget).toEqual({ mode: "daily", amount: 30, level: "ad_group" });
    expect(p.campaign!.config.adGroups[0]!.countries).toEqual(["FR"]);
    expect(p.campaign!.config.landingPageUrl).toMatch(/^https:\/\//);
    const ids = p.campaign!.tiktokIds!;
    expect(m.ads.statusOf(ids.campaignId)).toBe("DISABLE");
    expect(p.videos.find((v) => v.id === first!.id)!.tiktokVideoIds).toHaveProperty(
      adAccount.advertiserId,
    );

    // GATE 4: only owner / media buyer.
    await expect(launchCampaign(env.a.creative, { productId }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(m.ads.statusOf(ids.campaignId)).toBe("DISABLE");
    p = await launchCampaign(env.a.media_buyer, { productId }, deps);
    expect(p.status).toBe("launched");
    expect(p.campaign).toMatchObject({ status: "active" });
    expect(p.campaign!.launchedAt).not.toBeNull();
    expect(m.ads.statusOf(ids.campaignId)).toBe("ENABLE");
    expect(p.approvals.some((a) => a.gate === "launch" && a.decision === "approved")).toBe(true);
    const audits = await env.a.owner.db.select(auditLog);
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "video.approve",
        "gate.approve",
        "campaign.create",
        "campaign.launch",
      ]),
    );

    // Hourly stats: launched yesterday, synced twice (upsert by hour).
    const campaignRow = (
      await env.a.owner.db.select(campaign, {
        where: eq(campaign.productId, productId),
      })
    )[0]!;
    await env.a.owner.db.update(
      campaign,
      { launchedAt: new Date(Date.now() - 5 * 3600_000) },
      eq(campaign.id, campaignRow.id),
    );
    const sync = () =>
      syncAllCampaignStats({
        scan: async () => [{ workspaceId: env.wsA, campaignId: campaignRow.id }],
        ads: m.ads,
        context: (ws) => env.system(ws),
      });
    const first1 = await sync();
    expect(first1).toMatchObject({ scanned: 1, synced: 1, failed: 0 });
    await sync();
    const statRows = await env.a.owner.db.select(campaignStatsHourly, {
      where: eq(campaignStatsHourly.campaignId, campaignRow.id),
    });
    expect(statRows.length).toBe(first1.hours);
    p = await getProductPipeline(env.a.viewer, productId);
    expect(p.campaign!.stats.length).toBe(statRows.length);
    expect(p.campaign!.totals.impressions).toBeGreaterThan(0);

    // Pause and resume (audited), viewers refused.
    await expect(pauseCampaign(env.a.viewer, { productId }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    p = await pauseCampaign(env.a.media_buyer, { productId }, deps);
    expect(p.campaign!.status).toBe("paused");
    expect(m.ads.statusOf(ids.campaignId)).toBe("DISABLE");
    p = await resumeCampaign(env.a.owner, { productId }, deps);
    expect(p.campaign!.status).toBe("active");

    // Budget change (N9): capped at 10x the brand default (30), amount only.
    expect(p.campaign).toMatchObject({ budgetUpdatable: true, maxBudget: 300, currency: "EUR" });
    await expect(
      updateCampaignBudget(env.a.media_buyer, { productId, amount: 301 }, deps),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // TikTok refusing the amount changes nothing.
    const refuse = vi.fn(async () => {
      throw new IntegrationError("tiktok_ads", "invalid_input", "below the minimum");
    });
    await expect(
      updateCampaignBudget(
        env.a.media_buyer,
        { productId, amount: 1 },
        testDeps({ ...m.integrations, tiktokAds: { ...m.ads, updateBudget: refuse } }),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    p = await getProductPipeline(env.a.viewer, productId);
    expect(p.campaign!.config.budget.amount).toBe(30);
    const updateBudget = vi.fn(async () => undefined);
    p = await updateCampaignBudget(
      env.a.media_buyer,
      { productId, amount: 50 },
      testDeps({ ...m.integrations, tiktokAds: { ...m.ads, updateBudget } }),
    );
    expect(p.campaign!.config.budget.amount).toBe(50);
    expect(updateBudget).toHaveBeenCalledTimes(1);

    expect(
      (await env.a.owner.db.select(auditLog)).some((a) => a.action === "campaign.budget_change"),
    ).toBe(true);

    // Private post of the approved video, then polled to published.
    p = await publishToProfile(
      env.a.creative,
      { videoId: first!.id, profileConnectionId: profile.id },
      deps,
    );
    const post = p.videos.find((v) => v.id === first!.id)!.posts[0]!;
    expect(post).toMatchObject({ status: "processing", profileName: "Mock Creator" });
    await expect(
      publishToProfile(
        env.a.creative,
        { videoId: first!.id, profileConnectionId: profile.id, privacyLevel: "PUBLIC_TO_EVERYONE" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await refreshTikTokPosts(env.a.creative, { productId }, deps);
    p = await refreshTikTokPosts(env.a.creative, { productId }, deps);
    expect(p.videos.find((v) => v.id === first!.id)!.posts[0]!.status).toBe("published");
    expect(await env.a.owner.db.count(tiktokPost)).toBe(1);
  }, 120_000);

  it("a failed launch pauses again, fails the product, and needs a new GATE 4 approval", async () => {
    await insertAdAccount();
    const base = mocks();
    let failNext = true;
    const ads = base.ads;
    const integrations: Integrations = {
      ...base.integrations,
      tiktokAds: {
        ...ads,
        launchCampaign: async (creds, ids) => {
          if (failNext) {
            failNext = false;
            throw new IntegrationError("tiktok_ads", "provider_error", "upstream 500");
          }
          return ads.launchCampaign(creds, ids);
        },
      },
    };
    const m = await atGate3PageApproved({ ...base, integrations });
    const { productId, deps } = m;
    const p0 = await getProductPipeline(env.a.viewer, productId);
    await approveVideo(env.a.creative, { productId, videoId: usable(p0)[0]!.id }, deps);
    const ready = await approveVideos(env.a.media_buyer, { productId }, deps);
    expect(ready.status).toBe("ready_to_launch");
    const ids = ready.campaign!.tiktokIds!;

    await expect(launchCampaign(env.a.owner, { productId }, deps)).rejects.toThrow("upstream 500");
    let p = await getProductPipeline(env.a.viewer, productId);
    expect(p.status).toBe("failed");
    expect(p.failedStep).toBe("launch");
    expect(p.campaign!.status).toBe("paused");
    expect(ads.statusOf(ids.campaignId)).toBe("DISABLE");

    // Retry returns to GATE 4, nothing is enabled until approved again.
    const retried = await retryStep(env.a.owner, productId, deps);
    expect(retried.status).toBe("ready_to_launch");
    expect(ads.statusOf(ids.campaignId)).toBe("DISABLE");
    p = await launchCampaign(env.a.owner, { productId }, deps);
    expect(p.status).toBe("launched");
    const launches = p.approvals.filter((a) => a.gate === "launch");
    expect(launches).toHaveLength(2);
  }, 120_000);

  it("refuses the videos part without an approved video or an ad account", async () => {
    const m = await atGate3PageApproved();
    const { productId, deps } = m;
    await expect(approveVideos(env.a.media_buyer, { productId }, deps)).rejects.toMatchObject({
      code: "precondition_failed",
    });
    const p = await getProductPipeline(env.a.viewer, productId);
    await approveVideo(env.a.creative, { productId, videoId: usable(p)[0]!.id }, deps);
    await expect(approveVideos(env.a.media_buyer, { productId }, deps)).rejects.toMatchObject({
      code: "precondition_failed",
    });
    const row = await env.a.owner.db.getById(product, productId);
    expect(row.status).toBe("awaiting_content_approval");
    // A failing video cannot be approved.
    const failing = p.videos.find((v) => v.compliance?.overall === "fail");
    if (failing) {
      await expect(
        approveVideo(env.a.creative, { productId, videoId: failing.id }, deps),
      ).rejects.toMatchObject({ code: "invalid_state" });
    }
    expect(
      await env.a.owner.db.count(
        video,
        and(eq(video.productId, productId), eq(video.approval, "approved")),
      ),
    ).toBe(1);
  }, 120_000);
});

describe("M3 QA fixes (B1, S1, S2, N1, N9, N13, S4)", () => {
  it("B1: another currency needs an fxRate (budget converted, minimum checked); unknown is refused", async () => {
    const usd = await insertAdAccount("7000000000000000002", "USD");
    const unknown = await insertAdAccount("7000000000000000003", null);
    const m = await atGate3PageApproved();
    const { productId, deps } = m;
    let p = await getProductPipeline(env.a.viewer, productId);
    expect(p.currency).toBe("EUR");
    const options = new Map(p.adAccounts.map((a) => [a.id, a]));
    expect(options.get(usd.id)).toMatchObject({ currency: "USD", usable: true, needsFxRate: true });
    expect(options.get(unknown.id)).toMatchObject({ currency: null, usable: false });
    expect(options.get(unknown.id)!.unusableReason).toMatch(/Reconnect/);
    await approveVideo(env.a.creative, { productId, videoId: usable(p)[0]!.id }, deps);

    await expect(
      approveVideos(env.a.media_buyer, { productId, adConnectionId: unknown.id }, deps),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    await expect(
      approveVideos(env.a.media_buyer, { productId, adConnectionId: usd.id }, deps),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // 30 EUR x 0.5 = 15 USD, under TikTok's 20 USD ad group daily minimum.
    await expect(
      approveVideos(env.a.media_buyer, { productId, adConnectionId: usd.id, fxRate: 0.5 }, deps),
    ).rejects.toThrow(/30 EUR = 15 USD.*20 USD/);

    p = await approveVideos(
      env.a.media_buyer,
      { productId, adConnectionId: usd.id, fxRate: 1.0837 },
      deps,
    );
    expect(p.status).toBe("ready_to_launch");
    expect(p.campaign).toMatchObject({
      currency: "USD",
      brandCurrency: "EUR",
      fxRate: 1.0837,
      minBudget: 20,
      maxBudget: 325.11,
      spendingUnknown: false,
    });
    expect(p.campaign!.config.budget.amount).toBe(32.51);
    const videosPart = await env.a.owner.db.findFirst(
      approval,
      and(eq(approval.productId, productId), eq(approval.gate, "content_approval")),
      { orderBy: (t) => desc(t.createdAt) },
    );
    expect(videosPart!.payload).toMatchObject({
      part: "videos",
      brandCurrency: "EUR",
      advertiserCurrency: "USD",
      fxRate: 1.0837,
    });

    // Budget changes are in USD, checked against the USD minimum.
    await expect(
      updateCampaignBudget(env.a.media_buyer, { productId, amount: 19 }, deps),
    ).rejects.toMatchObject({ code: "invalid_input" });

    p = await launchCampaign(env.a.owner, { productId }, deps);
    const gate4 = await env.a.owner.db.findFirst(
      approval,
      and(eq(approval.productId, productId), eq(approval.gate, "launch")),
    );
    expect(gate4!.payload).toMatchObject({
      currency: "USD",
      brandCurrency: "EUR",
      amount: 32.51,
      fxRate: 1.0837,
    });
  }, 120_000);

  it("B1: a campaign in the brand currency has no conversion", async () => {
    await insertAdAccount();
    const m = await atGate3PageApproved();
    const { productId, deps } = m;
    const p0 = await getProductPipeline(env.a.viewer, productId);
    await approveVideo(env.a.creative, { productId, videoId: usable(p0)[0]!.id }, deps);
    // A rate is ignored when the currencies match.
    const p = await approveVideos(env.a.media_buyer, { productId, fxRate: 2 }, deps);
    expect(p.campaign).toMatchObject({
      currency: "EUR",
      brandCurrency: "EUR",
      fxRate: null,
      totalsInBrandCurrency: null,
    });
    expect(p.campaign!.config.budget.amount).toBe(30);
  }, 120_000);

  it("S1: a creative cannot choose the ad account, nor complete GATE 3 with the page", async () => {
    await insertAdAccount();
    const m = await atGate3();
    const { productId, deps } = m;
    let p = await getProductPipeline(env.a.creative, productId);
    expect(p.canChooseAdAccount).toBe(false);
    expect((await getProductPipeline(env.a.media_buyer, productId)).canChooseAdAccount).toBe(true);
    await approveVideo(env.a.creative, { productId, videoId: usable(p)[0]!.id }, deps);
    await expect(approveVideos(env.a.creative, { productId }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Videos part first (media buyer); the page by a creative would then complete GATE 3.
    p = await approveVideos(env.a.media_buyer, { productId }, deps);
    expect(p.contentParts.videos).toBe("approved");
    await expect(
      approvePage(env.a.creative, { productId, copyVersion: m.copyVersion }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    p = await getProductPipeline(env.a.viewer, productId);
    expect(p.contentParts.page).toBe("pending");
    expect(p.shopify!.status).toBe("draft");
    p = await approvePage(env.a.owner, { productId, copyVersion: m.copyVersion }, deps);
    expect(p.status).toBe("ready_to_launch");
  }, 120_000);

  it("S2: a failed launch whose re-pause fails says so; pauseCampaign pauses it again", async () => {
    await insertAdAccount();
    const base = mocks();
    const ads = base.ads;
    let failLaunch = true;
    let failPause = true;
    const integrations: Integrations = {
      ...base.integrations,
      tiktokAds: {
        ...ads,
        launchCampaign: async (creds, ids) => {
          if (failLaunch) {
            failLaunch = false;
            throw new IntegrationError("tiktok_ads", "provider_error", "upstream 500");
          }
          return ads.launchCampaign(creds, ids);
        },
        pauseCampaign: async (creds, ids) => {
          if (failPause) {
            failPause = false;
            throw new IntegrationError("tiktok_ads", "provider_error", "pause timed out");
          }
          return ads.pauseCampaign(creds, ids);
        },
      },
    };
    const m = await atGate3PageApproved({ ...base, integrations });
    const { productId, deps } = m;
    const p0 = await getProductPipeline(env.a.viewer, productId);
    await approveVideo(env.a.creative, { productId, videoId: usable(p0)[0]!.id }, deps);
    await approveVideos(env.a.media_buyer, { productId }, deps);

    await expect(launchCampaign(env.a.owner, { productId }, deps)).rejects.toMatchObject({
      code: "invalid_state",
      reason: "launch_failed_not_paused",
    });
    let p = await getProductPipeline(env.a.viewer, productId);
    expect(p.status).toBe("failed");
    expect(p.failedStep).toBe("launch");
    expect(p.campaign).toMatchObject({
      status: "failed",
      spendingUnknown: true,
      budgetUpdatable: false,
    });
    const launchAudit = (await env.a.owner.db.select(auditLog)).find(
      (a) => a.action === "campaign.launch",
    );
    expect(launchAudit!.metadata).toMatchObject({ outcome: "failed", reverted: false });

    p = await pauseCampaign(env.a.media_buyer, { productId }, deps);
    expect(p.campaign).toMatchObject({ status: "paused", spendingUnknown: false });
    const retried = await retryStep(env.a.owner, productId, deps);
    expect(retried.status).toBe("ready_to_launch");
    p = await launchCampaign(env.a.owner, { productId }, deps);
    expect(p.status).toBe("launched");
  }, 120_000);

  it("S2: a failed launch paused again says nothing is spending", async () => {
    await insertAdAccount();
    const base = mocks();
    const integrations: Integrations = {
      ...base.integrations,
      tiktokAds: {
        ...base.ads,
        launchCampaign: async () => {
          throw new IntegrationError("tiktok_ads", "provider_error", "upstream 500");
        },
      },
    };
    const m = await atGate3PageApproved({ ...base, integrations });
    const { productId, deps } = m;
    const p0 = await getProductPipeline(env.a.viewer, productId);
    await approveVideo(env.a.creative, { productId, videoId: usable(p0)[0]!.id }, deps);
    await approveVideos(env.a.media_buyer, { productId }, deps);
    const error = await launchCampaign(env.a.owner, { productId }, deps).catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: "launch_failed_paused" });
    expect((error as Error).message).toMatch(/nothing is spending/);
    const p = await getProductPipeline(env.a.viewer, productId);
    expect(p.campaign).toMatchObject({ status: "paused", spendingUnknown: false });
  }, 120_000);

  it("N1: a concurrent approve of the same video uploads once", async () => {
    const m = await atGate3PageApproved();
    const { productId, deps } = m;
    const p = await getProductPipeline(env.a.viewer, productId);
    const videoId = usable(p)[0]!.id;
    const results = await Promise.allSettled([
      approveVideo(env.a.creative, { productId, videoId }, deps),
      approveVideo(env.a.owner, { productId, videoId }, deps),
    ]);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      reason: "upload_in_progress",
    });
    expect(m.attachVideoFromUrl).toHaveBeenCalledTimes(1);
    // Once done, approving again is a no-op.
    await approveVideo(env.a.creative, { productId, videoId }, deps);
    expect(m.attachVideoFromUrl).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("recheckVideo re-runs one check; an approved video now failing blocks the videos part (N13)", async () => {
    await insertAdAccount();
    const real = createIntegrations("mock").complianceChecker;
    let failNext = false;
    const check: Integrations["complianceChecker"]["check"] = async (...args) => {
      const result = await real.check(...args);
      if (!failNext) return result;
      failNext = false;
      return { ...result, data: { ...result.data, overall: "fail" as const } };
    };
    const spy = vi.fn(check);
    const m = await atGate3PageApproved(mocks({ complianceChecker: { check: spy } }));
    const { productId, deps } = m;
    let p = await getProductPipeline(env.a.viewer, productId);
    const [first, second] = usable(p);
    await approveVideo(env.a.creative, { productId, videoId: first!.id }, deps);
    await expect(
      recheckVideo(env.a.viewer, { productId, videoId: first!.id }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const before = spy.mock.calls.length;
    failNext = true;
    p = await recheckVideo(env.a.creative, { productId, videoId: first!.id }, deps);
    expect(spy.mock.calls.length).toBe(before + 1);
    expect(p.videos.find((v) => v.id === first!.id)).toMatchObject({
      approval: "approved",
      onShopify: true,
      compliance: { overall: "fail" },
      complianceOutdated: false,
    });
    await expect(approveVideos(env.a.media_buyer, { productId }, deps)).rejects.toMatchObject({
      code: "precondition_failed",
    });

    // A rejected video is not checked again.
    if (second) {
      await rejectVideo(env.a.creative, { productId, videoId: second.id }, deps);
      await expect(
        recheckVideo(env.a.creative, { productId, videoId: second.id }, deps),
      ).rejects.toMatchObject({ code: "invalid_state" });
    }
    // Checked again fine: it can run.
    p = await recheckVideo(env.a.creative, { productId, videoId: first!.id }, deps);
    expect(p.videos.find((v) => v.id === first!.id)!.compliance!.overall).not.toBe("fail");
    p = await approveVideos(env.a.media_buyer, { productId }, deps);
    expect(p.status).toBe("ready_to_launch");
  }, 120_000);

  it("S4: the stats run stops starting campaigns near its budget", async () => {
    const refs = [1, 2, 3].map(() => ({
      workspaceId: env.wsA,
      campaignId: crypto.randomUUID(),
    }));
    const ticks = [0, 0, 0, 210_000];
    let i = 0;
    const getHourlyStats = vi.fn(async () => []);
    const summary = await syncAllCampaignStats({
      scan: async () => refs,
      ads: { getHourlyStats } as unknown as Integrations["tiktokAds"],
      context: (ws) => env.system(ws),
      clock: () => ticks[Math.min(i++, ticks.length - 1)]!,
    });
    // Two started (unknown ids: nothing to sync), the third left for next hour.
    expect(summary).toMatchObject({ scanned: 3, skipped: 2, deferred: 1, failed: 0 });
  });
});
