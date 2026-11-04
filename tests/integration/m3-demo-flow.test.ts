/**
 * M3 demo ("videos, ads, posting"), end to end in INTEGRATIONS_MODE=mock on
 * PGlite with the inline engine, from GATE 3 to a launched campaign:
 *
 * GATE 3 page approved → video candidates with compliance reports → approve
 * (upload once to the Shopify product) / reject (Shopify media deleted) →
 * videos part on a chosen TikTok Ads account → prepare_campaign (videos
 * uploaded by URL from Shopify, campaign + ad group + ads created DISABLED)
 * → GATE 4 (role-checked, double click) → launched → hourly stats (cron
 * scan, system contexts) → pause / resume / budget → private TikTok post.
 *
 * Also checks the M3 guarantees around it: approval rows and audit entries
 * for every sensitive action, no provider media URL in any table, audit,
 * DTO or log, no secret in DTOs or audits, nothing enabled before GATE 4.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { ForbiddenError } from "@/lib/auth/errors";
import {
  approval,
  auditLog,
  businessTables,
  campaign,
  campaignStatsHourly,
  job,
  tiktokPost,
  video,
} from "@/lib/db/schema";
import {
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
  type ProductPipelineDTO,
  type ServiceDeps,
} from "@/lib/services";
import { syncAllCampaignStats } from "@/lib/services/internal/campaign-stats";
import { listLaunchedCampaigns } from "@/lib/tenant/system";
import type { ScopedTable } from "@/lib/tenant/scoped-db";

import { recordShopify, type ShopifyCall } from "../helpers/m2";
import {
  connectTikTok,
  recordTikTok,
  toGate3PageApproved,
  usableVideos,
  type AdsCall,
  type PostingCall,
} from "../helpers/m3";
import {
  connectShopifyMock,
  createTwoTenantWorld,
  mockDeps,
  type TwoTenantWorld,
} from "../helpers/world";

const TIKTOK_LINK = "https://www.tiktok.com/@demo.shop/video/7351234567890130001";
const SHOP = "trendcart-m3-demo.myshopify.com";
/** Every mock provider media URL carries this marker (lib/integrations/tiktok-data/mock). */
const MEDIA_MARKER = "tc_mock=";

let w: TwoTenantWorld;
let deps: ServiceDeps;
let shopifyCalls: ShopifyCall[];
let adsCalls: AdsCall[];
let postingCalls: PostingCall[];
let statusOf: (id: string) => string | undefined;
/** The USD mock advertiser (the brand is USD; B1 refuses the EUR one). */
const USD_ADVERTISER = "7000000000000000002";
let adAccounts: { id: string; advertiserId: string }[] = [];
let profileId = "";
let productId = "";
let approvedId = "";
const logs: string[] = [];

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { code?: string; status?: number },
  );
const audits = async () => w.a.owner.db.select(auditLog);
const auditActions = async () => (await audits()).map((a) => a.action);
const pipeline = (): Promise<ProductPipelineDTO> => getProductPipeline(w.a.viewer, productId);

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(
        args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "),
      );
    });
  }
  w = await createTwoTenantWorld();
  const shop = recordShopify(w.integrations);
  shopifyCalls = shop.calls;
  const tt = recordTikTok(shop.integrations);
  adsCalls = tt.adsCalls;
  postingCalls = tt.postingCalls;
  statusOf = tt.statusOf;
  deps = mockDeps(tt.integrations);
  await connectShopifyMock(w.a.owner, w.shopify, {
    appMode: "public",
    brandId: w.a.brandId,
    shop: SHOP,
  });
  const tiktok = await connectTikTok(w.a, tt.integrations);
  adAccounts = tiktok.ads;
  profileId = tiktok.profile.id;
}, 240_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await w.close();
});

