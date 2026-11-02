/**
 * M2 isolation suite: two workspaces owned by two different people, each with
 * a Shopify store from a different Shopify account, and products at GATE 2
 * and GATE 3, all through the real mock adapters and the inline engine.
 *
 * Workspace B then calls every M2 entry point with workspace A's ids
 * (productId, supplierMatchId, shopifyConnectionId), both directly and
 * smuggled inside B's own valid requests. Nothing of A may be readable or
 * mutable, refusals must not reveal whether A's id exists, A's data must be
 * unchanged, and Shopify calls for B must only ever reach B's store.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotFoundError } from "@/lib/auth/errors";
import {
  approval,
  auditLog,
  job,
  product,
  shopifyConnection,
  shopifyProduct,
  supplierMatch,
  usageMonthly,
} from "@/lib/db/schema";
import {
  approvePage,
  getProductPipeline,
  listShopifyTemplates,
  listSuppliers,
  quoteSupplierChoice,
  regeneratePageCopy,
  rejectPage,
  rejectSuppliers,
  selectSupplier,
  setShopifyTemplate,
  updatePageCopy,
  type ServiceDeps,
} from "@/lib/services";
import { getShopifyCredentialsFor } from "@/lib/services/internal/credentials";
import { createMemoryLimiter } from "@/lib/workflows/concurrency";
import { gateHookToken, resumeHookToken } from "@/lib/workflows/durable/config";
import { createDurablePipeline, type DurableEngine } from "@/lib/workflows/durable/pipeline";
import { runProductStep } from "@/lib/workflows/runner";
import { loadChosenSupplier, loadCopyHint } from "@/lib/workflows/steps/build";
import { upsertSupplierListing } from "@/lib/workflows/steps/source";
import { eq } from "drizzle-orm";

import {
  ANY_COPY_VERSION,
  copyVersionOf,
  recordShopify,
  toGate2,
  toGate3,
  type ShopifyCall,
} from "../helpers/m2";
import {
  connectShopifyMock,
  createTwoTenantWorld,
  mockDeps,
  type TwoTenantWorld,
} from "../helpers/world";

const SHOP_A = "alpha-m2.myshopify.com";
const SHOP_B = "bravo-m2.myshopify.com";

let w: TwoTenantWorld;
let deps: ServiceDeps;
let calls: ShopifyCall[];
let ids: {
  shopA: string;
  shopB: string;
  /** A's product at GATE 3 (page pending) and at GATE 2. */
  a3: string;
  a2: string;
  /** B's own product at GATE 2 and at GATE 3. */
  b2: string;
  b3: string;
  supplierA: string;
  supplierB: string;
};

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { code?: string; message?: string; status?: number },
  );

/** Everything A owns that M2 touches (timestamps of updates stripped). */
async function snapshotA() {
  const db = w.a.owner.db;
  const strip = <T extends { updatedAt?: Date }>(rows: T[]) =>
    rows.map((row) => {
      const rest = { ...row };
      delete rest.updatedAt;
      return rest;
    });
  return {
    products: strip(await db.select(product)),
    suppliers: strip(await db.select(supplierMatch)),
    pages: strip(await db.select(shopifyProduct)),
    stores: strip(await db.select(shopifyConnection)),
    approvals: await db.select(approval),
    audits: await db.select(auditLog),
    jobs: strip(await db.select(job)),
    usage: strip(await db.select(usageMonthly)),
  };
}

