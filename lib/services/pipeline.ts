import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { findUnsafeClaims, sanitizeDescriptionHtml } from "@/lib/ai/copy-safety";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import { gatePermission } from "@/lib/auth/permissions";
import {
  IntegrationError,
  pageCopySchema,
  type PageCopy,
  type PageTemplateChoice,
  type Integrations,
  type ShopifyProductRef,
} from "@/lib/domain/contracts";
import {
  gateForStatus,
  missingGateParts,
  stepBackTarget,
  type GatePart,
} from "@/lib/domain/state-machine";
import {
  approval,
  brand,
  product,
  shopifyConnection,
  shopifyProduct,
  supplierMatch,
  video,
} from "@/lib/db/schema";
import { canWriteThemes } from "@/lib/integrations/shopify/config";
import { isPostingAudited } from "@/lib/integrations/tiktok-posting/config";
import { quoteSupplier, type SupplierQuote } from "@/lib/sourcing";
import type { UserWorkspaceContext, WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";
import { pageCopyVersion } from "@/lib/workflows/copy-version";
import {
  approvalState,
  decisionOrder,
  effectiveTemplateSuffix,
  evidenceOf,
  gatePartStates,
  loadSupplierChoice,
  loadVideosChoice,
  lockProduct,
  recordGateDecision,
  type SupplierChoicePayload,
} from "@/lib/workflows/gate-payloads";
import { latestFailedStep } from "@/lib/workflows/jobs";
import { resolvePageTemplate } from "@/lib/workflows/page-template";
import { applyProductEventTo } from "@/lib/workflows/product-status";
import type { SupplierDetails } from "@/lib/workflows/steps/source";
import {
  loadChosenSupplier,
  shopifyProductFields,
  syncShopifyDraft,
} from "@/lib/workflows/steps/build";

import { idSchema } from "./brands";
import { loadAdAccounts, loadCampaignDTO, loadProfiles, runningLaunch } from "./campaign-read";
import { resolveIntegrations, resolveNow, resolvePipeline, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import { getShopifyCredentialsFor } from "./internal/credentials";
import { loadDetail } from "./products";
import { enforceRebuildLimit } from "./rate-limit";
import type { ProductPipelineDTO, ShopifyPageDTO, SupplierDTO, SupplierQuoteDTO } from "./types";

/*
 * Pipeline services for M2: GATE 2 (supplier + prices) and GATE 3 (the page
 * part: approve and publish, reject, regenerate, edit). Every function checks
 * the role first, validates its input with zod, and returns DTOs.
 */

type ProductRow = Row<typeof product>;
type SupplierRow = Row<typeof supplierMatch>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/* Mapping ------------------------------------------------------------------ */

function toSupplierDTO(r: SupplierRow): SupplierDTO {
  const details = (r.details ?? {}) as Partial<SupplierDetails>;
  return {
    id: r.id,
    source: r.source,
    url: r.url,
    title: r.title,
    currency: r.currency,
    price: r.price,
    shipping: r.shipping,
    shippingCurrency: details.shippingCurrency ?? r.currency,
    leadTime: r.leadTime,
    images: r.images,
    variants: (details.variants ?? []).map((v) => ({ name: v.name, values: v.values })),
    matchScore: details.matchScore ?? 0,
    valueScore: details.valueScore ?? null,
    rating: details.rating ?? null,
    reviewCount: details.reviewCount ?? null,
    selected: r.selected,
    createdAt: iso(r.createdAt),
  };
}

/** Best quality/price ratio first (match score for listings stored before it), then best match. */
function bySupplierValue(a: SupplierDTO, b: SupplierDTO): number {
  return (
    (b.valueScore ?? b.matchScore) - (a.valueScore ?? a.matchScore) || b.matchScore - a.matchScore
  );
}

function toQuoteDTO(supplierMatchId: string, q: SupplierQuote): SupplierQuoteDTO {
  const m = q.margin;
  return {
    supplierMatchId,
    currency: q.currency,
    sellingPrice: q.sellingPrice,
    compareAtPrice: q.compareAtPrice,
    priceSource: q.priceSource,
    minimumPrice: q.minimumPrice,
    margin: {
      currency: m.currency,
      productCost: m.productCost,
      shippingCost: m.shippingCost,
      fees: m.fees,
      landedCost: m.landedCost,
      sellingPrice: m.sellingPrice,
      grossMargin: m.grossMargin,
      marginRate: m.marginRate,
      breakEvenCpa: m.breakEvenCpa,
      maxCpa: m.maxCpa,
      breakEvenRoas: m.breakEvenRoas,
      targetMarginRate: m.targetMarginRate,
      meetsTarget: m.meetsTarget,
    },
    warnings: q.warnings,
  };
}

function shopHandle(shopDomain: string) {
  return shopDomain.replace(/\.myshopify\.com$/, "");
}

/**
 * The Shopify page for the UI. URLs come from the fresh ref when the caller
 * just synced or published, else from the columns stored at the last sync
 * (no Shopify call), else are derived from the shop domain and handle.
 */
function toShopifyPageDTO(
  row: Row<typeof shopifyProduct>,
  shopDomain: string,
  ref?: ShopifyProductRef,
): ShopifyPageDTO {
  const numeric = row.shopifyProductId.split("/").pop() ?? row.shopifyProductId;
  const storefrontUrl = ref ? ref.onlineStoreUrl : row.storefrontUrl;
  return {
    connectionId: row.connectionId,
    shopDomain,
    shopifyProductId: row.shopifyProductId,
    handle: row.handle,
    status: row.status,
    adminUrl:
      ref?.adminUrl ??
      row.adminUrl ??
      `https://admin.shopify.com/store/${shopHandle(shopDomain)}/products/${numeric}`,
    storefrontUrl:
      storefrontUrl ??
      (row.status === "active" ? `https://${shopDomain}/products/${row.handle}` : null),
    previewUrl: ref?.previewUrl ?? row.previewUrl ?? null,
  };
}

/* Reads -------------------------------------------------------------------- */

export async function loadPipeline(
  ctx: WorkspaceContext,
  productId: string,
  ref?: ShopifyProductRef,
  now: Date = new Date(),
): Promise<ProductPipelineDTO> {
  const detail = await loadDetail(ctx, productId);
  const row = await ctx.db.getById(product, productId);
  const [
    brandRow,
    suppliers,
    choice,
    stores,
    contentParts,
    videosChoice,
    adAccounts,
    tiktokProfiles,
    campaignDTO,
    launch,
  ] = await Promise.all([
    ctx.db.getById(brand, row.brandId),
    ctx.db.select(supplierMatch, {
      where: eq(supplierMatch.productId, row.id),
      orderBy: (t) => [desc(t.selected), t.createdAt],
    }),
    loadSupplierChoice(ctx.db, row.id),
    ctx.db.select(shopifyConnection, {
      where: eq(shopifyConnection.brandId, row.brandId),
      orderBy: (t) => t.createdAt,
    }),
    gatePartStates(ctx.db, row.id, "content_approval"),
    loadVideosChoice(ctx.db, row.id),
    loadAdAccounts(ctx.db, row.brandId),
    loadProfiles(ctx.db, row.brandId),
    loadCampaignDTO(ctx, row.id, now),
    row.status === "ready_to_launch" ? runningLaunch(ctx.db, row.id, now) : null,
  ]);

  let shopify: ShopifyPageDTO | null = null;
  if (choice) {
    const page = await ctx.db.findFirst(
      shopifyProduct,
      and(
        eq(shopifyProduct.productId, row.id),
        eq(shopifyProduct.connectionId, choice.shopifyConnectionId),
      ),
    );
    const store = stores.find((s) => s.id === choice.shopifyConnectionId);
    if (page && store) shopify = toShopifyPageDTO(page, store.shopDomain, ref);
  }

  // Claim time of an in-flight page publish, so the UI can offer to retry
  // the approval once approvePage would take the claim over.
  const claim =
    contentParts.page === "publishing" ? await publishingPageClaim(ctx.db, row.id) : null;

  // Best value first (quality/price ratio), the selected one first.
  const supplierDTOs = suppliers
    .map(toSupplierDTO)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || bySupplierValue(a, b));

  return {
    ...detail,
    currency: brandRow.currency,
    minMargin: brandRow.minMargin,
    suppliers: supplierDTOs,
    supplierChoice: choice
      ? {
          approvalId: choice.approvalId,
          supplierMatchId: choice.supplierMatchId,
          shopifyConnectionId: choice.shopifyConnectionId,
          templateSuffix: effectiveTemplateSuffix(
            choice,
            stores.find((s) => s.id === choice.shopifyConnectionId)?.templateSuffix ?? null,
          ),
          fxRate: choice.fxRate,
          warnings: choice.warnings,
        }
      : null,
    shopifyStores: stores.map((s) => ({
      id: s.id,
      shopDomain: s.shopDomain,
      status: s.status,
      templateSuffix: s.templateSuffix,
      canWriteThemes: canWriteThemes(s.scopes),
    })),
    pageTemplate: choice
      ? resolvePageTemplate(
          row,
          choice,
          stores.find((s) => s.id === choice.shopifyConnectionId)?.templateSuffix ?? null,
        )
      : null,
    pageCopy: row.pageCopy,
    pageCopyGeneratedAt: isoOrNull(row.pageCopyGeneratedAt),
    pageCopyVersion: pageCopyVersion(row.pageCopy),
    shopify,
    contentParts,
    pagePublishClaim: claim
      ? { startedAt: claim.createdAt.toISOString(), stale: isStaleClaim(claim, now) }
      : null,
    videosChoice: videosChoice
      ? {
          approvalId: videosChoice.approvalId,
          videoIds: videosChoice.videoIds,
          adConnectionId: videosChoice.adConnectionId,
        }
      : null,
    adAccounts,
    tiktokProfiles,
    campaign: campaignDTO,
    launchClaim: launch ? { startedAt: launch.startedAt.toISOString(), stale: launch.stale } : null,
    postingAudited: isPostingAudited(),
  };
}

/** Everything the product detail screen needs: jobs, suppliers, prices, page copy, Shopify page. */
export async function getProductPipeline(
  ctx: WorkspaceContext,
  productId: string,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "product:read");
  return loadPipeline(ctx, idSchema.parse(productId), undefined, resolveNow(deps)());
}

