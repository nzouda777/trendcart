import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { encrypt } from "@/lib/crypto";
import { type Integrations } from "@/lib/domain/contracts";
import {
  auditLog,
  brand,
  campaign,
  campaignPreset,
  shopifyConnection,
  tiktokAdConnection,
  tiktokPost,
  usageMonthly,
} from "@/lib/db/schema";
import { createIntegrations } from "@/lib/integrations";
import { tokenColumns } from "@/lib/integrations/shopify/credentials";
import type { MockTikTokAdsClient } from "@/lib/integrations/tiktok-ads/mock";

import { createBrand } from "../brands";
import {
  duplicateCampaign,
  launchDuplicate,
  listCampaignDuplicates,
  pauseDuplicate,
} from "../campaign-duplicates";
import {
  createCampaignPreset,
  deleteCampaignPreset,
  listCampaignPresets,
  setDefaultCampaignPreset,
  updateCampaignPreset,
} from "../campaign-presets";
import { launchCampaign } from "../campaigns";
import { connectionAad } from "../connections";
import { approvePage, getProductPipeline, listSuppliers, selectSupplier } from "../pipeline";
import { confirmProduct, importFromTikTok } from "../products";
import { approveVideo, approveVideos } from "../videos";
import { newBrandInput, setupTestEnv, testDeps, type TestEnv } from "./helpers";

/*
 * M4: saved campaign settings (presets) per brand, the preset chosen at
 * GATE 3, and duplicates of a launched campaign (created paused, launched
 * only by an owner / media buyer). Mock adapters end to end.
 */

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
  await env.db.delete(campaignPreset);
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

async function approvedOne() {
  const m = await atGate3PageApproved();
  const p0 = await getProductPipeline(env.a.viewer, m.productId);
  await approveVideo(
    env.a.creative,
    { productId: m.productId, videoId: usable(p0)[0]!.id },
    m.deps,
  );
  return m;
}

async function launchedProduct(presetId?: string) {
  await insertAdAccount();
  const m = await approvedOne();
  let p = await approveVideos(
    env.a.media_buyer,
    { productId: m.productId, ...(presetId ? { presetId } : {}) },
    m.deps,
  );
  expect(p.status).toBe("ready_to_launch");
  p = await launchCampaign(env.a.owner, { productId: m.productId }, m.deps);
  expect(p.status).toBe("launched");
  return { ...m, p };
}

