import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  IntegrationError,
  type Copywriter,
  type Integrations,
  type PageCopy,
  type SupplierListing,
} from "@/lib/domain/contracts";
import {
  approval,
  auditLog,
  brand,
  product,
  shopifyConnection,
  shopifyProduct,
  supplierMatch,
  usageMonthly,
} from "@/lib/db/schema";
import { createIntegrations } from "@/lib/integrations";
import { tokenColumns } from "@/lib/integrations/shopify/credentials";
import { createMemoryLimiter } from "@/lib/workflows/concurrency";
import { gatePartStates } from "@/lib/workflows/gate-payloads";
import { runProductStep } from "@/lib/workflows/runner";
import { loadCopyHint } from "@/lib/workflows/steps/build";
import { upsertSupplierListing } from "@/lib/workflows/steps/source";

import { createBrand } from "../brands";
import { listShopifyTemplates, setShopifyTemplate } from "../connections";
import {
  approvePage,
  getProductPipeline,
  listSuppliers,
  quoteSupplierChoice,
  regeneratePageCopy,
  rejectPage,
  rejectSuppliers,
  selectSupplier,
  STALE_PUBLISH_CLAIM_MS,
  updatePageCopy,
} from "../pipeline";
import { toServiceFailure } from "../errors";
import { confirmProduct, importFromTikTok, retryStep } from "../products";

import { createMemoryRateLimiter } from "../rate-limit";
import { newBrandInput, setupTestEnv, testDeps, type TestEnv } from "./helpers";

let env: TestEnv;

/** A well-formed copy version, for calls refused before the version is compared. */
const ANY_VERSION = "0000000000000000";
const copyVersionOf = async (productId: string) =>
  (await getProductPipeline(env.a.viewer, productId)).pageCopyVersion!;
let brandId: string;
let urlSeq = 0;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(auditLog);
  await env.db.delete(usageMonthly);
  await env.db.delete(brand);
  brandId = (await createBrand(env.a.owner, newBrandInput())).id;
});

const nextTikTokUrl = () =>
  `https://www.tiktok.com/@shop/video/73500000000000${String(++urlSeq).padStart(5, "0")}`;

async function insertStore(workspaceDb = env.a.owner.db, brand = brandId, shop = "demo-store") {
  const id = crypto.randomUUID();
  const far = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
  return workspaceDb.insert(shopifyConnection, {
    id,
    brandId: brand,
    shopDomain: `${shop}.myshopify.com`,
    scopes: ["write_products"],
    status: "active",
    templateSuffix: "trendcart",
    ...tokenColumns(id, {
      shopDomain: `${shop}.myshopify.com`,
      accessToken: "shpat_mock_test",
      scopes: ["write_products"],
      refreshToken: "shprt_mock_test",
      expiresAt: far,
      refreshTokenExpiresAt: far,
    }),
  });
}

/** Real mock adapters (one instance: the mock store keeps its products), with spies. */
function mockIntegrations(overrides: Partial<Integrations> = {}) {
  const base = createIntegrations("mock");
  const find = vi.fn(base.supplierFinder.find);
  const writePage = vi.fn(base.copywriter.writePage);
  const createDraftProduct = vi.fn(base.shopify.createDraftProduct);
  const publishProduct = vi.fn(base.shopify.publishProduct);
  const shopify = Object.assign(Object.create(base.shopify) as object, base.shopify, {
    createDraftProduct,
    publishProduct,
  }) as Integrations["shopify"];
  const integrations: Integrations = {
    ...base,
    supplierFinder: { find },
    copywriter: { writePage },
    shopify,
    ...overrides,
  };
  return { integrations, find, writePage, createDraftProduct, publishProduct };
}

async function atGate2(mocks = mockIntegrations()) {
  const deps = testDeps(mocks.integrations);
  const imported = await importFromTikTok(env.a.creative, { url: nextTikTokUrl(), brandId }, deps);
  expect(imported.product.status).toBe("awaiting_product_confirmation");
  const confirmed = await confirmProduct(env.a.creative, { productId: imported.product.id }, deps);
  expect(confirmed.status).toBe("awaiting_supplier_choice");
  return { productId: confirmed.id, deps, ...mocks };
}

async function atGate3(mocks = mockIntegrations()) {
  await insertStore();
  const ctx = await atGate2(mocks);
  const suppliers = await listSuppliers(env.a.creative, ctx.productId);
  const pipeline = await selectSupplier(
    env.a.creative,
    { productId: ctx.productId, supplierMatchId: suppliers[0]!.id, acceptLowMargin: true },
    ctx.deps,
  );
  expect(pipeline.status).toBe("awaiting_content_approval");
  return { ...ctx, suppliers, pipeline };
}