export async function listSuppliers(
  ctx: WorkspaceContext,
  productId: string,
): Promise<SupplierDTO[]> {
  requirePermission(ctx, "product:read");
  const id = idSchema.parse(productId);
  await ctx.db.getById(product, id);
  const rows = await ctx.db.select(supplierMatch, {
    where: eq(supplierMatch.productId, id),
    orderBy: (t) => t.createdAt,
  });
  return rows.map(toSupplierDTO).sort(bySupplierValue);
}

/* GATE 2: quote and selection ---------------------------------------------- */

const priceOverridesSchema = z.object({
  /** Units of the brand currency per unit of the listing currency (listing in another currency). */
  fxRate: z.number().positive().finite().optional(),
  /** Manual selling price (else the brand pricing rule / min-margin floor). */
  sellingPrice: z.number().positive().max(1_000_000).optional(),
  /** Manual compare-at price; null removes it. */
  compareAtPrice: z.number().positive().max(1_000_000).nullable().optional(),
  /** Packaging, inserts, fulfilment per order, in the brand currency. */
  otherCosts: z.number().nonnegative().max(1_000_000).optional(),
});

const quoteSchema = priceOverridesSchema.extend({
  productId: idSchema,
  supplierMatchId: idSchema,
});

async function loadSupplierOf(db: ScopedDb, productId: string, supplierMatchId: string) {
  const row = await db.findFirst(
    supplierMatch,
    and(eq(supplierMatch.id, supplierMatchId), eq(supplierMatch.productId, productId)),
  );
  if (!row)
    throw new ServiceError("invalid_input", "This supplier is not a match of this product.");
  return row;
}