beforeAll(async () => {
  w = await createTwoTenantWorld();
  const rec = recordShopify(w.integrations);
  calls = rec.calls;
  deps = mockDeps(rec.integrations);

  const shopA = await connectShopifyMock(w.a.owner, w.shopify, {
    appMode: "public",
    brandId: w.a.brandId,
    shop: SHOP_A,
  });
  const shopB = await connectShopifyMock(w.b.owner, w.shopify, {
    appMode: "custom",
    brandId: w.b.brandId,
    shop: SHOP_B,
    clientId: "bravo-custom-app",
    clientSecret: "bravo-custom-secret",
  } as Parameters<typeof connectShopifyMock>[2]);

  // Same TikTok video in both workspaces: same mock analysis, same listing URLs.
  const link = "https://www.tiktok.com/@shared/video/7350000000000000077";
  const link2 = "https://www.tiktok.com/@shared/video/7350000000000000078";
  const a3 = await toGate3(w.a, link, deps);
  const a2 = await toGate2(w.a, link2, deps);
  const b3 = await toGate3(w.b, link, deps);
  const b2 = await toGate2(w.b, link2, deps);

  ids = {
    shopA: shopA.result.connectionId,
    shopB: shopB.result.connectionId,
    a3: a3.id,
    a2: a2.id,
    b2: b2.id,
    b3: b3.id,
    supplierA: a2.suppliers[0]!.id,
    supplierB: b2.suppliers[0]!.id,
  };
}, 240_000);

afterAll(async () => w.close());

describe("two tenants reach GATE 2 and GATE 3 on their own stores", () => {
  it("each workspace has its own rows, even for the same video and the same listing URLs", async () => {
    expect(ids.shopA).not.toBe(ids.shopB);
    const a = await getProductPipeline(w.a.viewer, ids.a2);
    const b = await getProductPipeline(w.b.viewer, ids.b2);
    expect(a.suppliers.map((s) => s.url)).toEqual(b.suppliers.map((s) => s.url));
    expect(a.suppliers.map((s) => s.id)).not.toEqual(b.suppliers.map((s) => s.id));

    const pa = await getProductPipeline(w.a.viewer, ids.a3);
    const pb = await getProductPipeline(w.b.viewer, ids.b3);
    expect(pa.shopify).toMatchObject({ connectionId: ids.shopA, shopDomain: SHOP_A });
    expect(pb.shopify).toMatchObject({ connectionId: ids.shopB, shopDomain: SHOP_B });
    expect(pa.shopifyStores.map((s) => s.id)).toEqual([ids.shopA]);
    expect(pb.shopifyStores.map((s) => s.id)).toEqual([ids.shopB]);
  });

  it("Shopify calls made for one workspace only ever reach that workspace's store", async () => {
    const domains = new Set(calls.map((c) => c.shopDomain));
    expect(domains).toEqual(new Set([SHOP_A, SHOP_B]));
    const drafts = calls.filter((c) => c.method === "createDraftProduct");
    const byKey = new Map(
      drafts.map((c) => [(c.args[1] as { idempotencyKey: string }).idempotencyKey, c.shopDomain]),
    );
    expect(byKey.get(ids.a3)).toBe(SHOP_A);
    expect(byKey.get(ids.b3)).toBe(SHOP_B);
  });
});