describe("M2 full mock flow: TikTok link → published Shopify page", () => {
  it("imports, confirms, sources, picks a supplier, builds the draft and publishes it", async () => {
    const store = await insertStore();
    const { productId, deps, find, writePage, createDraftProduct, publishProduct } =
      await atGate2();

    // Sourcing ran right after GATE 1 and stopped at GATE 2.
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]![1]).toMatchObject({ country: "FR", currency: "EUR", limit: 5 });
    let pipeline = await getProductPipeline(env.a.viewer, productId);
    expect(pipeline.gate).toBe("supplier_choice");
    expect(pipeline.suppliers.length).toBeGreaterThan(0);
    expect(pipeline.jobs.find((j) => j.step === "source")).toMatchObject({ status: "succeeded" });
    expect(pipeline.jobs.find((j) => j.step === "source")!.aiCostUsd).toBeGreaterThan(0);
    expect(pipeline.shopifyStores).toEqual([
      expect.objectContaining({ id: store.id, shopDomain: "demo-store.myshopify.com" }),
    ]);

    // GATE 2 preview then selection.
    const best = pipeline.suppliers[0]!;
    const quote = await quoteSupplierChoice(env.a.viewer, {
      productId,
      supplierMatchId: best.id,
    });
    expect(quote.sellingPrice).toBeGreaterThan(quote.margin.landedCost);
    pipeline = await selectSupplier(
      env.a.creative,
      { productId, supplierMatchId: best.id, note: "Cheapest with fast shipping" },
      deps,
    );
    expect(pipeline.status).toBe("awaiting_content_approval");
    expect(pipeline.sellingPrice).toBe(quote.sellingPrice);
    expect(pipeline.margin).toMatchObject({ sellingPrice: quote.sellingPrice });
    expect(pipeline.suppliers.find((s) => s.selected)?.id).toBe(best.id);
    expect(pipeline.supplierChoice).toMatchObject({
      supplierMatchId: best.id,
      shopifyConnectionId: store.id,
    });

    // Build: copy written once, draft created on the chosen store with its template.
    expect(writePage).toHaveBeenCalledTimes(1);
    expect(pipeline.pageCopy?.title).toBeTruthy();
    expect(pipeline.pageCopyGeneratedAt).not.toBeNull();
    expect(createDraftProduct).toHaveBeenCalledTimes(1);
    const draftInput = createDraftProduct.mock.calls[0]![1];
    expect(draftInput).toMatchObject({
      idempotencyKey: productId,
      templateSuffix: "trendcart",
      title: pipeline.pageCopy!.title,
    });
    expect(draftInput.variants.every((v) => v.price === quote.sellingPrice)).toBe(true);
    expect(draftInput.imageUrls.length).toBeGreaterThan(0);
    expect(pipeline.shopify).toMatchObject({
      status: "draft",
      storefrontUrl: null,
      adminUrl: expect.stringContaining("admin.shopify.com/store/demo-store/products/"),
    });
    expect(pipeline.contentParts).toEqual({ page: "pending", videos: "pending" });

    // GATE 3 page part: publish.
    pipeline = await approvePage(
      env.a.creative,
      { productId, note: "Ship it", copyVersion: pipeline.pageCopyVersion! },
      deps,
    );
    expect(publishProduct).toHaveBeenCalledTimes(1);
    expect(pipeline.shopify).toMatchObject({
      status: "active",
      storefrontUrl: expect.stringContaining("https://demo-store.myshopify.com/products/"),
    });
    expect(pipeline.contentParts).toEqual({ page: "approved", videos: "pending" });
    // Videos (M3) are still pending: the product waits at GATE 3.
    expect(pipeline.status).toBe("awaiting_content_approval");

    const rows = await env.a.owner.db.select(shopifyProduct);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId, connectionId: store.id, status: "active" });

    const actions = (await env.a.owner.db.select(auditLog)).map((a) => a.action);
    expect(actions.filter((a) => a === "gate.approve")).toHaveLength(3);
    expect(actions).toContain("page.publish");
    const gates = (await env.a.owner.db.select(approval)).map((a) => [a.gate, a.decision]);
    expect(gates).toEqual(
      expect.arrayContaining([
        ["product_confirmation", "approved"],
        ["supplier_choice", "approved"],
        ["content_approval", "approved"],
      ]),
    );

    // Approving the page twice is refused and publishes nothing more.
    await expect(
      approvePage(env.a.creative, { productId, copyVersion: pipeline.pageCopyVersion! }, deps),
    ).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(publishProduct).toHaveBeenCalledTimes(1);
  });
});