function quoteFor(
  supplier: SupplierRow,
  brandRow: Row<typeof brand>,
  v: z.infer<typeof priceOverridesSchema>,
): SupplierQuote {
  const details = (supplier.details ?? {}) as Partial<SupplierDetails>;
  try {
    return quoteSupplier({
      listing: {
        price: { amount: supplier.price, currency: supplier.currency },
        shipping:
          supplier.shipping === null
            ? null
            : {
                amount: supplier.shipping,
                currency: details.shippingCurrency ?? supplier.currency,
              },
      },
      currency: brandRow.currency,
      pricingRule: brandRow.pricingRule,
      minMargin: brandRow.minMargin,
      ...(v.fxRate !== undefined ? { fxRate: v.fxRate } : {}),
      ...(v.otherCosts !== undefined ? { otherCosts: v.otherCosts } : {}),
      ...(v.sellingPrice !== undefined ? { sellingPrice: v.sellingPrice } : {}),
      ...(v.compareAtPrice !== undefined ? { compareAtPrice: v.compareAtPrice } : {}),
    });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "invalid_input") {
      throw new ServiceError("invalid_input", error.message);
    }
    throw error;
  }
}

/** GATE 2 preview: suggested prices and margin for one listing (nothing is recorded). */
export async function quoteSupplierChoice(
  ctx: WorkspaceContext,
  input: z.input<typeof quoteSchema>,
): Promise<SupplierQuoteDTO> {
  requirePermission(ctx, "product:read");
  const v = quoteSchema.parse(input);
  const row = await ctx.db.getById(product, v.productId);
  const supplier = await loadSupplierOf(ctx.db, row.id, v.supplierMatchId);
  const brandRow = await ctx.db.getById(brand, row.brandId);
  return toQuoteDTO(supplier.id, quoteFor(supplier, brandRow, v));
}

const selectSupplierSchema = quoteSchema.extend({
  /** Target store; optional when the brand has exactly one active store. */
  shopifyConnectionId: idSchema.optional(),
  /**
   * Product template of the store's theme the page is built on (null =
   * templates/product.json). Omitted: the store's default template.
   */
  templateSuffix: z.string().min(1).max(100).nullable().optional(),
  /**
   * "generate": Claude designs a conversion-oriented template for this
   * product from the theme sections, on top of `templateSuffix` (base).
   * Needs the store to have granted write_themes.
   */
  templateMode: z.enum(["existing", "generate"]).default("existing"),
  /** generate: the designed sections may show the product photos. */
  templateWithImages: z.boolean().default(false),
  /** Required to go on with a margin below the brand minimum. */
  acceptLowMargin: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
});

/** Store statuses GATE 2 accepts: needs_reauth, revoked, disconnected and pending are refused. */
const USABLE_STORE_STATUSES: ReadonlySet<string> = new Set(["active", "expiring"]);

async function resolveStore(
  db: ScopedDb,
  brandId: string,
  connectionId: string | undefined,
): Promise<Row<typeof shopifyConnection>> {
  const stores = await db.select(shopifyConnection, {
    where: eq(shopifyConnection.brandId, brandId),
    orderBy: (t) => t.createdAt,
  });
  // "expiring" stores still hold a working token (the UI shows a reconnect warning).
  const active = stores.filter((s) => USABLE_STORE_STATUSES.has(s.status));
  if (connectionId) {
    const store = stores.find((s) => s.id === connectionId);
    if (!store)
      throw new ServiceError("invalid_input", "This store is not connected to the brand.");
    if (!USABLE_STORE_STATUSES.has(store.status)) {
      throw new ServiceError("precondition_failed", "This Shopify store needs to be reconnected.");
    }
    return store;
  }
  if (active.length === 1) return active[0]!;
  if (active.length === 0) {
    throw new ServiceError(
      "precondition_failed",
      "Connect a Shopify store to this brand before choosing a supplier.",
    );
  }
  throw new ServiceError("invalid_input", "This brand has several stores: choose one.");
}

/**
 * A named template must exist in the store's live theme; a generated one also
 * needs the store to have granted write_themes (Shopify exemption).
 */
async function assertTemplateUsable(
  ctx: WorkspaceContext,
  store: Row<typeof shopifyConnection>,
  suffix: string | null,
  mode: PageTemplateChoice["mode"],
  deps: ServiceDeps,
): Promise<void> {
  if (mode === "generate" && !canWriteThemes(store.scopes)) {
    throw new ServiceError(
      "precondition_failed",
      "This store does not allow Trendcart to add templates to its theme (write_themes). Use an existing template, or reconnect the store once theme writes are enabled.",
    );
  }
  if (suffix === null) return;
  const integrations = resolveIntegrations(deps);
  const { creds } = await getShopifyCredentialsFor(ctx, integrations, store.id);
  const suffixes = await integrations.shopify.listProductTemplates(creds);
  if (!suffixes.includes(suffix)) {
    throw new ServiceError(
      "invalid_input",
      `The store's theme has no "product.${suffix}" template.`,
    );
  }
}