describe("M3 demo (mock mode)", () => {
  it("GATE 3: page approved, candidates stored with metadata and a compliance report only", async () => {
    const p = await toGate3PageApproved(w.a, TIKTOK_LINK, deps);
    productId = p.id;
    expect(p.status).toBe("awaiting_content_approval");
    expect(p.contentParts).toEqual({ page: "approved", videos: "pending" });
    expect(p.videos.some((v) => v.origin === "imported")).toBe(true);
    expect(p.videos.some((v) => v.origin === "related_search")).toBe(true);
    for (const v of p.videos) {
      expect(v.compliance ?? v.checkError, v.tiktokUrl).toBeTruthy();
      expect(v.approval).toBe("pending");
      expect(v.onShopify).toBe(false);
      expect(JSON.stringify(v)).not.toContain(MEDIA_MARKER);
    }
    expect(usableVideos(p).length).toBeGreaterThanOrEqual(2);
    // Nothing on TikTok Ads yet, no video on Shopify yet.
    expect(adsCalls.filter((c) => /Campaign|upload/.test(c.method))).toHaveLength(0);
    expect(shopifyCalls.filter((c) => c.method === "attachVideoFromUrl")).toHaveLength(0);
    expect(p.adAccounts.map((a) => a.id).sort()).toEqual(adAccounts.map((a) => a.id).sort());
    expect(p.tiktokProfiles).toEqual([expect.objectContaining({ id: profileId })]);
    expect(p.postingAudited).toBe(false);
  });

  it("approve one video: role-checked, uploaded once to the GATE 2 store, audited", async () => {
    const [first] = usableVideos(await pipeline());
    approvedId = first!.id;
    for (const ctx of [w.a.viewer]) {
      expect(
        await failure(approveVideo(ctx, { productId, videoId: approvedId }, deps)),
      ).toBeInstanceOf(ForbiddenError);
    }
    const p = await approveVideo(w.a.creative, { productId, videoId: approvedId }, deps);
    const v = p.videos.find((x) => x.id === approvedId)!;
    expect(v).toMatchObject({ approval: "approved", onShopify: true });
    expect(v.shopifyFileUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    const attach = shopifyCalls.filter((c) => c.method === "attachVideoFromUrl");
    expect(attach).toHaveLength(1);
    expect(attach[0]!.shopDomain).toBe(SHOP);
    const input = attach[0]!.args[1] as { idempotencyKey: string; sourceUrl: string };
    expect(input.idempotencyKey).toBe(approvedId);
    // Fresh provider URL handed to Shopify, never stored.
    expect(input.sourceUrl).toContain(MEDIA_MARKER);
    // Approving again does nothing.
    await approveVideo(w.a.creative, { productId, videoId: approvedId }, deps);
    expect(shopifyCalls.filter((c) => c.method === "attachVideoFromUrl")).toHaveLength(1);
    const entry = (await audits()).find((a) => a.action === "video.approve");
    expect(entry).toMatchObject({ targetId: approvedId });
  });

  it("approve then reject another video: its Shopify media is deleted, audited", async () => {
    const second = usableVideos(await pipeline()).find((v) => v.id !== approvedId)!;
    await approveVideo(w.a.creative, { productId, videoId: second.id }, deps);
    const mediaId = (await w.a.owner.db.getById(video, second.id)).shopifyMediaId;
    expect(mediaId).toBeTruthy();
    const p = await rejectVideo(
      w.a.creative,
      { productId, videoId: second.id, note: "Not our product" },
      deps,
    );
    expect(p.videos.find((v) => v.id === second.id)).toMatchObject({
      approval: "rejected",
      onShopify: false,
      shopifyFileUrl: null,
    });
    const deletes = shopifyCalls.filter((c) => c.method === "deleteProductMedia");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.shopDomain).toBe(SHOP);
    expect(deletes[0]!.args[1]).toMatchObject({ mediaIds: [mediaId] });
    const actions = await auditActions();
    expect(actions).toEqual(expect.arrayContaining(["video.reject", "video.media_delete"]));
    // The rejection note is not copied into the audit.
    expect(JSON.stringify((await audits()).map((a) => a.metadata))).not.toContain(
      "Not our product",
    );
  });

  it("videos part: the ad account must be chosen, then the paused campaign is prepared (GATE 4)", async () => {
    // Two ad accounts on the brand: the choice is explicit.
    expect(await failure(approveVideos(w.a.mediaBuyer, { productId }, deps))).toMatchObject({
      code: "invalid_input",
    });
    expect(
      await failure(
        approveVideos(w.a.mediaBuyer, { productId, adConnectionId: crypto.randomUUID() }, deps),
      ),
    ).toMatchObject({ code: "invalid_input" });
    // B1: the account must bill in the brand currency (USD): the USD mock advertiser.
    const account = adAccounts.find((a) => a.advertiserId === USD_ADVERTISER)!;
    const p = await approveVideos(w.a.mediaBuyer, { productId, adConnectionId: account.id }, deps);
    expect(p.status).toBe("ready_to_launch");
    expect(p.gate).toBe("launch");
    expect(p.videosChoice).toMatchObject({ videoIds: [approvedId], adConnectionId: account.id });
    const row = (await w.a.owner.db.select(approval)).find(
      (a) =>
        a.gate === "content_approval" && (a.payload as { part?: string } | null)?.part === "videos",
    );
    expect(row).toMatchObject({ decision: "approved", userId: w.a.mediaBuyer.actor.userId });

    // Uploaded to TikTok Ads by URL from the Shopify file, once, for this advertiser only.
    const uploads = adsCalls.filter((c) => c.method === "uploadVideoByUrl");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.advertiserId).toBe(account.advertiserId);
    const fileUrl = (await w.a.owner.db.getById(video, approvedId)).shopifyFileUrl;
    expect(uploads[0]!.args[1]).toMatchObject({ videoUrl: fileUrl });
    expect(p.videos.find((v) => v.id === approvedId)!.tiktokVideoIds).toHaveProperty(
      account.advertiserId,
    );

    // Created DISABLED at every level; nothing enabled before GATE 4.
    expect(adsCalls.filter((c) => c.method === "createPausedCampaign")).toHaveLength(1);
    expect(adsCalls.filter((c) => c.method === "launchCampaign")).toHaveLength(0);
    const ids = p.campaign!.tiktokIds!;
    expect(p.campaign).toMatchObject({
      status: "paused",
      launchedAt: null,
      adConnectionId: account.id,
    });
    for (const id of [ids.campaignId, ...ids.adGroups.flatMap((g) => [g.adGroupId, ...g.adIds])]) {
      expect(statusOf(id)).toBe("DISABLE");
    }
    expect(p.campaign!.config.budget).toEqual({ mode: "daily", amount: 30, level: "ad_group" });
    expect(p.campaign!.config.adGroups[0]!.ads).toHaveLength(1);
    expect(p.campaign!.config.landingPageUrl).toMatch(/^https:\/\//);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(["gate.approve", "campaign.create"]),
    );
    // The step is done once: one campaign row.
    expect(await w.a.owner.db.count(campaign)).toBe(1);
    const prep = (await w.a.owner.db.select(job)).find((j) => j.step === "prepare_campaign");
    expect(prep?.status).toBe("succeeded");
  });

  it("GATE 4: viewers and creatives cannot launch; a double click launches once", async () => {
    for (const ctx of [w.a.viewer, w.a.creative]) {
      expect(await failure(launchCampaign(ctx, { productId }, deps))).toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(adsCalls.filter((c) => c.method === "launchCampaign")).toHaveLength(0);
    expect((await pipeline()).status).toBe("ready_to_launch");

    const results = await Promise.allSettled([
      launchCampaign(w.a.mediaBuyer, { productId, note: "go" }, deps),
      launchCampaign(w.a.owner, { productId }, deps),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "invalid_state" });
    expect(adsCalls.filter((c) => c.method === "launchCampaign")).toHaveLength(1);

    const p = await pipeline();
    expect(p.status).toBe("launched");
    expect(p.campaign).toMatchObject({ status: "active" });
    expect(p.campaign!.launchedAt).not.toBeNull();
    const ids = p.campaign!.tiktokIds!;
    expect(statusOf(ids.campaignId)).toBe("ENABLE");
    const launches = (await w.a.owner.db.select(approval)).filter((a) => a.gate === "launch");
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ decision: "approved" });
    const launchAudit = (await audits()).filter((a) => a.action === "campaign.launch");
    expect(launchAudit).toHaveLength(1);
    expect(launchAudit[0]!.metadata).toMatchObject({
      outcome: "launched",
      approvalId: launches[0]!.id,
    });
    const launchJob = (await w.a.owner.db.select(job)).find((j) => j.step === "launch");
    expect(launchJob?.status).toBe("succeeded");
  });

  it("hourly stats: the cron scan finds the campaign, the sync upserts by hour", async () => {
    const [row] = await w.a.owner.db.select(campaign);
    await w.a.owner.db.update(
      campaign,
      { launchedAt: new Date(Date.now() - 5 * 3_600_000) },
      eq(campaign.id, row!.id),
    );
    const refs = await listLaunchedCampaigns({ limit: 100 }, w.db);
    expect(refs).toEqual([{ workspaceId: w.a.workspaceId, campaignId: row!.id }]);
    const sync = () =>
      syncAllCampaignStats({
        scan: (input) => listLaunchedCampaigns(input, w.db),
        ads: deps.integrations!.tiktokAds,
        context: (ws) => w.system(ws),
      });
    const first = await sync();
    expect(first).toMatchObject({ scanned: 1, synced: 1, failed: 0 });
    expect(first.hours).toBeGreaterThanOrEqual(5);
    await sync();
    const rows = await w.a.owner.db.select(campaignStatsHourly);
    expect(rows).toHaveLength(first.hours);
    expect(new Set(rows.map((r) => r.hour.toISOString())).size).toBe(rows.length);
    const p = await pipeline();
    expect(p.campaign!.stats).toHaveLength(rows.length);
    expect(p.campaign!.totals.impressions).toBeGreaterThan(0);
    expect(p.campaign!.statsSyncedAt).not.toBeNull();
    // Every stats call went to the campaign's advertiser.
    const stats = adsCalls.filter((c) => c.method === "getHourlyStats");
    expect(new Set(stats.map((c) => c.advertiserId))).toEqual(new Set([USD_ADVERTISER]));
  });

  it("pause / resume / budget: owner and media buyer only, audited", async () => {
    for (const ctx of [w.a.viewer, w.a.creative]) {
      expect(await failure(pauseCampaign(ctx, { productId }, deps))).toBeInstanceOf(ForbiddenError);
      expect(await failure(resumeCampaign(ctx, { productId }, deps))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(
        await failure(updateCampaignBudget(ctx, { productId, amount: 45 }, deps)),
      ).toBeInstanceOf(ForbiddenError);
    }
    const ids = (await pipeline()).campaign!.tiktokIds!;
    let p = await pauseCampaign(w.a.mediaBuyer, { productId }, deps);
    expect(p.campaign!.status).toBe("paused");
    expect(statusOf(ids.campaignId)).toBe("DISABLE");
    p = await resumeCampaign(w.a.owner, { productId }, deps);
    expect(p.campaign!.status).toBe("active");
    expect(statusOf(ids.campaignId)).toBe("ENABLE");
    const all = await audits();
    expect(all.some((a) => a.action === "campaign.pause")).toBe(true);
    expect(
      all.some(
        (a) =>
          a.action === "campaign.launch" && (a.metadata as { resume?: boolean }).resume === true,
      ),
    ).toBe(true);
    // updateBudget now exists (N9): amount only, capped at 10x the brand default, audited.
    expect(
      await failure(updateCampaignBudget(w.a.mediaBuyer, { productId, amount: 301 }, deps)),
    ).toMatchObject({ code: "invalid_input" });
    await updateCampaignBudget(w.a.mediaBuyer, { productId, amount: 45 }, deps);
    expect((await pipeline()).campaign!.config.budget.amount).toBe(45);
    expect(
      (await audits()).find(
        (a) => a.action === "campaign.budget_change" && a.targetType === "campaign",
      )!.metadata,
    ).toMatchObject({ from: 30, to: 45, currency: "USD" });
    expect(statusOf(ids.campaignId)).toBe("ENABLE");
  });

  it("private TikTok post of the approved video: SELF_ONLY, streamed from Shopify, audited", async () => {
    expect(
      await failure(
        publishToProfile(w.a.viewer, { videoId: approvedId, profileConnectionId: profileId }, deps),
      ),
    ).toBeInstanceOf(ForbiddenError);
    expect(
      await failure(
        publishToProfile(
          w.a.creative,
          {
            videoId: approvedId,
            profileConnectionId: profileId,
            privacyLevel: "PUBLIC_TO_EVERYONE",
          },
          deps,
        ),
      ),
    ).toMatchObject({ code: "invalid_input" });
    let p = await publishToProfile(
      w.a.creative,
      { videoId: approvedId, profileConnectionId: profileId, caption: "New find for the kitchen" },
      deps,
    );
    expect(p.videos.find((v) => v.id === approvedId)!.posts).toEqual([
      expect.objectContaining({ status: "processing", profileConnectionId: profileId }),
    ]);
    const publishes = postingCalls.filter((c) => c.method === "publishVideoFromUrl");
    expect(publishes).toHaveLength(1);
    const sent = publishes[0]!.args[0] as { privacyLevel: string; sourceUrl: string };
    expect(sent.privacyLevel).toBe("SELF_ONLY");
    expect(sent.sourceUrl).toBe((await w.a.owner.db.getById(video, approvedId)).shopifyFileUrl);
    // A second click while processing posts nothing.
    await publishToProfile(
      w.a.creative,
      { videoId: approvedId, profileConnectionId: profileId },
      deps,
    );
    expect(postingCalls.filter((c) => c.method === "publishVideoFromUrl")).toHaveLength(1);
    await refreshTikTokPosts(w.a.creative, { productId }, deps);
    p = await refreshTikTokPosts(w.a.creative, { productId }, deps);
    expect(p.videos.find((v) => v.id === approvedId)!.posts[0]!.status).toBe("published");
    expect(await w.a.owner.db.count(tiktokPost)).toBe(1);
    const entry = (await audits()).find((a) => a.action === "video.publish");
    expect(entry!.metadata).toMatchObject({ privacyLevel: "SELF_ONLY", outcome: "submitted" });
  });

  it("no provider media URL anywhere: tables, audits, approvals, DTO, logs", async () => {
    for (const table of Object.values(businessTables) as ScopedTable[]) {
      const dump = JSON.stringify(await w.a.owner.db.select(table));
      expect(dump).not.toContain(MEDIA_MARKER);
      expect(dump).not.toMatch(/"mediaUrl"|"playUrl"|"downloadUrl"/);
    }
    expect(JSON.stringify(await pipeline())).not.toContain(MEDIA_MARKER);
    expect(logs.join("\n")).not.toContain(MEDIA_MARKER);
    // Only approved videos are on Shopify; rejected ones have no media left.
    const rows = await w.a.owner.db.select(video);
    for (const r of rows) {
      if (r.approval !== "approved") expect(r.shopifyMediaId, r.id).toBeNull();
    }
  });

  it("no secret in DTOs, audit metadata or approval payloads", async () => {
    const dump = JSON.stringify({
      audits: (await audits()).map((a) => a.metadata),
      approvals: (await w.a.owner.db.select(approval)).map((a) => a.payload),
      dto: await pipeline(),
    });
    expect(dump).not.toMatch(
      /shpat_|shprt_|tc1\.|mock-ads-token-|mock-access-|mock-refresh-|accessToken|refreshToken|Enc"/,
    );
  });
});