describe("workspace B with workspace A's ids", () => {
  it("every M2 read and mutation on A's productId is a 404 and A is unchanged", async () => {
    const before = await snapshotA();
    const b = w.b.owner;
    const s = ids.supplierA;
    const attempts: [string, () => Promise<unknown>][] = [
      ["getProductPipeline", () => getProductPipeline(b, ids.a3)],
      ["listSuppliers", () => listSuppliers(b, ids.a2)],
      [
        "quoteSupplierChoice",
        () => quoteSupplierChoice(b, { productId: ids.a2, supplierMatchId: s }),
      ],
      [
        "selectSupplier",
        () =>
          selectSupplier(b, { productId: ids.a2, supplierMatchId: s, acceptLowMargin: true }, deps),
      ],
      [
        "selectSupplier (B's store)",
        () =>
          selectSupplier(
            b,
            {
              productId: ids.a2,
              supplierMatchId: s,
              shopifyConnectionId: ids.shopB,
              acceptLowMargin: true,
            },
            deps,
          ),
      ],
      ["rejectSuppliers", () => rejectSuppliers(b, { productId: ids.a2, note: "x" }, deps)],
      [
        "approvePage",
        () => approvePage(b, { productId: ids.a3, copyVersion: ANY_COPY_VERSION }, deps),
      ],
      ["rejectPage", () => rejectPage(b, { productId: ids.a3, note: "x" }, deps)],
      ["regeneratePageCopy", () => regeneratePageCopy(b, { productId: ids.a3 }, deps)],
      [
        "updatePageCopy",
        () => updatePageCopy(b, { productId: ids.a3, copy: { title: "Hijacked" } }, deps),
      ],
      ["listShopifyTemplates", () => listShopifyTemplates(b, ids.shopA, deps)],
      [
        "setShopifyTemplate",
        () => setShopifyTemplate(b, { connectionId: ids.shopA, templateSuffix: null }, deps),
      ],
    ];
    for (const [name, call] of attempts) {
      const error = await failure(call());
      expect(error, name).toBeInstanceOf(NotFoundError);
      expect(error?.status, name).toBe(404);
    }
    // Every B role gets the same 404 (never a 403 that would confirm the id exists).
    for (const ctx of [w.b.mediaBuyer, w.b.creative, w.b.viewer]) {
      expect(await failure(getProductPipeline(ctx, ids.a3))).toBeInstanceOf(NotFoundError);
    }
    expect(await snapshotA()).toEqual(before);
  });

  it("A's supplierMatchId inside B's own GATE 2 request is refused like an unknown id", async () => {
    const before = await snapshotA();
    const b = w.b.creative;
    const foreign = await failure(
      selectSupplier(
        b,
        { productId: ids.b2, supplierMatchId: ids.supplierA, acceptLowMargin: true },
        deps,
      ),
    );
    const unknown = await failure(
      selectSupplier(
        b,
        { productId: ids.b2, supplierMatchId: crypto.randomUUID(), acceptLowMargin: true },
        deps,
      ),
    );
    expect(foreign).not.toBeNull();
    expect(foreign).toMatchObject({ code: unknown?.code, message: unknown?.message });
    const quoteForeign = await failure(
      quoteSupplierChoice(w.b.viewer, { productId: ids.b2, supplierMatchId: ids.supplierA }),
    );
    const quoteUnknown = await failure(
      quoteSupplierChoice(w.b.viewer, { productId: ids.b2, supplierMatchId: crypto.randomUUID() }),
    );
    expect(quoteForeign).toMatchObject({
      code: quoteUnknown?.code,
      message: quoteUnknown?.message,
    });

    // B's product did not move and nothing was recorded in B either.
    expect((await getProductPipeline(w.b.viewer, ids.b2)).status).toBe("awaiting_supplier_choice");
    expect(
      (await w.b.owner.db.select(approval)).filter(
        (a) => a.productId === ids.b2 && a.gate === "supplier_choice",
      ),
    ).toHaveLength(0);
    expect(await snapshotA()).toEqual(before);
  });

  it("A's shopifyConnectionId inside B's own GATE 2 request is refused like an unknown id", async () => {
    const before = await snapshotA();
    const input = (connectionId: string) => ({
      productId: ids.b2,
      supplierMatchId: ids.supplierB,
      shopifyConnectionId: connectionId,
      acceptLowMargin: true,
    });
    const foreign = await failure(selectSupplier(w.b.creative, input(ids.shopA), deps));
    const unknown = await failure(selectSupplier(w.b.creative, input(crypto.randomUUID()), deps));
    expect(foreign).not.toBeNull();
    expect(foreign).toMatchObject({ code: unknown?.code, message: unknown?.message });
    expect((await getProductPipeline(w.b.viewer, ids.b2)).status).toBe("awaiting_supplier_choice");
    expect(await snapshotA()).toEqual(before);
  });

  it("scoped-db: B cannot see, update or delete A's supplier_match / shopify_product / approval rows", async () => {
    const db = w.b.owner.db;
    const [pageA] = await w.a.owner.db.select(shopifyProduct, {
      where: eq(shopifyProduct.productId, ids.a3),
    });
    await expect(db.getById(supplierMatch, ids.supplierA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(db.getById(shopifyProduct, pageA!.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await db.select(supplierMatch)).every((r) => r.workspaceId === w.b.workspaceId)).toBe(
      true,
    );
    expect((await db.select(approval)).every((r) => r.workspaceId === w.b.workspaceId)).toBe(true);
    expect(
      await db.update(supplierMatch, { selected: true }, eq(supplierMatch.id, ids.supplierA)),
    ).toEqual([]);
    expect(
      await db.update(shopifyProduct, { status: "active" }, eq(shopifyProduct.id, pageA!.id)),
    ).toEqual([]);
    expect(await db.delete(supplierMatch, eq(supplierMatch.productId, ids.a2))).toEqual([]);
    // Upserting a listing on A's product id from B fails (composite tenant FK).
    await expect(
      upsertSupplierListing(db, ids.a2, {
        source: "aliexpress",
        url: "https://www.aliexpress.com/item/1005000000000001.html",
        title: "Injected listing",
        price: { amount: 1, currency: "USD" },
        shipping: null,
        leadTimeDays: null,
        images: [],
        variants: [],
        matchScore: 1,
      }),
    ).rejects.toThrow();
    expect(await w.a.owner.db.count(supplierMatch, eq(supplierMatch.productId, ids.a2))).toBe(
      (await getProductPipeline(w.a.viewer, ids.a2)).suppliers.length,
    );
  });

  it("workflow internals run with B's workspace cannot reach A's product, choice, copy or store", async () => {
    const before = await snapshotA();
    const sys = w.system(w.b.workspaceId);
    for (const step of ["source", "build"] as const) {
      await expect(
        runProductStep(sys, ids.a3, step, {
          integrations: deps.integrations!,
          limiter: createMemoryLimiter(),
          sleep: async () => undefined,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(loadChosenSupplier(sys, ids.a3)).rejects.toThrow(/No supplier was chosen/);
    expect(await loadCopyHint(sys.db, ids.a3)).toBeNull();
    await expect(
      getShopifyCredentialsFor(sys, deps.integrations!, ids.shopA),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await snapshotA()).toEqual(before);
  });

  it("durable wake-up tokens are namespaced by workspace, so B can never wake A's run", async () => {
    expect(gateHookToken(w.a.workspaceId, ids.a3, "content_approval")).not.toBe(
      gateHookToken(w.b.workspaceId, ids.a3, "content_approval"),
    );
    expect(resumeHookToken(w.a.workspaceId, ids.a3)).toContain(w.a.workspaceId);

    const resumed: string[] = [];
    const engine: DurableEngine = {
      startRun: async () => ({ runId: "r" }),
      resume: async (token) => {
        resumed.push(token);
      },
    };
    const pipeline = createDurablePipeline(engine, { sleep: async () => undefined });
    // Even if a B context reached the engine with A's product id, the token is B's.
    await pipeline
      .continueAfterGate(w.b.owner, ids.a3, "content_approval", "appr_x")
      .catch(() => undefined);
    expect(resumed).toEqual([gateHookToken(w.b.workspaceId, ids.a3, "content_approval")]);
  });

  it("B's own GATE 3 decisions only touch B's draft on B's store", async () => {
    const before = await snapshotA();
    const publishesBefore = calls.filter((c) => c.method === "publishProduct").length;
    const approved = await approvePage(
      w.b.creative,
      { productId: ids.b3, copyVersion: await copyVersionOf(w.b.viewer, ids.b3) },
      deps,
    );
    expect(approved.shopify).toMatchObject({
      connectionId: ids.shopB,
      shopDomain: SHOP_B,
      status: "active",
    });
    const publishes = calls.filter((c) => c.method === "publishProduct").slice(publishesBefore);
    expect(publishes.map((c) => c.shopDomain)).toEqual([SHOP_B]);
    // A's draft is still a draft, its GATE 3 page part still pending.
    const a = await getProductPipeline(w.a.viewer, ids.a3);
    expect(a.shopify?.status).toBe("draft");
    expect(a.contentParts.page).toBe("pending");
    expect(await snapshotA()).toEqual(before);
  });
});