/**
 * GATE 2: a human picks one supplier listing, the target store, and confirms
 * the prices (brand pricing rule, min-margin floor, or manual). Records the
 * approval (payload: SupplierChoicePayload), marks the listing selected,
 * stores selling/compare-at prices and the margin on the product, moves
 * awaiting_supplier_choice → building_page_and_videos and audits, all in one
 * transaction, then wakes the pipeline (build step).
 */
export async function selectSupplier(
  ctx: WorkspaceContext,
  input: z.input<typeof selectSupplierSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:supplier_choice");
  const v = selectSupplierSchema.parse(input);
  const userId = ctx.actor.userId;

  // A named template must exist in the store's live theme (checked before the
  // transaction: it is a Shopify call). The store is resolved again inside.
  let checkedStoreId: string | null = null;
  if (typeof v.templateSuffix === "string" || v.templateMode === "generate") {
    const pre = await ctx.db.getById(product, v.productId);
    const store = await resolveStore(ctx.db, pre.brandId, v.shopifyConnectionId);
    await assertTemplateUsable(ctx, store, v.templateSuffix ?? null, v.templateMode, deps);
    checkedStoreId = store.id;
  }

  const approvalId = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    if (row.status !== "awaiting_supplier_choice") {
      throw new ServiceError("invalid_state", "This product is not waiting for a supplier choice.");
    }
    const supplier = await loadSupplierOf(tx, row.id, v.supplierMatchId);
    const brandRow = await tx.getById(brand, row.brandId);
    const store = await resolveStore(tx, row.brandId, v.shopifyConnectionId);
    if (checkedStoreId !== null && checkedStoreId !== store.id) {
      throw new ServiceError("conflict", "The brand's stores changed meanwhile. Try again.");
    }
    // Recorded as decided: later changes of the store default do not move this page.
    const templateSuffix = v.templateSuffix !== undefined ? v.templateSuffix : store.templateSuffix;
    const pageTemplate: PageTemplateChoice = {
      mode: v.templateMode,
      suffix: templateSuffix,
      withImages: v.templateMode === "generate" && v.templateWithImages,
      generated: null,
    };
    const quote = quoteFor(supplier, brandRow, v);
    if (!quote.margin.meetsTarget && !v.acceptLowMargin) {
      throw new ServiceError(
        "precondition_failed",
        quote.warnings[0] ?? "The margin is below the brand minimum. Confirm to go on anyway.",
      );
    }

    const payload: SupplierChoicePayload = {
      supplierMatchId: supplier.id,
      shopifyConnectionId: store.id,
      templateSuffix,
      templateMode: v.templateMode,
      sellingPrice: quote.sellingPrice,
      compareAtPrice: quote.compareAtPrice,
      priceSource: quote.priceSource,
      fxRate: v.fxRate ?? null,
      otherCosts: v.otherCosts ?? 0,
      marginRate: quote.margin.marginRate,
      meetsTarget: quote.margin.meetsTarget,
      warnings: quote.warnings,
    };
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "supplier_choice",
      userId,
      decision: "approved",
      note: v.note ?? null,
      payload,
    });
    await tx.update(supplierMatch, { selected: false }, eq(supplierMatch.productId, row.id));
    await tx.update(supplierMatch, { selected: true }, eq(supplierMatch.id, supplier.id));

    const m = quote.margin;
    await applyProductEventTo(
      tx,
      row,
      { type: "gate_approved", productId: row.id, approval: evidenceOf(recorded) },
      {
        sellingPrice: quote.sellingPrice,
        compareAtPrice: quote.compareAtPrice,
        pageTemplate,
        margin: {
          currency: m.currency,
          productCost: m.productCost,
          shippingCost: m.shippingCost,
          fees: m.fees,
          landedCost: m.landedCost,
          sellingPrice: m.sellingPrice,
          grossMargin: m.grossMargin,
          marginRate: m.marginRate,
        },
      },
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.approve",
        targetType: "product",
        targetId: row.id,
        metadata: {
          gate: "supplier_choice",
          approvalId: recorded.id,
          supplierMatchId: supplier.id,
          shopifyConnectionId: store.id,
          templateSuffix,
          templateMode: v.templateMode,
          sellingPrice: quote.sellingPrice,
          priceSource: quote.priceSource,
          meetsTarget: m.meetsTarget,
        },
      },
    );
    return recorded.id;
  });

  await resolvePipeline(deps).continueAfterGate(ctx, v.productId, "supplier_choice", approvalId);
  return loadPipeline(ctx, v.productId);
}

const gateNoteSchema = z.object({
  productId: idSchema,
  note: z.string().trim().max(2000).optional(),
});

/**
 * Before a paid rebuild (supplier re-search, page copy rewrite): the product
 * exists in this workspace (404 first), is at the expected gate (a refused
 * action does not use the quota), then the hourly limits (QA S5).
 */
async function assertRebuildAllowed(
  ctx: WorkspaceContext,
  productId: string,
  status: ProductRow["status"],
  deps: ServiceDeps,
) {
  const row = await ctx.db.getById(product, productId);
  if (row.status !== status) return; // the transaction refuses it with the precise message
  await enforceRebuildLimit(ctx.workspaceId, row.id, deps);
}

