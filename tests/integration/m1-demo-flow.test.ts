/**
 * M1 demo, end to end in INTEGRATIONS_MODE=mock on PGlite (no DATABASE_URL,
 * no network): create a workspace, connect a dev store and a sandbox ad
 * account, paste a TikTok link, see the AI analysis, pass GATE 1.
 *
 * Also checks the M1 guarantees around it: secrets encrypted, no provider
 * media URL persisted, every sensitive action audited, nothing published,
 * launched or spent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import {
  approval,
  auditLog,
  campaign,
  campaignStatsHourly,
  job,
  shopifyProduct,
  tiktokPost,
  video,
} from "@/lib/db/schema";
import { businessTables } from "@/lib/db/schema";
import {
  confirmProduct,
  getProduct,
  importFromTikTok,
  listConnections,
  listProducts,
} from "@/lib/services";
import type { ScopedTable } from "@/lib/tenant/scoped-db";

import {
  connectShopifyMock,
  connectTikTokAdsMock,
  createTwoTenantWorld,
  mockDeps,
  type TwoTenantWorld,
} from "../helpers/world";

const TIKTOK_LINK =
  "https://www.tiktok.com/@demo.shop/video/7351234567890123456?is_from_webapp=1&sender_device=pc";

let w: TwoTenantWorld;

beforeAll(async () => {
  w = await createTwoTenantWorld();
}, 240_000);
afterAll(async () => w.close());

describe("M1 demo (mock mode)", () => {
  let productId = "";
  let mediaUrl = "";

  it("connects a dev store and a sandbox ad account; health is green; DTOs carry no secrets", async () => {
    const { a, integrations } = w;
    const shop = await connectShopifyMock(a.owner, w.shopify, {
      appMode: "public",
      brandId: a.brandId,
      shop: "trendcart-demo",
    });
    expect(shop.result.created).toBe(true);
    const ads = await connectTikTokAdsMock(a.owner, integrations, a.brandId);
    expect(ads.connections.length).toBeGreaterThan(0);

    // Viewers can see the connections screen data.
    const conns = await listConnections(a.viewer, a.brandId);
    expect(conns.shopify).toHaveLength(1);
    expect(conns.shopify[0]).toMatchObject({ status: "active", health: "green" });
    expect(conns.tiktokAds.every((c) => c.health === "green")).toBe(true);
    const dto = JSON.stringify(conns);
    expect(dto).not.toMatch(/shpat_|shprt_|mock-ads-token|tc1\.|accessToken|Enc"/);
  });

  it("imports a TikTok link and stops at GATE 1 with the AI analysis", async () => {
    const { a, integrations } = w;
    mediaUrl = (
      await integrations.tiktokData.resolveVideo({ workspaceId: a.workspaceId }, TIKTOK_LINK)
    ).mediaUrl;

    const { product, created } = await importFromTikTok(
      a.creative,
      { url: TIKTOK_LINK, brandId: a.brandId },
      mockDeps(integrations),
    );
    productId = product.id;
    expect(created).toBe(true);
    expect(product.status).toBe("awaiting_product_confirmation");
    expect(product.gate).toBe("product_confirmation");
    expect(product.analysis?.productName).toBeTruthy();
    expect(product.analysis?.keywords.length).toBeGreaterThan(0);
    // Tracking query is dropped from the stored source URL.
    expect(product.sourceUrl).not.toContain("is_from_webapp");
    expect(product.videos).toHaveLength(1);
    expect(product.videos[0]).toMatchObject({ origin: "imported", approval: "pending" });

    const list = await listProducts(a.viewer);
    expect(list.items.map((p) => p.id)).toContain(productId);
  });

  it("never persists the provider media URL or any media file anywhere", async () => {
    expect(mediaUrl).toMatch(/^https?:\/\//);
    const rows = await w.a.owner.db.select(video);
    for (const row of rows) {
      expect(row.metadata ?? {}).not.toHaveProperty("mediaUrl");
      expect(row.shopifyMediaId).toBeNull();
      expect(row.shopifyFileUrl).toBeNull();
    }
    // Full dump of every business table of the workspace.
    for (const table of Object.values(businessTables) as ScopedTable[]) {
      const dump = JSON.stringify(await w.a.owner.db.select(table));
      expect(dump).not.toContain(mediaUrl);
      expect(dump).not.toMatch(/"mediaUrl"/);
    }
  });

  it("GATE 1 needs the right role, is recorded in `approval`, audited, and runs sourcing", async () => {
    const { a, integrations } = w;
    const deps = mockDeps(integrations);
    await expect(confirmProduct(a.viewer, { productId }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      confirmProduct(w.system(a.workspaceId), { productId }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await a.owner.db.count(approval)).toBe(0);

    const after = await confirmProduct(a.creative, { productId, note: "Right product" }, deps);
    // M2: the inline mock pipeline runs the source step right after GATE 1.
    expect(after.status).toBe("awaiting_supplier_choice");
    const approvals = await a.owner.db.select(approval);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      productId,
      gate: "product_confirmation",
      decision: "approved",
      userId: a.creative.actor.userId,
    });

    const jobs = await a.owner.db.select(job);
    expect(jobs.find((j) => j.step === "source")?.status).toBe("succeeded");

    // Approving twice is refused (gate already passed).
    await expect(confirmProduct(a.mediaBuyer, { productId }, deps)).rejects.toThrow();
    expect((await getProduct(a.viewer, productId)).status).toBe("awaiting_supplier_choice");
  });

  it("audits every connection change and the approval; secrets never reach audit metadata", async () => {
    const audits = await w.a.owner.db.select(auditLog);
    const actions = audits.map((x) => x.action);
    expect(actions).toContain("brand.create");
    expect(actions.filter((x) => x === "connection.create").length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain("gate.approve");
    const dump = JSON.stringify(audits.map((x) => x.metadata));
    expect(dump).not.toMatch(/shpat_|shprt_|mock-ads-token|tc1\./);
  });

  it("nothing was published, launched or spent in M1", async () => {
    const db = w.a.owner.db;
    expect(await db.count(campaign)).toBe(0);
    expect(await db.count(campaignStatsHourly)).toBe(0);
    expect(await db.count(shopifyProduct)).toBe(0);
    expect(await db.count(tiktokPost)).toBe(0);
  });
});