describe("GATE 2: supplier choice", () => {
  it("is role checked (viewer and system actors cannot choose)", async () => {
    await insertStore();
    const { productId, deps } = await atGate2();
    const [s] = await listSuppliers(env.a.viewer, productId);
    for (const ctx of [env.a.viewer, env.system(env.wsA)]) {
      await expect(
        selectSupplier(ctx, { productId, supplierMatchId: s!.id }, deps),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rejectSuppliers(ctx, { productId }, deps)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(await env.a.owner.db.count(approval)).toBe(1); // GATE 1 only
  });

  it("needs a store, an exchange rate for foreign listings, and consent for a low margin", async () => {
    const { productId, deps } = await atGate2();
    const [s] = await listSuppliers(env.a.creative, productId);
    await expect(
      selectSupplier(env.a.creative, { productId, supplierMatchId: s!.id }, deps),
    ).rejects.toMatchObject({ code: "precondition_failed" });

    const store = await insertStore();
    await insertStore(env.a.owner.db, brandId, "second-store");
    await expect(
      selectSupplier(env.a.creative, { productId, supplierMatchId: s!.id }, deps),
    ).rejects.toMatchObject({ code: "invalid_input" }); // several stores: choose one

    // The suggested price respects the brand minimum (min-margin floor)...
    await env.a.owner.db.update(brand, { minMargin: 0.3 }, undefined);
    const floor = await quoteSupplierChoice(env.a.creative, { productId, supplierMatchId: s!.id });
    expect(floor.margin.meetsTarget).toBe(true);
    // ...a manual price below it needs explicit consent.
    await expect(
      selectSupplier(
        env.a.creative,
        { productId, supplierMatchId: s!.id, shopifyConnectionId: store.id, sellingPrice: 1 },
        deps,
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });

    const usd = await upsertSupplierListing(env.a.owner.db, productId, {
      source: "aliexpress",
      url: "https://www.aliexpress.com/item/1.html",
      title: "Lamp",
      price: { amount: 5, currency: "USD" },
      shipping: { amount: 1, currency: "USD" },
      leadTimeDays: null,
      images: [],
      variants: [],
      matchScore: 0.5,
    });
    await expect(
      quoteSupplierChoice(env.a.creative, { productId, supplierMatchId: usd.id }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const fx = await quoteSupplierChoice(env.a.creative, {
      productId,
      supplierMatchId: usd.id,
      fxRate: 0.9,
    });
    expect(fx.margin.productCost).toBe(4.5);

    const chosen = await selectSupplier(
      env.a.creative,
      {
        productId,
        supplierMatchId: usd.id,
        shopifyConnectionId: store.id,
        fxRate: 0.9,
        sellingPrice: 29.99,
        acceptLowMargin: true,
      },
      deps,
    );
    expect(chosen.status).toBe("awaiting_content_approval");
    expect(chosen.sellingPrice).toBe(29.99);
    expect(chosen.supplierChoice).toMatchObject({ fxRate: 0.9 });
    // A listing of another product is refused.
    await expect(
      quoteSupplierChoice(env.a.creative, {
        productId: crypto.randomUUID(),
        supplierMatchId: usd.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejecting the listings searches again, without the rejected listings", async () => {
    const { productId, deps, find } = await atGate2();
    const before = await listSuppliers(env.a.creative, productId);
    const again = await rejectSuppliers(
      env.a.media_buyer,
      { productId, note: "None of these" },
      deps,
    );
    expect(find).toHaveBeenCalledTimes(2);
    expect(again.status).toBe("awaiting_supplier_choice");
    const rejected = new Set(before.map((s) => s.url));
    expect(again.suppliers.filter((s) => rejected.has(s.url))).toEqual([]);
    expect(await env.a.owner.db.count(supplierMatch)).toBe(again.suppliers.length);
    expect(again.approvals.find((a) => a.gate === "supplier_choice")).toMatchObject({
      decision: "rejected",
      note: "None of these",
    });
  });
});

describe("step idempotency", () => {
  it("source: a re-run with stored listings does not search again or duplicate rows", async () => {
    const { productId, deps, find } = await atGate2();
    const count = await env.a.owner.db.count(supplierMatch);
    // Simulate a crash after the rows were stored but before the transition.
    await env.a.owner.db.update(product, { status: "sourcing" }, undefined);
    const outcome = await runProductStep(env.system(env.wsA), productId, "source", {
      integrations: deps.integrations!,
      limiter: createMemoryLimiter(),
      sleep: async () => undefined,
    });
    expect(outcome.status).toBe("succeeded");
    expect(find).toHaveBeenCalledTimes(1);
    expect(await env.a.owner.db.count(supplierMatch)).toBe(count);

    // The same listing upserted twice is one row.
    const [listing] = (await find.mock.results[0]!.value).data as SupplierListing[];
    await upsertSupplierListing(env.a.owner.db, productId, listing!);
    await upsertSupplierListing(env.a.owner.db, productId, { ...listing!, title: "Renamed" });
    expect(await env.a.owner.db.count(supplierMatch)).toBe(count);
  });

  it("build: re-runs reuse the stored copy and update the same Shopify draft", async () => {
    const { productId, deps, writePage, createDraftProduct } = await atGate3();
    await env.a.owner.db.update(product, { status: "building_page_and_videos" }, undefined);
    const outcome = await runProductStep(env.system(env.wsA), productId, "build", {
      integrations: deps.integrations!,
      limiter: createMemoryLimiter(),
      sleep: async () => undefined,
    });
    expect(outcome.status).toBe("succeeded");
    expect(writePage).toHaveBeenCalledTimes(1);
    expect(createDraftProduct).toHaveBeenCalledTimes(2);
    const [first, second] = await Promise.all(createDraftProduct.mock.results.map((r) => r.value));
    expect(second.productId).toBe(first.productId);
    expect(await env.a.owner.db.count(shopifyProduct)).toBe(1);
  });

  it("build: a Shopify outage fails the step after retries; retry reuses the copy", async () => {
    let down = true;
    const mocks = mockIntegrations();
    const realCreate = mocks.createDraftProduct.getMockImplementation()!;
    mocks.createDraftProduct.mockImplementation(async (creds, input) => {
      if (down) throw new IntegrationError("shopify", "provider_error", "503 from Shopify");
      return realCreate(creds, input);
    });
    await insertStore();
    const { productId, deps } = await atGate2(mocks);
    const [s] = await listSuppliers(env.a.creative, productId);
    const failed = await selectSupplier(
      env.a.creative,
      { productId, supplierMatchId: s!.id, acceptLowMargin: true },
      deps,
    );
    expect(failed.status).toBe("failed");
    expect(failed.failedStep).toBe("build");
    expect(failed.error).toContain("503 from Shopify");
    expect(failed.jobs.find((j) => j.step === "build")).toMatchObject({
      status: "failed",
      attempts: 3,
    });
    expect(mocks.writePage).toHaveBeenCalledTimes(1);
    expect(failed.pageCopy).not.toBeNull();

    down = false;
    const retried = await retryStep(env.a.creative, productId, deps);
    expect(retried.status).toBe("awaiting_content_approval");
    expect(mocks.writePage).toHaveBeenCalledTimes(1);
    expect(await env.a.owner.db.count(shopifyProduct)).toBe(1);
  });
});

describe("GATE 3: page approval, rejection, regeneration, edits", () => {
  const altCopy = (title: string): PageCopy => ({
    title,
    descriptionHtml: "<p>New description</p>",
    highlights: ["One", "Two", "Three"],
    faq: [
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
      { question: "Q3?", answer: "A3." },
    ],
    guarantee: "30-day returns",
    adTexts: ["Short ad"],
  });

  it("is role checked: viewers cannot approve, reject, regenerate or edit", async () => {
    const { productId, deps, publishProduct } = await atGate3();
    const v = env.a.viewer;
    await expect(
      approvePage(v, { productId, copyVersion: ANY_VERSION }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rejectPage(v, { productId }, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(regeneratePageCopy(v, { productId }, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updatePageCopy(v, { productId, copy: { title: "x" } }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      approvePage(env.system(env.wsA), { productId, copyVersion: ANY_VERSION }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(publishProduct).not.toHaveBeenCalled();
    // A media buyer may approve (every gate).
    const ok = await approvePage(
      env.a.media_buyer,
      { productId, copyVersion: await copyVersionOf(productId) },
      deps,
    );
    expect(ok.contentParts.page).toBe("approved");
  });

  it("rejection writes new copy and updates the same draft; refused once published", async () => {
    const writePage = vi
      .fn<Copywriter["writePage"]>()
      .mockResolvedValueOnce({ data: altCopy("First draft"), usage: [] })
      .mockResolvedValueOnce({ data: altCopy("Second draft"), usage: [] })
      .mockResolvedValue({ data: altCopy("Third draft"), usage: [] });
    const mocks = mockIntegrations({ copywriter: { writePage } });
    const { productId, deps, createDraftProduct } = await atGate3(mocks);
    expect(writePage).toHaveBeenCalledTimes(1);

    let p = await rejectPage(env.a.creative, { productId, note: "Too long" }, deps);
    expect(p.status).toBe("awaiting_content_approval");
    expect(p.pageCopy?.title).toBe("Second draft");
    expect(p.contentParts.page).toBe("rejected");
    p = await regeneratePageCopy(env.a.creative, { productId }, deps);
    expect(p.pageCopy?.title).toBe("Third draft");
    expect(writePage).toHaveBeenCalledTimes(3);

    // First build: no hint. Rebuilds: the rejection notes (most recent first)
    // and the title of the copy that was sent back.
    expect(writePage.mock.calls[0]![1]).not.toHaveProperty("hint");
    expect(writePage.mock.calls[1]![1].hint).toEqual({
      note: "Too long",
      previousTitle: "First draft",
    });
    expect(writePage.mock.calls[2]![1].hint).toEqual({
      note: "Too long",
      previousTitle: "Second draft",
    });

    const ids = await Promise.all(
      createDraftProduct.mock.results.map(async (r) => (await r.value).productId),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await env.a.owner.db.count(shopifyProduct)).toBe(1);

    const rejections = (await env.a.owner.db.select(approval)).filter(
      (a) => a.gate === "content_approval" && a.decision === "rejected",
    );
    expect(rejections.map((r) => r.payload?.kind).sort()).toEqual(["regenerate", "reject"]);
    expect(rejections.find((r) => r.payload?.kind === "reject")?.note).toBe("Too long");
    const audits = (await env.a.owner.db.select(auditLog)).filter(
      (a) => a.action === "gate.reject",
    );
    expect(audits).toHaveLength(2);

    await approvePage(
      env.a.creative,
      { productId, copyVersion: await copyVersionOf(productId) },
      deps,
    );
    await expect(rejectPage(env.a.creative, { productId }, deps)).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(
      updatePageCopy(env.a.creative, { productId, copy: { title: "Late" } }, deps),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("edits validate the merged copy and push it to the draft", async () => {
    const { productId, deps, createDraftProduct } = await atGate3();
    const edited = await updatePageCopy(
      env.a.creative,
      { productId, copy: { title: "Hand-written title", guarantee: "60-day returns" } },
      deps,
    );
    expect(edited.pageCopy).toMatchObject({
      title: "Hand-written title",
      guarantee: "60-day returns",
    });
    expect(createDraftProduct.mock.calls.at(-1)![1]).toMatchObject({
      title: "Hand-written title",
      metafields: expect.objectContaining({ guarantee: "60-day returns" }),
    });
    await expect(
      updatePageCopy(env.a.creative, { productId, copy: { highlights: ["only one"] } }, deps),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      updatePageCopy(
        env.a.creative,
        // Unknown fields are refused.
        { productId, copy: { title: "x", status: "ACTIVE" } as never },
        deps,
      ),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("GATE 3 copy hint", () => {
  async function recordRejection(productId: string, note: string | null, payload: object) {
    return env.a.owner.db.insert(approval, {
      productId,
      gate: "content_approval",
      userId: env.a.owner.actor.userId,
      decision: "rejected",
      note,
      payload: payload as Record<string, unknown>,
    });
  }

  it("joins page notes most recent first, ignores video rejections, caps the note", async () => {
    const { productId } = await atGate3();
    expect(await loadCopyHint(env.a.owner.db, productId)).toBeNull();

    await recordRejection(productId, "Video too dark", { part: "videos" });
    expect(await loadCopyHint(env.a.owner.db, productId)).toBeNull();

    await recordRejection(productId, "Shorter title", {
      part: "page",
      kind: "reject",
      previousCopy: { title: "Old title" },
    });
    await new Promise((r) => setTimeout(r, 5));
    await recordRejection(productId, null, {
      part: "page",
      kind: "regenerate",
      previousCopy: { title: "  Newer title  " },
    });
    await new Promise((r) => setTimeout(r, 5));
    await recordRejection(productId, "x".repeat(1990), { part: "page", kind: "reject" });

    const hint = await loadCopyHint(env.a.owner.db, productId);
    // Latest rejection has no previousCopy: no title rather than an older one.
    expect(hint).not.toHaveProperty("previousTitle");
    expect(hint!.note).toHaveLength(2000);
    expect(hint!.note!.startsWith("x".repeat(1990) + "\n\nShorter")).toBe(true);
    expect(hint!.note).not.toContain("Video too dark");
  });

  it("is scoped to the workspace", async () => {
    const { productId } = await atGate3();
    await recordRejection(productId, "Too long", {
      part: "page",
      kind: "reject",
      previousCopy: { title: "T" },
    });
    expect(await loadCopyHint(env.a.owner.db, productId)).toEqual({
      note: "Too long",
      previousTitle: "T",
    });
    expect(await loadCopyHint(env.bOwner.db, productId)).toBeNull();
  });
});

describe("Shopify page URLs are stored on shopify_product", () => {
  it("sync and publish persist the URLs; reads use them without calling Shopify", async () => {
    const { productId, deps, createDraftProduct } = await atGate3();
    const ref = await createDraftProduct.mock.results[0]!.value;
    const [draft] = await env.a.owner.db.select(shopifyProduct);
    expect(draft).toMatchObject({
      previewUrl: ref.previewUrl,
      adminUrl: ref.adminUrl,
      storefrontUrl: null,
    });
    expect(ref.previewUrl).toBeTruthy();

    // Plain read (no fresh ref): the stored preview link is shown.
    const draftCalls = createDraftProduct.mock.calls.length;
    let pipeline = await getProductPipeline(env.a.viewer, productId);
    expect(createDraftProduct).toHaveBeenCalledTimes(draftCalls);
    expect(pipeline.shopify).toMatchObject({
      status: "draft",
      previewUrl: ref.previewUrl,
      adminUrl: ref.adminUrl,
      storefrontUrl: null,
    });

    // The stored columns win over the derived fallbacks.
    await env.a.owner.db.update(
      shopifyProduct,
      { adminUrl: "https://admin.shopify.com/store/x/products/1" },
      eq(shopifyProduct.id, draft!.id),
    );
    pipeline = await getProductPipeline(env.a.viewer, productId);
    expect(pipeline.shopify?.adminUrl).toBe("https://admin.shopify.com/store/x/products/1");

    await approvePage(env.a.creative, { productId, copyVersion: pipeline.pageCopyVersion! }, deps);
    const [live] = await env.a.owner.db.select(shopifyProduct);
    expect(live!.status).toBe("active");
    expect(live!.storefrontUrl).toMatch(/^https:\/\/demo-store\.myshopify\.com\/products\//);
    expect(live!.adminUrl).toBe(ref.adminUrl);
    pipeline = await getProductPipeline(env.a.viewer, productId);
    expect(pipeline.shopify).toMatchObject({
      status: "active",
      storefrontUrl: live!.storefrontUrl,
    });
  });
});

describe("page copy edits are audited", () => {
  it("writes page.update with the changed field names only", async () => {
    const { productId, deps } = await atGate3();
    const before = (await getProductPipeline(env.a.viewer, productId)).pageCopy!;
    await updatePageCopy(
      env.a.creative,
      {
        productId,
        // guarantee changes; highlights is sent unchanged.
        copy: {
          title: "Secret-free title",
          guarantee: "60-day returns",
          highlights: before.highlights,
        },
      },
      deps,
    );
    const audits = (await env.a.owner.db.select(auditLog)).filter(
      (a) => a.action === "page.update",
    );
    expect(audits).toHaveLength(1);
    const [entry] = audits;
    expect(entry).toMatchObject({
      targetType: "product",
      targetId: productId,
      actorUserId: env.a.creative.actor.userId,
    });
    expect(entry!.metadata).toMatchObject({ fields: ["title", "guarantee"] });
    const serialized = JSON.stringify(entry!.metadata);
    expect(serialized).not.toContain("Secret-free title");
    expect(serialized).not.toContain("60-day returns");

    // Refused edits (validation, role, other workspace) are not audited.
    await expect(
      updatePageCopy(env.a.creative, { productId, copy: { highlights: ["one"] } }, deps),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      updatePageCopy(env.a.viewer, { productId, copy: { title: "x" } }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updatePageCopy(env.bOwner, { productId, copy: { title: "x" } }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    const after = await env.a.owner.db.select(auditLog);
    expect(after.filter((a) => a.action === "page.update")).toHaveLength(1);
    const bAudits = await env.bOwner.db.select(auditLog);
    expect(bAudits.filter((a) => a.action === "page.update")).toHaveLength(0);
  });
});

describe("pipeline services: tenant isolation", () => {
  it("workspace B cannot read or act on workspace A's product", async () => {
    const { productId, deps, suppliers } = await atGate3();
    const b = env.bOwner;
    const supplierMatchId = suppliers[0]!.id;
    await expect(getProductPipeline(b, productId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listSuppliers(b, productId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(quoteSupplierChoice(b, { productId, supplierMatchId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(selectSupplier(b, { productId, supplierMatchId }, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(rejectSuppliers(b, { productId }, deps)).rejects.toBeInstanceOf(NotFoundError);
    for (const call of [
      () => approvePage(b, { productId, copyVersion: ANY_VERSION }, deps),
      () => rejectPage(b, { productId }, deps),
      () => regeneratePageCopy(b, { productId }, deps),
      () => updatePageCopy(b, { productId, copy: { title: "x" } }, deps),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    }
    const [store] = await env.a.owner.db.select(shopifyConnection);
    await expect(listShopifyTemplates(b, store!.id, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getProductPipeline(env.a.viewer, productId)).contentParts.page).toBe("pending");
  });
});

describe("Shopify templates (M1 open question 7)", () => {
  it("lists the theme's product templates and validates the suffix", async () => {
    const store = await insertStore();
    const deps = testDeps(createIntegrations("mock"));
    expect(await listShopifyTemplates(env.a.viewer, store.id, deps)).toEqual({
      connectionId: store.id,
      suffixes: [null, "trendcart"],
      hasTrendcartTemplate: true,
    });
    await expect(
      setShopifyTemplate(
        env.a.media_buyer,
        { connectionId: store.id, templateSuffix: "missing" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const cleared = await setShopifyTemplate(
      env.a.media_buyer,
      { connectionId: store.id, templateSuffix: null },
      deps,
    );
    expect(cleared.templateSuffix).toBeNull();
  });
});

describe("M2 QA fixes", () => {
  it("S7: GATE 2 accepts an expiring store and still refuses one that needs a reconnect", async () => {
    const store = await insertStore();
    const { productId, deps } = await atGate2();
    const [s] = await listSuppliers(env.a.creative, productId);
    await env.a.owner.db.update(
      shopifyConnection,
      { status: "needs_reauth" },
      eq(shopifyConnection.id, store.id),
    );
    await expect(
      selectSupplier(
        env.a.creative,
        { productId, supplierMatchId: s!.id, acceptLowMargin: true },
        deps,
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    await env.a.owner.db.update(
      shopifyConnection,
      { status: "expiring" },
      eq(shopifyConnection.id, store.id),
    );
    const chosen = await selectSupplier(
      env.a.creative,
      { productId, supplierMatchId: s!.id, acceptLowMargin: true },
      deps,
    );
    expect(chosen.supplierChoice?.shopifyConnectionId).toBe(store.id);
    expect(chosen.status).toBe("awaiting_content_approval");
  });

  it("S3: the build step refuses unsafe copy (retryable) and pushes nothing to Shopify", async () => {
    const mocks = mockIntegrations();
    const realWrite = mocks.writePage.getMockImplementation()!;
    mocks.writePage.mockImplementation(async (call, input) => {
      const result = await realWrite(call, input);
      return { ...result, data: { ...result.data, highlights: ["Rated 4.9 out of 5", "B", "C"] } };
    });
    await insertStore();
    const { productId, deps } = await atGate2(mocks);
    const [s] = await listSuppliers(env.a.creative, productId);
    const failed = await selectSupplier(
      env.a.creative,
      { productId, supplierMatchId: s!.id, acceptLowMargin: true },
      deps,
    );
    expect(failed.status).toBe("failed");
    expect(failed.failedStep).toBe("build");
    expect(failed.error).toContain("reviews_or_ratings (highlights[0])");
    // Retryable: retried with a new copy each time, never stored, never pushed.
    expect(mocks.writePage.mock.calls.length).toBeGreaterThan(1);
    expect(failed.pageCopy).toBeNull();
    expect(mocks.createDraftProduct).not.toHaveBeenCalled();
  });

  it("S3: updatePageCopy names the refused rules and fields, and stores nothing", async () => {
    const { productId, deps, pipeline } = await atGate3();
    const error = await updatePageCopy(
      env.a.creative,
      { productId, copy: { adTexts: ["10,000 customers love it"] } },
      deps,
    ).catch((e: unknown) => e as { code: string; message: string });
    expect(error).toMatchObject({ code: "invalid_input" });
    expect((error as { message: string }).message).toContain("adTexts[0]: customer counts");
    const stored = await env.a.owner.db.getById(product, productId);
    expect(stored.pageCopy).toEqual(pipeline.pageCopy);
  });

  it("S1: updatePageCopy stores sanitized HTML and bumps the copy version", async () => {
    const { productId, deps, pipeline } = await atGate3();
    const edited = await updatePageCopy(
      env.a.creative,
      { productId, copy: { descriptionHtml: '<p onclick="x()">Hi</p><script>alert(1)</script>' } },
      deps,
    );
    expect(edited.pageCopy?.descriptionHtml).not.toMatch(/<script|onclick/i);
    expect(edited.pageCopyVersion).not.toBe(pipeline.pageCopyVersion);
  });

  it("S5: GATE 2 re-searches are limited per workspace", async () => {
    await insertStore();
    const limited = {
      product: createMemoryRateLimiter(100, 3_600_000),
      workspace: createMemoryRateLimiter(1, 3_600_000),
    };
    const { productId, deps } = await atGate2();
    const withLimits = { ...deps, rebuildLimiters: limited };
    await rejectSuppliers(env.a.creative, { productId }, withLimits);
    await expect(rejectSuppliers(env.a.creative, { productId }, withLimits)).rejects.toMatchObject({
      code: "rate_limited",
    });
    // A refused action records nothing.
    const rejections = (await env.a.owner.db.select(approval)).filter(
      (a) => a.productId === productId && a.decision === "rejected",
    );
    expect(rejections).toHaveLength(1);
  });

  it("S6: the source step passes every rejected listing URL as excludeUrls", async () => {
    await insertStore();
    const { productId, deps, find } = await atGate2();
    const first = (await listSuppliers(env.a.viewer, productId)).map((s) => s.url);
    await rejectSuppliers(env.a.creative, { productId }, deps);
    const second = (await listSuppliers(env.a.viewer, productId)).map((s) => s.url);
    await rejectSuppliers(env.a.creative, { productId }, deps);
    expect(find).toHaveBeenCalledTimes(3);
    expect(find.mock.calls[0]![1].excludeUrls).toBeUndefined();
    expect(new Set(find.mock.calls[2]![1].excludeUrls)).toEqual(new Set([...first, ...second]));
  });

  it("N5: gate decisions are ordered by created_at then a monotonic sequence", async () => {
    const { productId } = await atGate3();
    const db = env.a.owner.db;
    const at = new Date("2026-01-01T00:00:00.000Z");
    // Same timestamp; ids in the opposite order of the sequence.
    for (const [id, seq, decision] of [
      ["zzzz-first", 101, "rejected"],
      ["aaaa-second", 102, "approved"],
    ] as const) {
      await db.insert(approval, {
        id,
        productId,
        gate: "content_approval",
        userId: env.a.creative.actor.userId,
        decision,
        createdAt: new Date(at.getTime() + 365 * 24 * 3600_000 * 5),
        payload: { part: "videos", seq },
      });
    }
    expect((await gatePartStates(db, productId, "content_approval")).videos).toBe("approved");

    // Recorded decisions: strictly increasing created_at and sequence.
    const rows = (await db.select(approval)).filter((a) => a.productId === productId);
    const recorded = rows
      .filter((a) => a.id !== "zzzz-first" && a.id !== "aaaa-second")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const seqs = recorded.map((a) => Number(a.payload?.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("GATE 3 page publish claim (M2 open questions 6 and 7)", () => {
  const T0 = new Date("2026-11-01T10:00:00.000Z");

  /** A page approval left "publishing" at `at` (as if the process died mid-publish). */
  const insertClaim = (productId: string, at: Date) =>
    env.a.owner.db.insert(approval, {
      productId,
      gate: "content_approval",
      userId: env.a.media_buyer.actor.userId,
      decision: "approved",
      createdAt: at,
      payload: { part: "page", kind: "approve", state: "publishing", seq: 1000 },
    });

  it("is null while the page part is not publishing", async () => {
    const { productId, deps } = await atGate3();
    const pending = await getProductPipeline(env.a.viewer, productId);
    expect(pending.contentParts.page).toBe("pending");
    expect(pending.pagePublishClaim).toBeNull();

    const approved = await approvePage(
      env.a.creative,
      { productId, copyVersion: await copyVersionOf(productId) },
      deps,
    );
    expect(approved.contentParts.page).toBe("approved");
    expect(approved.pagePublishClaim).toBeNull();
    expect((await getProductPipeline(env.a.viewer, productId)).pagePublishClaim).toBeNull();
  });

  it("reports the claim time, fresh before STALE_PUBLISH_CLAIM_MS and stale after", async () => {
    const { productId, deps } = await atGate3();
    await insertClaim(productId, T0);
    const at = (ms: number) => ({ now: () => new Date(T0.getTime() + ms) });

    const fresh = await getProductPipeline(env.a.viewer, productId, at(60_000));
    expect(fresh.contentParts.page).toBe("publishing");
    expect(fresh.pagePublishClaim).toEqual({ startedAt: T0.toISOString(), stale: false });
    // Exactly at the limit the claim is not yet taken over (strictly older only).
    expect(
      (await getProductPipeline(env.a.viewer, productId, at(STALE_PUBLISH_CLAIM_MS)))
        .pagePublishClaim?.stale,
    ).toBe(false);

    const stale = await getProductPipeline(env.a.viewer, productId, at(STALE_PUBLISH_CLAIM_MS + 1));
    expect(stale.pagePublishClaim).toEqual({ startedAt: T0.toISOString(), stale: true });

    // A stale claim is what approvePage takes over: the retry succeeds and the claim clears.
    const retried = await approvePage(
      env.a.creative,
      { productId, copyVersion: await copyVersionOf(productId) },
      { ...deps, now: at(STALE_PUBLISH_CLAIM_MS + 1).now },
    );
    expect(retried.contentParts.page).toBe("approved");
    expect(retried.pagePublishClaim).toBeNull();
  });

  it("a copy changed since it was loaded is refused with reason copy_changed", async () => {
    const { productId, deps } = await atGate3();
    const seen = await copyVersionOf(productId);
    await updatePageCopy(env.a.creative, { productId, copy: { title: "Edited meanwhile" } }, deps);

    const error = await approvePage(env.a.creative, { productId, copyVersion: seen }, deps).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: "invalid_state",
      reason: "copy_changed",
      message: "The page changed since you loaded it.",
    });
    expect(toServiceFailure(error)).toEqual({
      ok: false,
      code: "invalid_state",
      reason: "copy_changed",
      error: "The page changed since you loaded it.",
    });
  });
});