/**
 * GATE 2 rejection ("none of these"): records it, removes the listings and
 * moves awaiting_supplier_choice → sourcing in one transaction, audits, then
 * runs the source step again.
 */
export async function rejectSuppliers(
  ctx: WorkspaceContext,
  input: z.input<typeof gateNoteSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:supplier_choice");
  const v = gateNoteSchema.parse(input);
  const userId = ctx.actor.userId;
  await assertRebuildAllowed(ctx, v.productId, "awaiting_supplier_choice", deps);

  const approvalId = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    if (row.status !== "awaiting_supplier_choice") {
      throw new ServiceError("invalid_state", "This product is not waiting for a supplier choice.");
    }
    const removed = await tx.delete(supplierMatch, eq(supplierMatch.productId, row.id));
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "supplier_choice",
      userId,
      decision: "rejected",
      note: v.note ?? null,
      // Read back by the source step as `excludeUrls` for the next search.
      payload: { rejectedUrls: removed.map((r) => r.url).slice(0, 50) },
    });
    await applyProductEventTo(tx, row, {
      type: "gate_rejected",
      productId: row.id,
      approval: evidenceOf(recorded),
    });
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.reject",
        targetType: "product",
        targetId: row.id,
        metadata: { gate: "supplier_choice", approvalId: recorded.id, removed: removed.length },
      },
    );
    return recorded.id;
  });

  await resolvePipeline(deps).restartAfterRejection(
    ctx,
    v.productId,
    "supplier_choice",
    approvalId,
  );
  return loadPipeline(ctx, v.productId);
}

/* GATE 3: the page part ---------------------------------------------------- */

/**
 * The page approval of this product that has been "publishing" for longer
 * than STALE_PUBLISH_CLAIM_MS, if any (only at GATE 3).
 */
async function staleClaimOf(db: ScopedDb, row: ProductRow, now: Date) {
  if (row.status !== "awaiting_content_approval") return null;
  const latest = await publishingPageClaim(db, row.id);
  return latest && isStaleClaim(latest, now) ? latest : null;
}

/** The latest page approval of the product, if it is still "publishing". */
async function publishingPageClaim(db: ScopedDb, productId: string) {
  const rows = await db.select(approval, {
    where: and(eq(approval.productId, productId), eq(approval.gate, "content_approval")),
    orderBy: decisionOrder,
  });
  const latest = rows.find((r) => r.payload?.part === "page" && approvalState(r) !== "voided");
  return latest && approvalState(latest) === "publishing" ? latest : null;
}

function isStaleClaim(claim: { createdAt: Date }, now: Date): boolean {
  return now.getTime() - claim.createdAt.getTime() > STALE_PUBLISH_CLAIM_MS;
}

async function assertPageOpen(db: ScopedDb, row: ProductRow) {
  if (row.status !== "awaiting_content_approval") {
    throw new ServiceError("invalid_state", "This product is not waiting for a content approval.");
  }
  const parts = await gatePartStates(db, row.id, "content_approval");
  if (parts.page === "approved") {
    throw new ServiceError("invalid_state", "The page was already approved and published.");
  }
  if (parts.page === "publishing") {
    throw new ServiceError("invalid_state", "The page is being published. Try again in a moment.");
  }
  return parts;
}

function requireCopy(row: ProductRow): PageCopy {
  if (!row.pageCopy) throw new ServiceError("invalid_state", "This product has no page copy yet.");
  return pageCopySchema.parse(row.pageCopy);
}

/**
 * A page approval left "publishing" for longer than this (the process died
 * between the claim and the final transaction) may be claimed again by
 * approvePage, which re-runs the idempotent sync and publish.
 */
export const STALE_PUBLISH_CLAIM_MS = 5 * 60 * 1000;

const approvePageSchema = gateNoteSchema.extend({
  /** `pageCopyVersion` from the ProductPipelineDTO the reviewer loaded. */
  copyVersion: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{16}$/, "Invalid copy version."),
});

type PageClaim = {
  approvalId: string;
  row: ProductRow;
  copy: PageCopy;
  choice: SupplierChoicePayload;
  supplier: SupplierRow;
};

/** Code of an error for audit metadata (never its message). */
function errorCode(error: unknown): string {
  if (error instanceof IntegrationError || error instanceof ServiceError) return error.code;
  return "unknown";
}

/**
 * Undoes a page approval whose publish failed, if this call still owns the
 * claim (a claim re-taken after STALE_PUBLISH_CLAIM_MS belongs to someone
 * else: nothing is touched). The Shopify product goes back to DRAFT
 * (unpublishProduct, idempotent), the approval is voided (kept as history,
 * payload.state "voided") so the page part reopens, and page.publish_revert
 * is audited with error codes only.
 */
