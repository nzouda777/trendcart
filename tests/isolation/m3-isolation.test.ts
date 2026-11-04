/**
 * M3 tenant isolation: two workspaces owned by two different people, each
 * with its own Shopify store (different Shopify accounts), TikTok Ads
 * accounts and TikTok profile. A has a launched campaign with stats and a
 * TikTok post; B has a product at GATE 3 (one video on its store) and a
 * launched campaign of its own.
 *
 * B calls every M3 service with A's ids (and smuggles A's ids into its own
 * valid requests). Every call is refused before any adapter call, and A is
 * unchanged. The scoped DB, the internal credential loaders and the
 * cross-workspace stats cron (system context per workspace) hold too.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  approval,
  auditLog,
  campaign,
  campaignStatsHourly,
  job,
  product,
  tiktokAdConnection,
  tiktokPost,
  tiktokProfileConnection,
  video,
} from "@/lib/db/schema";
import {
  addVideo,
  approveVideo,
  approveVideos,
  getProductPipeline,
  launchCampaign,
  pauseCampaign,
  publishToProfile,
  refreshTikTokPosts,
  rejectVideo,
  resumeCampaign,
  updateCampaignBudget,
  type ServiceDeps,
} from "@/lib/services";
import {
  getTikTokAdsCredentials,
  getTikTokProfileTokens,
} from "@/lib/services/internal/credentials";
import { syncAllCampaignStats, syncCampaignStats } from "@/lib/services/internal/campaign-stats";
import { listLaunchedCampaigns } from "@/lib/tenant/system";

import { recordShopify, type ShopifyCall } from "../helpers/m2";
import {
  connectTikTok,
  recordTikTok,
  toGate3PageApproved,
  toLaunched,
  usableVideos,
  type AdsCall,
  type PostingCall,
} from "../helpers/m3";
import {
  connectShopifyMock,
  createTwoTenantWorld,
  mockDeps,
  type Tenant,
  type TwoTenantWorld,
} from "../helpers/world";

let w: TwoTenantWorld;
let deps: ServiceDeps;
let shopifyCalls: ShopifyCall[];
let adsCalls: AdsCall[];
let postingCalls: PostingCall[];

const ids = {
  aProduct: "",
  aVideo: "",
  aCampaign: "",
  aAds: "",
  aProfile: "",
  aPost: "",
  aStat: "",
  bProduct3: "",
  bVideo: "",
  bProduct4: "",
  bCampaign: "",
  bAds: "",
  bProfile: "",
};

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { code?: string; status?: number; message?: string },
  );

async function snapshotA() {
  const db = w.a.owner.db;
  const [products, videos, campaigns, stats, posts, approvals, audits, jobs, ads, profiles] =
    await Promise.all([
      db.select(product),
      db.select(video),
      db.select(campaign),
      db.select(campaignStatsHourly),
      db.select(tiktokPost),
      db.select(approval),
      db.select(auditLog),
      db.select(job),
      db.select(tiktokAdConnection),
      db.select(tiktokProfileConnection),
    ]);
  // updatedAt of the product moves on a refused lock in some paths: compare business fields.
  return JSON.stringify({
    products: products.map((p) => ({ ...p, updatedAt: undefined })),
    videos,
    campaigns,
    stats,
    posts,
    approvals,
    audits,
    jobs,
    ads,
    profiles,
  });
}

async function setupTenant(t: Tenant, shop: string, appMode: "public" | "custom") {
  await connectShopifyMock(t.owner, w.shopify, {
    appMode,
    brandId: t.brandId,
    shop,
    ...(appMode === "custom"
      ? { clientId: `cid-${shop.slice(0, 6)}`, clientSecret: `csecret-${shop.slice(0, 6)}` }
      : {}),
  } as Parameters<typeof connectShopifyMock>[2]);
  return connectTikTok(t, deps.integrations!);
}

beforeAll(async () => {
  w = await createTwoTenantWorld();
  const shop = recordShopify(w.integrations);
  shopifyCalls = shop.calls;
  const tt = recordTikTok(shop.integrations);
  adsCalls = tt.adsCalls;
  postingCalls = tt.postingCalls;
  deps = mockDeps(tt.integrations);

  const a = await setupTenant(w.a, "alpha-m3.myshopify.com", "public");
  const b = await setupTenant(w.b, "bravo-m3.myshopify.com", "custom");
  ids.aAds = a.ads[0]!.id;
  ids.aProfile = a.profile.id;
  ids.bAds = b.ads[0]!.id;
  ids.bProfile = b.profile.id;

  // The same TikTok video in both workspaces: the candidate URLs collide.
  const link = "https://www.tiktok.com/@demo.shop/video/7351234567890140001";
  const launchedA = await toLaunched(w.a, link, deps, ids.aAds);
  ids.aProduct = launchedA.id;
  ids.aCampaign = launchedA.campaign!.id;
  ids.aVideo = launchedA.videosChoice!.videoIds[0]!;
  await w.a.owner.db.update(
    campaign,
    { launchedAt: new Date(Date.now() - 3 * 3_600_000) },
    eq(campaign.id, ids.aCampaign),
  );
  await syncAllCampaignStats({
    scan: async () => [{ workspaceId: w.a.workspaceId, campaignId: ids.aCampaign }],
    ads: deps.integrations!.tiktokAds,
    context: (ws) => w.system(ws),
  });
  ids.aStat = (await w.a.owner.db.select(campaignStatsHourly))[0]!.id;
  await publishToProfile(
    w.a.creative,
    { videoId: ids.aVideo, profileConnectionId: ids.aProfile },
    deps,
  );
  ids.aPost = (await w.a.owner.db.select(tiktokPost))[0]!.id;

  const b3 = await toGate3PageApproved(w.b, link, deps);
  ids.bProduct3 = b3.id;
  ids.bVideo = usableVideos(b3)[0]!.id;
  await approveVideo(w.b.creative, { productId: b3.id, videoId: ids.bVideo }, deps);
  const b4 = await toLaunched(
    w.b,
    "https://www.tiktok.com/@demo.shop/video/7351234567890140002",
    deps,
    ids.bAds,
  );
  ids.bProduct4 = b4.id;
  ids.bCampaign = b4.campaign!.id;
}, 300_000);
afterAll(async () => w.close());

describe("M3 isolation: services", () => {
  it("every M3 service on A's ids is a 404 for B, with no adapter call, and A is unchanged", async () => {
    const before = await snapshotA();
    const calls = () => [shopifyCalls.length, adsCalls.length, postingCalls.length];
    const callsBefore = calls();
    const b = w.b;
    const attempts: [string, () => Promise<unknown>][] = [
      ["getProductPipeline", () => getProductPipeline(b.viewer, ids.aProduct)],
      [
        "approveVideo",
        () => approveVideo(b.owner, { productId: ids.aProduct, videoId: ids.aVideo }, deps),
      ],
      [
        "rejectVideo",
        () => rejectVideo(b.owner, { productId: ids.aProduct, videoId: ids.aVideo }, deps),
      ],
      [
        "approveVideos",
        () => approveVideos(b.owner, { productId: ids.aProduct, adConnectionId: ids.aAds }, deps),
      ],
      [
        "addVideo",
        () =>
          addVideo(
            b.owner,
            { productId: ids.aProduct, url: "https://www.tiktok.com/@x/video/7351234567890149999" },
            deps,
          ),
      ],
      [
        "publishToProfile (A video, B profile)",
        () =>
          publishToProfile(
            b.owner,
            { videoId: ids.aVideo, profileConnectionId: ids.bProfile },
            deps,
          ),
      ],
      ["refreshTikTokPosts", () => refreshTikTokPosts(b.owner, { productId: ids.aProduct }, deps)],
      ["launchCampaign", () => launchCampaign(b.owner, { productId: ids.aProduct }, deps)],
      ["pauseCampaign", () => pauseCampaign(b.mediaBuyer, { productId: ids.aProduct }, deps)],
      ["resumeCampaign", () => resumeCampaign(b.owner, { productId: ids.aProduct }, deps)],
      [
        "updateCampaignBudget",
        () => updateCampaignBudget(b.owner, { productId: ids.aProduct, amount: 999 }, deps),
      ],
    ];
    for (const [name, run] of attempts) {
      const error = await failure(run());
      expect(error, name).toBeInstanceOf(NotFoundError);
      expect(error?.status, name).toBe(404);
    }
    // Roles without the permission are refused before any lookup (no oracle either way).
    expect(
      await failure(launchCampaign(b.creative, { productId: ids.aProduct }, deps)),
    ).toBeInstanceOf(ForbiddenError);
    expect(
      await failure(launchCampaign(b.creative, { productId: crypto.randomUUID() }, deps)),
    ).toBeInstanceOf(ForbiddenError);
    expect(calls()).toEqual(callsBefore);
    expect(await snapshotA()).toBe(before);
  });

  it("A's ids smuggled into B's own valid requests are refused like unknown ids", async () => {
    const before = await snapshotA();
    const callsBefore = [shopifyCalls.length, adsCalls.length, postingCalls.length];
    const b = w.b;
    const random = crypto.randomUUID();
    const same = async (
      name: string,
      foreign: () => Promise<unknown>,
      unknown: () => Promise<unknown>,
    ) => {
      const x = await failure(foreign());
      const y = await failure(unknown());
      expect(x, name).not.toBeNull();
      expect({ code: x?.code, message: x?.message }, name).toEqual({
        code: y?.code,
        message: y?.message,
      });
    };
    await same(
      "approveVideo with A's video on B's product",
      () => approveVideo(b.owner, { productId: ids.bProduct3, videoId: ids.aVideo }, deps),
      () => approveVideo(b.owner, { productId: ids.bProduct3, videoId: random }, deps),
    );
    await same(
      "rejectVideo with A's video on B's product",
      () => rejectVideo(b.owner, { productId: ids.bProduct3, videoId: ids.aVideo }, deps),
      () => rejectVideo(b.owner, { productId: ids.bProduct3, videoId: random }, deps),
    );
    await same(
      "approveVideos with A's ad account",
      () => approveVideos(b.owner, { productId: ids.bProduct3, adConnectionId: ids.aAds }, deps),
      () => approveVideos(b.owner, { productId: ids.bProduct3, adConnectionId: random }, deps),
    );
    await same(
      "publishToProfile with A's profile",
      () =>
        publishToProfile(b.owner, { videoId: ids.bVideo, profileConnectionId: ids.aProfile }, deps),
      () => publishToProfile(b.owner, { videoId: ids.bVideo, profileConnectionId: random }, deps),
    );
    expect([shopifyCalls.length, adsCalls.length, postingCalls.length]).toEqual(callsBefore);
    expect(await snapshotA()).toBe(before);
    // B's own product stays at GATE 3 with its video part open.
    const p = await getProductPipeline(b.viewer, ids.bProduct3);
    expect(p.status).toBe("awaiting_content_approval");
    expect(p.videosChoice).toBeNull();
  });

  it("B's pipeline DTO shows only B's accounts, profiles, videos, campaign and stats", async () => {
    const p = await getProductPipeline(w.b.viewer, ids.bProduct4);
    const dump = JSON.stringify(p);
    for (const id of [ids.aProduct, ids.aVideo, ids.aCampaign, ids.aAds, ids.aProfile, ids.aPost]) {
      expect(dump).not.toContain(id);
    }
    expect(p.campaign!.id).toBe(ids.bCampaign);
    expect(p.campaign!.stats).toHaveLength(0);
  });
});

describe("M3 isolation: scoped DB and internals", () => {
  it("B cannot read, update or attach rows to A's videos, campaigns, stats and posts", async () => {
    const db = w.b.owner.db;
    await expect(db.getById(video, ids.aVideo)).rejects.toBeInstanceOf(NotFoundError);
    await expect(db.getById(campaign, ids.aCampaign)).rejects.toBeInstanceOf(NotFoundError);
    await expect(db.getById(campaignStatsHourly, ids.aStat)).rejects.toBeInstanceOf(NotFoundError);
    await expect(db.getById(tiktokPost, ids.aPost)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.update(campaign, { status: "paused" }, eq(campaign.id, ids.aCampaign))).toEqual(
      [],
    );
    expect(await db.update(video, { approval: "rejected" }, eq(video.id, ids.aVideo))).toEqual([]);
    expect(await db.delete(tiktokPost, eq(tiktokPost.id, ids.aPost))).toEqual([]);
    // Composite tenant FKs: B cannot hang its rows on A's parents.
    expect(
      await failure(
        db.insert(campaignStatsHourly, {
          campaignId: ids.aCampaign,
          hour: new Date("2026-11-01T00:00:00Z"),
          spend: 1,
          impressions: 1,
          clicks: 0,
          conversions: 0,
          revenue: 0,
        }),
      ),
    ).not.toBeNull();
    expect(
      await failure(
        db.insert(tiktokPost, {
          videoId: ids.aVideo,
          profileConnectionId: ids.bProfile,
          status: "pending",
        }),
      ),
    ).not.toBeNull();
    expect(
      await failure(
        db.insert(campaign, {
          productId: ids.bProduct3,
          adConnectionId: ids.aAds,
          config: {} as never,
          status: "draft",
        }),
      ),
    ).not.toBeNull();
    expect((await w.a.owner.db.getById(campaign, ids.aCampaign)).status).toBe("active");
  });

  it("credential loaders with B's system context cannot decrypt A's TikTok tokens", async () => {
    const sys = w.system(w.b.workspaceId);
    await expect(getTikTokAdsCredentials(sys, ids.aAds)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTikTokProfileTokens(sys, ids.aProfile)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("M3 isolation: hourly stats cron", () => {
  it("the cross-workspace scan returns ids only, and each sync runs in its own workspace", async () => {
    const refs = await listLaunchedCampaigns({ limit: 100 }, w.db);
    expect(refs).toEqual(
      expect.arrayContaining([
        { workspaceId: w.a.workspaceId, campaignId: ids.aCampaign },
        { workspaceId: w.b.workspaceId, campaignId: ids.bCampaign },
      ]),
    );
    for (const r of refs) expect(Object.keys(r).sort()).toEqual(["campaignId", "workspaceId"]);

    await w.b.owner.db.update(
      campaign,
      { launchedAt: new Date(Date.now() - 2 * 3_600_000) },
      eq(campaign.id, ids.bCampaign),
    );
    const aStats = await w.a.owner.db.count(campaignStatsHourly);
    const summary = await syncAllCampaignStats({
      scan: (input) => listLaunchedCampaigns(input, w.db),
      ads: deps.integrations!.tiktokAds,
      context: (ws) => w.system(ws),
    });
    expect(summary.failed).toBe(0);
    const bRows = await w.b.owner.db.select(campaignStatsHourly);
    expect(bRows.length).toBeGreaterThan(0);
    expect(new Set(bRows.map((r) => r.campaignId))).toEqual(new Set([ids.bCampaign]));
    const aRows = await w.a.owner.db.select(campaignStatsHourly);
    expect(new Set(aRows.map((r) => r.campaignId))).toEqual(new Set([ids.aCampaign]));
    expect(aRows.length).toBeGreaterThanOrEqual(aStats);
  });

  it("a forged ref (B's workspace, A's campaign) syncs nothing and calls nobody", async () => {
    const before = await snapshotA();
    const statsCalls = adsCalls.filter((c) => c.method === "getHourlyStats").length;
    expect(
      await syncCampaignStats(
        w.system(w.b.workspaceId),
        deps.integrations!.tiktokAds,
        ids.aCampaign,
        new Date(),
      ),
    ).toBe(0);
    const summary = await syncAllCampaignStats({
      scan: async () => [{ workspaceId: w.b.workspaceId, campaignId: ids.aCampaign }],
      ads: deps.integrations!.tiktokAds,
      context: (ws) => w.system(ws),
    });
    expect(summary).toMatchObject({ scanned: 1, synced: 0, skipped: 1, failed: 0 });
    expect(adsCalls.filter((c) => c.method === "getHourlyStats").length).toBe(statsCalls);
    expect(await snapshotA()).toBe(before);
  });
});