describe("campaign presets", () => {
  it("are managed by media buyers and owners only, with one default per kind", async () => {
    const input = {
      brandId,
      kind: "new_test" as const,
      name: "Brand new campaign setup 1",
      settings: { budget: { amount: 25 } },
    };
    await expect(createCampaignPreset(env.a.creative, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const first = await createCampaignPreset(env.a.media_buyer, input);
    expect(first.isDefault).toBe(true);
    await expect(createCampaignPreset(env.a.owner, input)).rejects.toMatchObject({
      code: "invalid_input",
    });
    const second = await createCampaignPreset(env.a.owner, {
      ...input,
      name: "Brand new campaign setup 2",
    });
    expect(second.isDefault).toBe(false);
    await setDefaultCampaignPreset(env.a.owner, { presetId: second.id });
    const list = await listCampaignPresets(env.a.viewer, { brandId, kind: "new_test" });
    expect(list.filter((p) => p.isDefault).map((p) => p.id)).toEqual([second.id]);

    const updated = await updateCampaignPreset(env.a.owner, {
      presetId: first.id,
      name: "Setup 1 (renamed)",
      isDefault: false,
      settings: { placements: { searchResults: true } },
    });
    expect(updated.settings.placements.searchResults).toBe(true);
    expect(updated.settings.budget.amount).toBeNull();

    // Another workspace cannot see or touch them.
    await expect(listCampaignPresets(env.bOwner, { brandId })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteCampaignPreset(env.bOwner, { presetId: first.id })).rejects.toMatchObject({
      code: "not_found",
    });
    await deleteCampaignPreset(env.a.owner, { presetId: first.id });
    expect(await listCampaignPresets(env.a.viewer, { brandId })).toHaveLength(1);

    const audits = await env.a.owner.db.select(auditLog);
    expect(audits.filter((a) => a.action === "campaign.preset_change")).toHaveLength(5);
  });

  it("refuses countries TikTok targeting is not set up for", async () => {
    await expect(
      createCampaignPreset(env.a.owner, {
        brandId,
        kind: "new_test",
        name: "Nowhere",
        settings: { targeting: { countries: ["ZZ"] } },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("GATE 3 with a brand new campaign setup", () => {
  it("builds the paused campaign from the chosen preset", async () => {
    const preset = await createCampaignPreset(env.a.owner, {
      brandId,
      kind: "new_test",
      name: "ABO test",
      settings: {
        budget: { amount: 40 },
        structure: { adGroups: "per_video" },
        targeting: { countries: ["FR", "BE"] },
      },
    });
    const { p } = await launchedProduct(preset.id);
    const config = p.campaign!.config;
    expect(config.presetId).toBe(preset.id);
    expect(config.budget).toEqual({ mode: "daily", amount: 40, level: "ad_group" });
    expect(config.adGroups.length).toBe(config.adGroups.flatMap((g) => g.ads).length);
    expect(config.adGroups[0]!.countries).toEqual(["FR", "BE"]);
    expect(config.adGroups[0]!.searchResults).toBe(false);
  });

  it("uses the brand default setup when none is chosen, and refuses a duplicate preset", async () => {
    await createCampaignPreset(env.a.owner, {
      brandId,
      kind: "new_test",
      name: "Default setup",
      settings: { budget: { amount: 35 } },
    });
    const dup = await createCampaignPreset(env.a.owner, {
      brandId,
      kind: "duplicate",
      name: "Not for tests",
      settings: {},
    });
    await insertAdAccount();
    const m = await approvedOne();
    await expect(
      approveVideos(env.a.media_buyer, { productId: m.productId, presetId: dup.id }, m.deps),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const p = await approveVideos(env.a.media_buyer, { productId: m.productId }, m.deps);
    expect(p.campaign!.config.budget.amount).toBe(35);
  });
});

describe("campaign duplicates", () => {
  it("copies a launched campaign paused, launches and pauses it on approval", async () => {
    const { productId, deps, p, ads } = await launchedProduct();
    const source = p.campaign!;
    const preset = await createCampaignPreset(env.a.owner, {
      brandId,
      kind: "duplicate",
      name: "Campaign duplicate settings 1",
      settings: { budget: { amount: 60, level: "campaign" } },
    });

    await expect(
      duplicateCampaign(env.a.creative, { campaignId: source.id }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { campaignId } = await duplicateCampaign(
      env.a.media_buyer,
      { campaignId: source.id, presetId: preset.id },
      deps,
    );
    let [copy] = await listCampaignDuplicates(env.a.viewer, productId);
    expect(copy).toMatchObject({
      id: campaignId,
      sourceCampaignId: source.id,
      status: "paused",
      presetName: "Campaign duplicate settings 1",
      budget: { mode: "daily", amount: 60, level: "campaign" },
      launchedAt: null,
    });
    expect(copy!.name).toMatch(/ · copy 1$/);
    const row = await env.a.owner.db.getById(campaign, campaignId);
    expect(ads.statusOf(row.tiktokIds!.campaignId)).toBe("DISABLE");

    // The GATE 4 campaign is still the product campaign.
    const again = await getProductPipeline(env.a.viewer, productId);
    expect(again.campaign!.id).toBe(source.id);

    // Only owner / media buyer launch; then it spends.
    await expect(launchDuplicate(env.a.creative, { campaignId }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await launchDuplicate(env.a.owner, { campaignId, note: "scale" }, deps);
    [copy] = await listCampaignDuplicates(env.a.viewer, productId);
    expect(copy).toMatchObject({ status: "active" });
    expect(copy!.launchedAt).not.toBeNull();
    expect(ads.statusOf(row.tiktokIds!.campaignId)).toBe("ENABLE");

    await pauseDuplicate(env.a.media_buyer, { campaignId }, deps);
    [copy] = await listCampaignDuplicates(env.a.viewer, productId);
    expect(copy!.status).toBe("paused");
    expect(ads.statusOf(row.tiktokIds!.campaignId)).toBe("DISABLE");

    // Without a choice, the brand default duplicate preset is used (the first one saved).
    await duplicateCampaign(env.a.owner, { campaignId: source.id }, deps);
    let copies = await listCampaignDuplicates(env.a.viewer, productId);
    expect(copies).toHaveLength(2);
    expect(copies[1]!.name).toMatch(/ · copy 2$/);
    expect(copies[1]!.presetName).toBe("Campaign duplicate settings 1");

    // With no duplicate preset at all, the copy keeps the source budget.
    await deleteCampaignPreset(env.a.owner, { presetId: preset.id });
    await duplicateCampaign(env.a.owner, { campaignId: source.id }, deps);
    copies = await listCampaignDuplicates(env.a.viewer, productId);
    expect(copies[2]!.presetName).toBeNull();
    expect(copies[2]!.budget.amount).toBe(source.config.budget.amount);

    const actions = (await env.a.owner.db.select(auditLog)).map((a) => a.action);
    expect(actions.filter((a) => a === "campaign.duplicate")).toHaveLength(3);
  });

  it("refuses a campaign that was never launched and a budget above the cap", async () => {
    await insertAdAccount();
    const m = await approvedOne();
    const p = await approveVideos(env.a.media_buyer, { productId: m.productId }, m.deps);
    await expect(
      duplicateCampaign(env.a.owner, { campaignId: p.campaign!.id }, m.deps),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await launchCampaign(env.a.owner, { productId: m.productId }, m.deps);
    const huge = await createCampaignPreset(env.a.owner, {
      brandId,
      kind: "duplicate",
      name: "Too much",
      settings: { budget: { amount: 5000 } },
    });
    await expect(
      duplicateCampaign(env.a.owner, { campaignId: p.campaign!.id, presetId: huge.id }, m.deps),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await listCampaignDuplicates(env.a.viewer, m.productId)).toHaveLength(0);
  });
});