async function revertPageApproval(
  ctx: UserWorkspaceContext,
  integrations: Integrations,
  claim: PageClaim,
  shopify: { productId: string; rowId: string } | null,
  cause: unknown,
): Promise<void> {
  const owned = await ctx.db.findById(approval, claim.approvalId);
  if (!owned || approvalState(owned) !== "publishing") return;

  let reverted: ShopifyProductRef | null = null;
  let revertError: string | null = null;
  if (shopify) {
    try {
      const { creds } = await getShopifyCredentialsFor(
        ctx,
        integrations,
        claim.choice.shopifyConnectionId,
      );
      reverted = await integrations.shopify.unpublishProduct(creds, shopify.productId);
    } catch (error) {
      revertError = errorCode(error);
      console.error("[approvePage] could not set the Shopify product back to DRAFT", error);
    }
  }
  // Nothing on Shopify yet (the sync failed): the store holds no page to revert.
  const isDraft = shopify === null || reverted !== null;

  await ctx.db.transaction(async (tx) => {
    await lockProduct(tx, claim.row.id);
    const recorded = await tx.findById(approval, claim.approvalId);
    if (!recorded || approvalState(recorded) !== "publishing") return;
    await tx.update(
      approval,
      {
        payload: {
          ...recorded.payload,
          state: "voided",
          voidReason: "publish_failed",
          shopifyReverted: isDraft,
        },
      },
      eq(approval.id, claim.approvalId),
    );
    if (reverted && shopify) {
      await tx.update(
        shopifyProduct,
        { ...shopifyProductFields(reverted), status: "draft" },
        eq(shopifyProduct.id, shopify.rowId),
      );
    }
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "page.publish_revert",
        targetType: "product",
        targetId: claim.row.id,
        metadata: {
          approvalId: claim.approvalId,
          shopifyProductId: shopify?.productId ?? null,
          reverted: isDraft,
          error: errorCode(cause),
          ...(revertError ? { revertError } : {}),
        },
      },
    );
  });
}

/**
 * GATE 3, page part: a human approves the page they loaded (`copyVersion`).
 *
 * 1. Claim, in one transaction under the product lock: the product is still
 *    at GATE 3, the page part is still open and the stored copy still has
 *    `copyVersion` (else invalid_state "The page changed since you loaded
 *    it."). The approval is recorded (payload { part: "page", state:
 *    "publishing" }): from here the page part is "publishing", so a
 *    concurrent approve, reject, regenerate or edit is refused. A claim
 *    older than STALE_PUBLISH_CLAIM_MS is voided ("stale_claim") and taken
 *    over.
 * 2. Outside the transaction: the Shopify draft is synced with the approved
 *    copy, then published (ACTIVE + Online Store; idempotent).
 * 3. Second transaction: approval state "published", shopify_product active,
 *    audits gate.approve and page.publish; when every GATE 3 part is approved
 *    (videos: M3) the product moves to preparing_campaign and the pipeline
 *    continues.
 * If 2 or 3 fails: the product is set back to DRAFT, the approval is voided
 * (the gate reopens), page.publish_revert is audited, and the error is
 * rethrown.
 */
export async function approvePage(
  ctx: WorkspaceContext,
  input: z.input<typeof approvePageSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval", "page:publish");
  const v = approvePageSchema.parse(input);
  const userId = ctx.actor.userId;
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);

  // 1. Claim the gate (or take over a stale claim).
  const claim: PageClaim = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    const stale = await staleClaimOf(tx, row, now());
    if (stale) {
      await tx.update(
        approval,
        { payload: { ...stale.payload, state: "voided", voidReason: "stale_claim" } },
        eq(approval.id, stale.id),
      );
    }
    await assertPageOpen(tx, row);
    const copy = requireCopy(row);
    if (pageCopyVersion(row.pageCopy) !== v.copyVersion) {
      throw new ServiceError("invalid_state", "The page changed since you loaded it.", {
        reason: "copy_changed",
      });
    }
    const { choice, supplier } = await loadChosenSupplier({ ...ctx, db: tx }, row.id);
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "content_approval",
      userId,
      decision: "approved",
      note: v.note ?? null,
      payload: {
        part: "page",
        kind: "approve",
        state: "publishing",
        copyVersion: v.copyVersion,
        shopifyConnectionId: choice.shopifyConnectionId,
      },
    });
    return { approvalId: recorded.id, row, copy, choice, supplier };
  });

  // 2. Sync and publish on Shopify.
  let page: { productId: string; rowId: string } | null = null;
  let published: ShopifyProductRef;
  try {
    const synced = await syncShopifyDraft(ctx, integrations, claim.row, claim);
    page = { productId: synced.ref.productId, rowId: synced.shopifyProduct.id };
    const { creds } = await getShopifyCredentialsFor(
      ctx,
      integrations,
      claim.choice.shopifyConnectionId,
    );
    published = await integrations.shopify.publishProduct(creds, synced.ref.productId);
  } catch (error) {
    await revertPageApproval(ctx, integrations, claim, page, error);
    throw error;
  }
  const target = page;

  // 3. Record the publish and move on.
  let complete: boolean;
  try {
    complete = await ctx.db.transaction(async (tx) => {
      const current = await lockProduct(tx, claim.row.id);
      const recorded = await tx.getById(approval, claim.approvalId);
      if (approvalState(recorded) !== "publishing") {
        throw new ServiceError("conflict", "This page approval was cancelled in the meantime.");
      }
      await tx.update(
        approval,
        {
          payload: {
            ...recorded.payload,
            state: "published",
            shopifyProductId: published.productId,
          },
        },
        eq(approval.id, recorded.id),
      );
      await tx.update(
        shopifyProduct,
        // Status "active" whatever the ref says: publishing succeeded.
        { ...shopifyProductFields(published), status: "active" },
        eq(shopifyProduct.id, target.rowId),
      );
      const parts = await gatePartStates(tx, current.id, "content_approval");
      const approved: GatePart[] = [
        "page",
        ...(parts.videos === "approved" ? ["videos" as const] : []),
      ];
      const done = missingGateParts("content_approval", approved).length === 0;
      if (done) {
        await applyProductEventTo(tx, current, {
          type: "gate_approved",
          productId: current.id,
          approval: evidenceOf(recorded, approved),
        });
      }
      const audit = { ...ctx, db: tx };
      await writeAudit(audit, {
        action: "gate.approve",
        targetType: "product",
        targetId: current.id,
        metadata: {
          gate: "content_approval",
          part: "page",
          approvalId: recorded.id,
          copyVersion: v.copyVersion,
          complete: done,
        },
      });
      await writeAudit(audit, {
        action: "page.publish",
        targetType: "shopify_product",
        targetId: target.rowId,
        metadata: {
          productId: current.id,
          shopifyProductId: published.productId,
          shopifyConnectionId: claim.choice.shopifyConnectionId,
        },
      });
      return done;
    });
  } catch (error) {
    await revertPageApproval(ctx, integrations, claim, target, error);
    throw error;
  }

  if (complete) {
    await resolvePipeline(deps).continueAfterGate(
      ctx,
      claim.row.id,
      "content_approval",
      claim.approvalId,
    );
  }
  return loadPipeline(ctx, claim.row.id, published);
}

