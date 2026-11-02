/**
 * M2 demo ("link to Shopify page"), end to end in INTEGRATIONS_MODE=mock on
 * PGlite with the inline engine: TikTok link → GATE 1 → supplier listings →
 * GATE 2 (supplier, store, prices, margin) → page copy + Shopify draft →
 * GATE 3 page (edit, reject, regenerate, approve = publish).
 *
 * Also checks the M2 guarantees around it: role checks and approval rows on
 * every gate decision, audit entries (gate.approve / gate.reject /
 * page.update / page.publish) without secrets or copy text, the draft stays
 * DRAFT until a human approves, one Shopify product per Trendcart product,
 * no media file or provider media URL persisted, nothing launched or spent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { findUnsafeClaims } from "@/lib/ai";
import {
  approval,
  auditLog,
  businessTables,
  campaign,
  campaignStatsHourly,
  job,
  product,
  shopifyProduct,
  supplierMatch,
  tiktokPost,
  video,
} from "@/lib/db/schema";
import { pageCopySchema } from "@/lib/domain/contracts";
import {
  approvePage,
  getProductPipeline,
  listSuppliers,
  quoteSupplierChoice,
  regeneratePageCopy,
  rejectPage,
  rejectSuppliers,
  selectSupplier,
  updatePageCopy,
  type ServiceDeps,
} from "@/lib/services";
import type { ScopedTable } from "@/lib/tenant/scoped-db";

import {
  ANY_COPY_VERSION,
  copyVersionOf,
  recordShopify,
  toGate2,
  type ShopifyCall,
} from "../helpers/m2";
import {
  connectShopifyMock,
  createTwoTenantWorld,
  mockDeps,
  type TwoTenantWorld,
} from "../helpers/world";

const TIKTOK_LINK = "https://www.tiktok.com/@demo.shop/video/7351234567890120002?is_from_webapp=1";
const TIKTOK_LINK_2 = "https://www.tiktok.com/@demo.shop/video/7351234567890120003";
const SHOP = "trendcart-m2-demo.myshopify.com";

let w: TwoTenantWorld;
let deps: ServiceDeps;
let shopifyCalls: ShopifyCall[];
let connectionId = "";
let productId = "";
const mediaUrls: string[] = [];

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { code?: string },
  );

const audits = async () => w.a.owner.db.select(auditLog);
const approvals = async () => w.a.owner.db.select(approval);

beforeAll(async () => {
  w = await createTwoTenantWorld();
  const rec = recordShopify(w.integrations);
  shopifyCalls = rec.calls;
  deps = mockDeps(rec.integrations);
  const shop = await connectShopifyMock(w.a.owner, w.shopify, {
    appMode: "public",
    brandId: w.a.brandId,
    shop: SHOP,
  });
  connectionId = shop.result.connectionId;
  for (const link of [TIKTOK_LINK, TIKTOK_LINK_2]) {
    mediaUrls.push(
      (await w.integrations.tiktokData.resolveVideo({ workspaceId: w.a.workspaceId }, link))
        .mediaUrl,
    );
  }
}, 240_000);
afterAll(async () => w.close());

describe("M2 demo (mock mode)", () => {
  it("TikTok link → GATE 1 → supplier listings at GATE 2 (nothing selected, nothing on Shopify)", async () => {
    const at2 = await toGate2(w.a, TIKTOK_LINK, deps);
    productId = at2.id;
    expect(at2.status).toBe("awaiting_supplier_choice");
    expect(at2.gate).toBe("supplier_choice");
    expect(at2.suppliers.length).toBeGreaterThan(0);
    expect(at2.suppliers.every((s) => !s.selected && s.price > 0)).toBe(true);
    for (const s of at2.suppliers) expect(new URL(s.url).protocol).toBe("https:");
    expect(at2.supplierChoice).toBeNull();
    expect(at2.shopify).toBeNull();
    expect(at2.pageCopy).toBeNull();
    expect(at2.shopifyStores).toEqual([
      expect.objectContaining({ id: connectionId, shopDomain: SHOP, status: "active" }),
    ]);
    // Viewers read suppliers, ranked best first.
    const list = await listSuppliers(w.a.viewer, productId);
    expect(list.map((s) => s.matchScore)).toEqual(
      [...list.map((s) => s.matchScore)].sort((x, y) => y - x),
    );
    expect(await w.a.owner.db.count(shopifyProduct)).toBe(0);
    expect(shopifyCalls.filter((c) => c.method === "createDraftProduct")).toHaveLength(0);
    const source = (await w.a.owner.db.select(job)).find((j) => j.step === "source");
    expect(source?.status).toBe("succeeded");
  });

  it("GATE 2 quote is a preview: viewers may read it, nothing is recorded", async () => {
    const [best] = await listSuppliers(w.a.viewer, productId);
    const before = (await approvals()).length;
    const quote = await quoteSupplierChoice(w.a.viewer, {
      productId,
      supplierMatchId: best!.id,
    });
    expect(quote.supplierMatchId).toBe(best!.id);
    expect(quote.sellingPrice).toBeGreaterThan(0);
    expect(quote.margin.landedCost).toBeGreaterThan(0);
    expect(quote.margin.sellingPrice).toBe(quote.sellingPrice);
    expect((await approvals()).length).toBe(before);
    const row = await w.a.owner.db.getById(product, productId);
    expect(row.sellingPrice).toBeNull();
    expect(row.margin).toBeNull();
  });

  it("GATE 2 select: role checks, approval row, listing selected, prices + margin stored, audited", async () => {
    const [best] = await listSuppliers(w.a.viewer, productId);
    const input = { productId, supplierMatchId: best!.id, note: "Best lead time" };
    const before = (await approvals()).length;

    expect(await failure(selectSupplier(w.a.viewer, input, deps))).toBeInstanceOf(ForbiddenError);
    expect(await failure(selectSupplier(w.system(w.a.workspaceId), input, deps))).toBeInstanceOf(
      ForbiddenError,
    );
    const quote = await quoteSupplierChoice(w.a.viewer, input);
    if (!quote.margin.meetsTarget) {
      // Below the brand minimum: refused unless the human accepts it explicitly.
      expect(await failure(selectSupplier(w.a.creative, input, deps))).toMatchObject({
        code: "precondition_failed",
      });
    }
    expect((await approvals()).length).toBe(before);

    const at3 = await selectSupplier(w.a.creative, { ...input, acceptLowMargin: true }, deps);
    // Inline engine: the build step ran (copy + Shopify draft) and stopped at GATE 3.
    expect(at3.status).toBe("awaiting_content_approval");
    expect(at3.gate).toBe("content_approval");

    const recorded = (await approvals()).filter((a) => a.gate === "supplier_choice");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      productId,
      decision: "approved",
      userId: w.a.creative.actor.userId,
      note: "Best lead time",
    });
    expect(recorded[0]!.payload).toMatchObject({
      supplierMatchId: best!.id,
      shopifyConnectionId: connectionId,
      sellingPrice: quote.sellingPrice,
    });

    const rows = await w.a.owner.db.select(supplierMatch);
    expect(rows.filter((r) => r.selected).map((r) => r.id)).toEqual([best!.id]);

    const stored = await w.a.owner.db.getById(product, productId);
    expect(stored.sellingPrice).toBe(quote.sellingPrice);
    expect(stored.compareAtPrice).toBe(quote.compareAtPrice);
    expect(stored.margin).toMatchObject({
      landedCost: quote.margin.landedCost,
      grossMargin: quote.margin.grossMargin,
      marginRate: quote.margin.marginRate,
    });
    expect(at3.supplierChoice).toMatchObject({
      approvalId: recorded[0]!.id,
      supplierMatchId: best!.id,
      shopifyConnectionId: connectionId,
    });

    const entry = (await audits()).find(
      (a) => a.action === "gate.approve" && a.metadata?.gate === "supplier_choice",
    );
    expect(entry).toMatchObject({
      targetType: "product",
      targetId: productId,
      actorUserId: w.a.creative.actor.userId,
    });

    // A second GATE 2 decision is refused (gate already passed).
    expect(await failure(selectSupplier(w.a.mediaBuyer, input, deps))).toMatchObject({
      code: "invalid_state",
    });
    expect(await failure(rejectSuppliers(w.a.mediaBuyer, { productId }, deps))).toMatchObject({
      code: "invalid_state",
    });
  });

  it("build: safe page copy and ONE Shopify draft on the chosen store, still DRAFT", async () => {
    const p = await getProductPipeline(w.a.viewer, productId);
    expect(p.pageCopy).not.toBeNull();
    expect(pageCopySchema.parse(p.pageCopy)).toBeTruthy();
    expect(findUnsafeClaims(p.pageCopy!)).toEqual([]);
    expect(p.contentParts).toEqual({ page: "pending", videos: "pending" });
    expect(p.shopify).toMatchObject({
      connectionId,
      shopDomain: SHOP,
      status: "draft",
      storefrontUrl: null,
    });
    expect(p.shopify!.adminUrl).toMatch(/^https:\/\/admin\.shopify\.com\/store\//);

    const rows = await w.a.owner.db.select(shopifyProduct);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId, connectionId, status: "draft" });
    const drafts = shopifyCalls.filter((c) => c.method === "createDraftProduct");
    expect(drafts.length).toBeGreaterThan(0);
    expect(new Set(drafts.map((c) => c.shopDomain))).toEqual(new Set([SHOP]));
    // Idempotency key = Trendcart product id; prices are the GATE 2 ones.
    const input = drafts.at(-1)!.args[1] as {
      idempotencyKey: string;
      variants: { price: number }[];
    };
    expect(input.idempotencyKey).toBe(productId);
    const stored = await w.a.owner.db.getById(product, productId);
    expect(input.variants.every((v) => v.price === stored.sellingPrice)).toBe(true);
    expect(shopifyCalls.filter((c) => c.method === "publishProduct")).toHaveLength(0);
  });

  it("GATE 3 copy edit: role checked, pushed to the same draft, audited as page.update (field names only)", async () => {
    expect(
      await failure(updatePageCopy(w.a.viewer, { productId, copy: { title: "Nope" } }, deps)),
    ).toBeInstanceOf(ForbiddenError);
    const title = "QA edited title for the demo page";
    const edited = await updatePageCopy(
      w.a.creative,
      { productId, copy: { title, guarantee: "Contact our support team about returns." } },
      deps,
    );
    expect(edited.pageCopy?.title).toBe(title);
    expect(edited.status).toBe("awaiting_content_approval");
    expect(edited.shopify?.status).toBe("draft");
    expect(await w.a.owner.db.count(shopifyProduct)).toBe(1);

    const entry = (await audits()).filter((a) => a.action === "page.update");
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatchObject({ targetId: productId, actorUserId: w.a.creative.actor.userId });
    expect(entry[0]!.metadata).toMatchObject({ fields: ["title", "guarantee"] });
    expect(JSON.stringify(entry[0]!.metadata)).not.toContain(title);
    // An edit is not an approval.
    expect((await approvals()).filter((a) => a.gate === "content_approval")).toHaveLength(0);
  });

  it("GATE 3 reject and regenerate: recorded, audited, new copy on the SAME Shopify draft", async () => {
    const before = await getProductPipeline(w.a.viewer, productId);
    const shopifyId = before.shopify!.shopifyProductId;

    expect(await failure(rejectPage(w.a.viewer, { productId, note: "x" }, deps))).toBeInstanceOf(
      ForbiddenError,
    );
    expect(await failure(regeneratePageCopy(w.a.viewer, { productId }, deps))).toBeInstanceOf(
      ForbiddenError,
    );

    const rejected = await rejectPage(
      w.a.creative,
      { productId, note: "Shorter, focus on the materials" },
      deps,
    );
    expect(rejected.status).toBe("awaiting_content_approval");
    expect(rejected.pageCopy).not.toBeNull();
    expect(rejected.pageCopy!.title).not.toBe(before.pageCopy!.title);
    expect(rejected.contentParts.page).toBe("rejected");
    expect(rejected.shopify).toMatchObject({ shopifyProductId: shopifyId, status: "draft" });

    const regenerated = await regeneratePageCopy(w.a.mediaBuyer, { productId }, deps);
    expect(regenerated.status).toBe("awaiting_content_approval");
    expect(regenerated.shopify).toMatchObject({ shopifyProductId: shopifyId, status: "draft" });
    expect(await w.a.owner.db.count(shopifyProduct)).toBe(1);

    const content = (await approvals()).filter((a) => a.gate === "content_approval");
    expect(content.map((a) => [a.decision, a.payload?.part, a.payload?.kind]).sort()).toEqual(
      [
        ["rejected", "page", "regenerate"],
        ["rejected", "page", "reject"],
      ].sort(),
    );
    const rejects = (await audits()).filter(
      (a) => a.action === "gate.reject" && a.metadata?.gate === "content_approval",
    );
    expect(rejects).toHaveLength(2);
    // The note itself is not copied into the audit trail.
    expect(JSON.stringify(rejects.map((r) => r.metadata))).not.toContain("materials");
    expect(shopifyCalls.filter((c) => c.method === "publishProduct")).toHaveLength(0);
  });

  it("GATE 3 page approval: role checks, approval row, publish (ACTIVE), audits gate.approve + page.publish", async () => {
    const sys = w.system(w.a.workspaceId);
    for (const ctx of [w.a.viewer, sys]) {
      expect(
        await failure(approvePage(ctx, { productId, copyVersion: ANY_COPY_VERSION }, deps)),
      ).toBeInstanceOf(ForbiddenError);
    }
    expect(shopifyCalls.filter((c) => c.method === "publishProduct")).toHaveLength(0);

    const copyVersion = await copyVersionOf(w.a.viewer, productId);
    const approved = await approvePage(
      w.a.creative,
      { productId, note: "Looks right", copyVersion },
      deps,
    );
    expect(approved.contentParts.page).toBe("approved");
    // Videos (M3) are the second GATE 3 part: the product stays at GATE 3.
    expect(approved.contentParts.videos).toBe("pending");
    expect(approved.status).toBe("awaiting_content_approval");
    expect(approved.shopify).toMatchObject({ status: "active", shopDomain: SHOP });
    expect(approved.shopify!.storefrontUrl).toMatch(new RegExp(`^https://${SHOP}/products/`));

    const publishes = shopifyCalls.filter((c) => c.method === "publishProduct");
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.shopDomain).toBe(SHOP);
    expect(publishes[0]!.args[1]).toBe(approved.shopify!.shopifyProductId);

    const [row] = await w.a.owner.db.select(shopifyProduct);
    expect(row).toMatchObject({ status: "active", productId, connectionId });

    const pageApprovals = (await approvals()).filter(
      (a) => a.gate === "content_approval" && a.decision === "approved",
    );
    expect(pageApprovals).toHaveLength(1);
    expect(pageApprovals[0]).toMatchObject({
      userId: w.a.creative.actor.userId,
      note: "Looks right",
    });
    expect(pageApprovals[0]!.payload).toMatchObject({
      part: "page",
      kind: "approve",
      shopifyProductId: row!.shopifyProductId,
      shopifyConnectionId: connectionId,
    });

    const all = await audits();
    expect(
      all.find((a) => a.action === "gate.approve" && a.metadata?.gate === "content_approval"),
    ).toMatchObject({ targetId: productId, actorUserId: w.a.creative.actor.userId });
    expect(all.find((a) => a.action === "page.publish")).toMatchObject({
      targetType: "shopify_product",
      targetId: row!.id,
      actorUserId: w.a.creative.actor.userId,
    });
  });

  it("once approved, the page is closed: re-approve, reject, regenerate and edit are refused", async () => {
    const publishesBefore = shopifyCalls.filter((c) => c.method === "publishProduct").length;
    const approvalsBefore = (await approvals()).length;
    for (const call of [
      () => approvePage(w.a.mediaBuyer, { productId, copyVersion: ANY_COPY_VERSION }, deps),
      () => rejectPage(w.a.mediaBuyer, { productId }, deps),
      () => regeneratePageCopy(w.a.mediaBuyer, { productId }, deps),
      () => updatePageCopy(w.a.mediaBuyer, { productId, copy: { title: "Late edit" } }, deps),
    ]) {
      expect(await failure(call())).toMatchObject({ code: "invalid_state" });
    }
    expect(shopifyCalls.filter((c) => c.method === "publishProduct")).toHaveLength(publishesBefore);
    expect((await approvals()).length).toBe(approvalsBefore);
    expect((await audits()).filter((a) => a.action === "page.publish")).toHaveLength(1);
  });

  it("GATE 2 rejection ('none of these'): role checked, recorded, audited, the search runs again", async () => {
    const at2 = await toGate2(w.a, TIKTOK_LINK_2, deps);
    const id = at2.id;
    const firstIds = at2.suppliers.map((s) => s.id);
    expect(firstIds.length).toBeGreaterThan(0);

    expect(await failure(rejectSuppliers(w.a.viewer, { productId: id }, deps))).toBeInstanceOf(
      ForbiddenError,
    );
    const again = await rejectSuppliers(
      w.a.creative,
      { productId: id, note: "Wrong colour on every listing" },
      deps,
    );
    expect(again.status).toBe("awaiting_supplier_choice");
    expect(again.supplierChoice).toBeNull();
    // The old rows were removed; the new search stored fresh ones.
    expect(again.suppliers.some((s) => firstIds.includes(s.id))).toBe(false);

    const rejected = (await approvals()).filter(
      (a) => a.productId === id && a.gate === "supplier_choice",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ decision: "rejected", userId: w.a.creative.actor.userId });
    expect(
      (await audits()).find(
        (a) =>
          a.action === "gate.reject" && a.targetId === id && a.metadata?.gate === "supplier_choice",
      ),
    ).toBeTruthy();
    const sources = (await w.a.owner.db.select(job)).filter(
      (j) => j.productId === id && j.step === "source",
    );
    expect(sources.filter((j) => j.status === "succeeded").length).toBeGreaterThanOrEqual(2);
    // Nothing was created on Shopify for this product.
    expect(
      (await w.a.owner.db.select(shopifyProduct)).filter((r) => r.productId === id),
    ).toHaveLength(0);
  });

  it("never persists a media file, a Shopify media id or the provider media URL", async () => {
    for (const row of await w.a.owner.db.select(video)) {
      expect(row.metadata ?? {}).not.toHaveProperty("mediaUrl");
      expect(row.shopifyMediaId).toBeNull();
      expect(row.shopifyFileUrl).toBeNull();
      expect(row.sparkCodeEnc).toBeNull();
    }
    for (const table of Object.values(businessTables) as ScopedTable[]) {
      const dump = JSON.stringify(await w.a.owner.db.select(table));
      for (const url of mediaUrls) expect(dump).not.toContain(url);
      expect(dump).not.toMatch(/"mediaUrl"/);
    }
    // No video was uploaded to Shopify in M2.
    expect(shopifyCalls.filter((c) => c.method === "attachVideoFromUrl")).toHaveLength(0);
  });

  it("secrets never reach audit metadata, approval payloads or the pipeline DTO", async () => {
    const dump = JSON.stringify({
      audits: (await audits()).map((a) => a.metadata),
      approvals: (await approvals()).map((a) => a.payload),
      dto: await getProductPipeline(w.a.viewer, productId),
    });
    expect(dump).not.toMatch(/shpat_|shprt_|tc1\.|accessToken|refreshToken|Enc"/);
  });

  it("nothing was launched, posted or spent in M2", async () => {
    const db = w.a.owner.db;
    expect(await db.count(campaign)).toBe(0);
    expect(await db.count(campaignStatsHourly)).toBe(0);
    expect(await db.count(tiktokPost)).toBe(0);
    const steps = new Set((await db.select(job)).map((j) => j.step));
    expect(steps.has("prepare_campaign")).toBe(false);
    expect(steps.has("launch")).toBe(false);
    const statuses = (await db.select(product)).map((p) => p.status);
    expect(statuses).not.toContain("preparing_campaign");
    expect(statuses).not.toContain("ready_to_launch");
    expect(statuses).not.toContain("launched");
  });
});