async function sendPageBack(
  ctx: UserWorkspaceContext,
  v: z.infer<typeof gateNoteSchema>,
  kind: "reject" | "regenerate" | "template",
  deps: ServiceDeps,
  /** Set with the cleared copy, in the same transaction (template change). */
  pageTemplate?: PageTemplateChoice,
): Promise<ProductPipelineDTO> {
  const userId = ctx.actor.userId;
  await assertRebuildAllowed(ctx, v.productId, "awaiting_content_approval", deps);
  const approvalId = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    await assertPageOpen(tx, row);
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "content_approval",
      userId,
      decision: "rejected",
      note: v.note ?? null,
      payload: { part: "page", kind, previousCopy: row.pageCopy },
    });
    await applyProductEventTo(
      tx,
      row,
      { type: "gate_rejected", productId: row.id, approval: evidenceOf(recorded) },
      // Cleared copy = the build step writes a new one (same Shopify draft).
      { pageCopy: null, pageCopyGeneratedAt: null, ...(pageTemplate ? { pageTemplate } : {}) },
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.reject",
        targetType: "product",
        targetId: row.id,
        metadata: {
          gate: "content_approval",
          part: "page",
          kind,
          approvalId: recorded.id,
          hasNote: !!v.note,
          ...(pageTemplate
            ? { templateMode: pageTemplate.mode, templateSuffix: pageTemplate.suffix }
            : {}),
        },
      },
    );
    return recorded.id;
  });

  await resolvePipeline(deps).restartAfterRejection(
    ctx,
    v.productId,
    "content_approval",
    approvalId,
  );
  return loadPipeline(ctx, v.productId);
}

/**
 * GATE 3 page rejection with an optional note: records it, clears the copy,
 * moves awaiting_content_approval → building_page_and_videos, audits, then
 * the build step writes new copy and updates the same Shopify draft.
 * Refused once the page was approved (publishing or published). Rate-limited
 * (a new copy is a paid AI call).
 */
export async function rejectPage(
  ctx: WorkspaceContext,
  input: z.input<typeof gateNoteSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval");
  return sendPageBack(ctx, gateNoteSchema.parse(input), "reject", deps);
}

const changeTemplateSchema = z.object({
  productId: idSchema,
  mode: z.enum(["existing", "generate"]),
  /** existing: the template; generate: the base template. null = product.json. */
  templateSuffix: z.string().min(1).max(100).nullable(),
  /** generate: the designed sections may show the product photos. */
  withImages: z.boolean().default(false),
});

/**
 * GATE 3: rebuild the page on another template, or have Claude design a CRO
 * template for it. Checked like GATE 2 (template exists, write_themes for
 * "generate"), then recorded, audited and rate-limited like a regeneration:
 * the copy is cleared and the build step writes a new page on that template.
 */
export async function changePageTemplate(
  ctx: WorkspaceContext,
  input: z.input<typeof changeTemplateSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval");
  const v = changeTemplateSchema.parse(input);
  const row = await ctx.db.getById(product, v.productId);
  await assertPageOpen(ctx.db, row);
  const choice = await loadSupplierChoice(ctx.db, row.id);
  if (!choice) throw new ServiceError("invalid_state", "This product has no supplier choice.");
  const store = await ctx.db.getById(shopifyConnection, choice.shopifyConnectionId);
  await assertTemplateUsable(ctx, store, v.templateSuffix, v.mode, deps);
  return sendPageBack(ctx, { productId: row.id }, "template", deps, {
    mode: v.mode,
    suffix: v.templateSuffix,
    withImages: v.mode === "generate" && v.withImages,
    generated: null,
  });
}

/** Same as rejectPage without a verdict: "write it again". Recorded, audited and limited the same way. */
export async function regeneratePageCopy(
  ctx: WorkspaceContext,
  input: { productId: string },
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval");
  const v = gateNoteSchema.parse({ productId: input.productId });
  return sendPageBack(ctx, v, "regenerate", deps);
}

const pageCopyPatchSchema = z.object({
  productId: idSchema,
  copy: pageCopySchema.partial().strict(),
});

/**
 * Edits page copy fields before GATE 3 (title, description, highlights, FAQ,
 * guarantee, ad texts, SEO). The description HTML is sanitized (simple
 * formatting tags only) before it is stored or sent; the merged copy is
 * validated with pageCopySchema and must pass the copy-safety guard (fake
 * reviews, counts, health claims...: refused with invalid_input naming the
 * rules and fields, no override). It is stored under the product lock
 * (refused once the page is approved, conflict if someone else changed the
 * copy meanwhile), then pushed to the same Shopify draft. A new copy has a
 * new pageCopyVersion.
 */
export async function updatePageCopy(
  ctx: WorkspaceContext,
  input: z.input<typeof pageCopyPatchSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval");
  const v = pageCopyPatchSchema.parse(input);
  const integrations = resolveIntegrations(deps);

  const row = await ctx.db.getById(product, v.productId);
  await assertPageOpen(ctx.db, row);
  const previous = requireCopy(row);
  const merged = { ...previous, ...v.copy };
  const copy = pageCopySchema.parse({
    ...merged,
    descriptionHtml: sanitizeDescriptionHtml(merged.descriptionHtml),
  });
  const claims = findUnsafeClaims(copy);
  if (claims.length > 0) {
    const list = claims.map((c) => `${c.field}: ${c.rule.replace(/_/g, " ")}`).join("; ");
    throw new ServiceError(
      "invalid_input",
      `The copy makes claims that are not allowed (${list}). Remove them and save again.`,
    );
  }
  const changed = changedCopyFields(previous, copy);
  const versionBefore = pageCopyVersion(row.pageCopy);

  const updated = await ctx.db.transaction(async (tx) => {
    const current = await lockProduct(tx, row.id);
    await assertPageOpen(tx, current);
    if (pageCopyVersion(current.pageCopy) !== versionBefore) {
      throw new ServiceError(
        "conflict",
        "This product was updated by someone else in the meantime. Refresh and try again.",
      );
    }
    const [saved] = await tx.update(product, { pageCopy: copy }, (p) => eq(p.id, row.id));
    return saved!;
  });

  const { choice, supplier } = await loadChosenSupplier(ctx, row.id);
  const synced = await syncShopifyDraft(ctx, integrations, updated, { choice, supplier, copy });
  // Field names only: the copy itself is on the product and on Shopify.
  await writeAudit(ctx, {
    action: "page.update",
    targetType: "product",
    targetId: row.id,
    metadata: {
      fields: changed,
      shopifyProductId: synced.ref.productId,
      shopifyConnectionId: choice.shopifyConnectionId,
    },
  });
  return loadPipeline(ctx, row.id, synced.ref);
}

/** Names of the page copy fields whose value differs (no values). */
function changedCopyFields(before: PageCopy, after: PageCopy): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (k) =>
      JSON.stringify(before[k as keyof PageCopy]) !== JSON.stringify(after[k as keyof PageCopy]),
  );
}

/* Step back ---------------------------------------------------------------- */

/**
 * Sends a product back to the previous gate, without any AI call:
 * - GATE 2 (or a failed sourcing) → GATE 1: the listings are removed, so a
 *   new GATE 1 approval searches again.
 * - GATE 3 (or a failed build) → GATE 2: the listings stay (none selected)
 *   and the page copy is cleared, so the next build writes it for the new
 *   choice and updates the same Shopify draft. Refused once the page was
 *   approved (publishing or published).
 * GATE 2 prices and margin are cleared either way. The caller needs the
 * permission of the gate the product returns to. Audited (gate.step_back)
 * and rate-limited like a rebuild: going forward again costs a new search or
 * a new copy.
 */
export async function goBackOneStep(
  ctx: WorkspaceContext,
  input: z.input<typeof gateNoteSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "product:update");
  const v = gateNoteSchema.parse(input);

  const current = await ctx.db.getById(product, v.productId);
  const failedStep =
    current.status === "failed" ? await latestFailedStep(ctx.db, current.id) : null;
  const target = stepBackTarget(current.status, failedStep);
  if (!target) {
    throw new ServiceError("invalid_state", "This product has no previous step to go back to.");
  }
  requirePermission(ctx, gatePermission(gateForStatus(target)!));
  await enforceRebuildLimit(ctx.workspaceId, current.id, deps);

  const from = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    if (row.status !== current.status) {
      throw new ServiceError(
        "conflict",
        "This product was updated by someone else in the meantime. Refresh and try again.",
      );
    }
    if (target === "awaiting_supplier_choice") {
      const parts = await gatePartStates(tx, row.id, "content_approval");
      if (parts.page === "approved" || parts.page === "publishing") {
        throw new ServiceError(
          "invalid_state",
          "The page was already approved and published: it cannot go back to the supplier choice.",
        );
      }
      // Approved videos live on this store's product: reject them first.
      const onShopify = await tx.count(
        video,
        and(eq(video.productId, row.id), isNotNull(video.shopifyMediaId)),
      );
      if (onShopify > 0) {
        throw new ServiceError(
          "invalid_state",
          "Approved videos are on the Shopify page: reject them before going back to the supplier choice.",
        );
      }
    }
    let removed = 0;
    if (target === "awaiting_product_confirmation") {
      removed = (await tx.delete(supplierMatch, eq(supplierMatch.productId, row.id))).length;
    } else {
      await tx.update(supplierMatch, { selected: false }, eq(supplierMatch.productId, row.id));
    }
    await applyProductEventTo(
      tx,
      row,
      { type: "step_back", failedStep },
      {
        sellingPrice: null,
        compareAtPrice: null,
        margin: null,
        ...(target === "awaiting_supplier_choice"
          ? { pageCopy: null, pageCopyGeneratedAt: null }
          : {}),
      },
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.step_back",
        targetType: "product",
        targetId: row.id,
        metadata: {
          from: row.status,
          to: target,
          ...(failedStep ? { failedStep } : {}),
          removedListings: removed,
          hasNote: !!v.note,
        },
      },
    );
    return row.status;
  });

  await resolvePipeline(deps).wakeAfterStepBack(ctx, v.productId, from);
  return loadPipeline(ctx, v.productId);
}
