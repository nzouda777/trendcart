/**
 * Step "build": GATE 2 choice → page copy → Shopify draft
 * (building_page_and_videos → awaiting_content_approval, GATE 3).
 *
 * 1. Page copy: Copywriter.writePage through `metered`, validated with
 *    pageCopySchema, checked with the copy-safety guard (unsafe copy fails
 *    the step, retryable, and is neither stored nor pushed), and stored on
 *    the product right away (page_copy,
 *    page_copy_generated_at), so a retry after a Shopify failure does not pay
 *    for the copy again. A GATE 3 rejection / regeneration clears page_copy,
 *    which is what makes this step write a new one, with a CopyHint (the
 *    rejection notes and the title of the copy it replaces). No hint on a
 *    first build.
 * 2. Shopify draft on the store chosen at GATE 2: ensureMetafieldDefinitions,
 *    then createDraftProduct with idempotencyKey = product id (Shopify upserts
 *    on the `trendcart.product_id` custom ID), then shopify_product is
 *    upserted on (product, connection). Re-runs update the same draft.
 * 3. Videos (M3) plug in here: gather related videos and run compliance
 *    checks, each idempotent on (product, tiktok_url). Not in M2.
 *
 * Every Shopify call is idempotent and the whole step stays well under the
 * function limit (one AI call, three Admin API calls).
 */
import { and, eq } from "drizzle-orm";

import {
  copyHintSchema,
  IntegrationError,
  pageCopySchema,
  supplierListingSchema,
  type CopyHint,
  type Integrations,
  type PageCopy,
  type ShopifyProductRef,
  type SupplierListing,
} from "@/lib/domain/contracts";
import { findUnsafeClaims } from "@/lib/ai/copy-safety";
import { approval, brand, product, shopifyProduct, supplierMatch } from "@/lib/db/schema";
import { draftProductInputFromPageCopy } from "@/lib/integrations/shopify";
import { getShopifyCredentialsFor } from "@/lib/services/internal/credentials";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";

import { buildCallContext } from "../call-context";
import { decisionOrder, loadSupplierChoice, type SupplierChoicePayload } from "../gate-payloads";
import { draftImageUrls, safeVariantGroups, variantsFromListing } from "../page-input";
import type { SupplierDetails } from "./source";

import type { StepDefinition, StepEnv } from "./types";

type ProductRow = Row<typeof product>;
type SupplierRow = Row<typeof supplierMatch>;

/**
 * Copy-safety guard on whatever copy is about to be stored or pushed (any
 * copywriter, any fallback): fake reviews, counts, popularity, health claims,
 * guarantees, urgency. Unsafe copy fails the step, retryable, so the retry
 * writes a new copy; it never reaches Shopify.
 */
export function assertSafeCopy(copy: PageCopy): void {
  const claims = findUnsafeClaims(copy);
  if (claims.length === 0) return;
  const list = claims.map((c) => `${c.rule} (${c.field})`).join(", ");
  throw new IntegrationError(
    "workflow",
    "provider_error",
    `The page copy has unsafe claims: ${list}.`,
    {
      retryable: true,
    },
  );
}

function fatal(message: string): never {
  throw new IntegrationError("workflow", "invalid_input", message, { retryable: false });
}

/** The supplier_match row back in SupplierListing shape (Copywriter input). */
export function listingFromSupplierRow(row: SupplierRow): SupplierListing {
  const details = (row.details ?? {}) as Partial<SupplierDetails>;
  return supplierListingSchema.parse({
    source: row.source,
    url: row.url,
    title: row.title,
    price: { amount: row.price, currency: row.currency },
    shipping:
      row.shipping === null
        ? null
        : { amount: row.shipping, currency: details.shippingCurrency ?? row.currency },
    leadTimeDays: row.leadTime,
    images: row.images,
    variants: details.variants ?? [],
    matchScore: details.matchScore ?? 0,
  });
}

/** GATE 2 choice and its supplier row, or a non-retryable error. */
export async function loadChosenSupplier(ctx: WorkspaceContext, productId: string) {
  const choice = await loadSupplierChoice(ctx.db, productId);
  if (!choice) fatal("No supplier was chosen for this product (GATE 2).");
  const supplier = await ctx.db.findFirst(
    supplierMatch,
    and(eq(supplierMatch.id, choice.supplierMatchId), eq(supplierMatch.productId, productId)),
  );
  if (!supplier) fatal("The chosen supplier no longer exists. Choose a supplier again.");
  return { choice, supplier };
}

const MAX_HINT_NOTE = 2000;
const MAX_HINT_TITLE = 255;

function previousTitleOf(payload: Record<string, unknown> | null): string | null {
  const copy = payload?.previousCopy as { title?: unknown } | null | undefined;
  return typeof copy?.title === "string" && copy.title.trim() ? copy.title.trim() : null;
}

/**
 * Feedback from the product's GATE 3 page rejections and regenerations, most
 * recent first: the notes (joined, capped at 2000 chars) and the title of the
 * copy the latest one replaced. Null when the page was never sent back (first
 * build). Video rejections (M3, payload.part "videos") are ignored.
 */
export async function loadCopyHint(db: ScopedDb, productId: string): Promise<CopyHint | null> {
  const rows = await db.select(approval, {
    where: and(
      eq(approval.productId, productId),
      eq(approval.gate, "content_approval"),
      eq(approval.decision, "rejected"),
    ),
    orderBy: decisionOrder,
  });
  const pageRejections = rows.filter((r) => r.payload?.part === "page");
  if (pageRejections.length === 0) return null;

  const notes = pageRejections.map((r) => r.note?.trim()).filter((n): n is string => !!n);
  const previousTitle = previousTitleOf(pageRejections[0]!.payload);

  const hint: CopyHint = {};
  if (notes.length > 0) hint.note = notes.join("\n\n").slice(0, MAX_HINT_NOTE);
  if (previousTitle) hint.previousTitle = previousTitle.slice(0, MAX_HINT_TITLE);
  return Object.keys(hint).length > 0 ? copyHintSchema.parse(hint) : null;
}

/**
 * Writes new page copy for the product (one metered AI call), steered by the
 * GATE 3 rejection feedback when the page was sent back.
 */
export async function writePageCopy(
  env: Pick<StepEnv, "ctx" | "integrations" | "metered">,
  row: ProductRow,
  supplier: SupplierRow | null,
): Promise<PageCopy> {
  if (!row.analysis) fatal("The product has no analysis yet.");
  const brandRow = await env.ctx.db.getById(brand, row.brandId);
  const call = await buildCallContext(env.ctx.db, row.brandId);
  const hint = await loadCopyHint(env.ctx.db, row.id);
  const result = await env.metered(() =>
    env.integrations.copywriter.writePage(call, {
      analysis: row.analysis!,
      supplier: supplier ? listingFromSupplierRow(supplier) : null,
      language: brandRow.language,
      brandName: brandRow.name,
      ...(hint ? { hint } : {}),
    }),
  );
  return pageCopySchema.parse(result.data);
}

/**
 * shopify_product columns from a fresh Shopify ref (ids, status and URLs).
 * previewUrl is optional on the ref: when absent the stored one is kept.
 */
export function shopifyProductFields(ref: ShopifyProductRef) {
  return {
    shopifyProductId: ref.productId,
    handle: ref.handle,
    status: ref.status.toLowerCase() as "draft" | "active" | "archived",
    adminUrl: ref.adminUrl,
    storefrontUrl: ref.onlineStoreUrl,
    ...(ref.previewUrl !== undefined ? { previewUrl: ref.previewUrl } : {}),
  };
}

/**
 * Creates or updates the product's Shopify draft from its page copy and GATE 2
 * prices, then upserts shopify_product (ids, status, admin / preview /
 * storefront URLs). Idempotent (same key, same row).
 * Used by the build step, by page-copy edits and right before publishing.
 */
export async function syncShopifyDraft(
  ctx: WorkspaceContext,
  integrations: Integrations,
  row: ProductRow,
  input: { choice: SupplierChoicePayload; supplier: SupplierRow; copy: PageCopy },
): Promise<{ ref: ShopifyProductRef; shopifyProduct: Row<typeof shopifyProduct> }> {
  const { choice, supplier, copy } = input;
  const brandRow = await ctx.db.getById(brand, row.brandId);
  const { creds, templateSuffix } = await getShopifyCredentialsFor(
    ctx,
    integrations,
    choice.shopifyConnectionId,
  );
  const listing = listingFromSupplierRow(supplier);
  const price = row.sellingPrice ?? choice.sellingPrice;
  const compareAt = row.compareAtPrice ?? choice.compareAtPrice;
  const { options, variants } = variantsFromListing(
    safeVariantGroups(listing.variants),
    price,
    compareAt,
  );

  await integrations.shopify.ensureMetafieldDefinitions(creds);
  const ref = await integrations.shopify.createDraftProduct(
    creds,
    draftProductInputFromPageCopy({
      productId: row.id,
      copy,
      templateSuffix,
      options,
      variants,
      imageUrls: draftImageUrls(listing.images, [row.analysis?.referenceImageUrl]),
      vendor: brandRow.name,
      productType: row.analysis?.category,
      tags: ["trendcart"],
    }),
  );
  const fields = shopifyProductFields(ref);
  const saved = await ctx.db.upsert(
    shopifyProduct,
    { productId: row.id, connectionId: choice.shopifyConnectionId, ...fields },
    { target: (t) => [t.productId, t.connectionId], set: fields },
  );
  return { ref, shopifyProduct: saved };
}

export const buildStep: StepDefinition = {
  step: "build",
  limit: "ai",

  async run(env, row) {
    const { ctx, integrations, now } = env;
    const { choice, supplier } = await loadChosenSupplier(ctx, row.id);

    let copy = row.pageCopy ? pageCopySchema.parse(row.pageCopy) : null;
    if (copy && findUnsafeClaims(copy).length > 0) {
      // A stored copy that no longer passes the guard (e.g. the rules got
      // stricter): cleared so the retry writes a new one. Nothing is pushed.
      await ctx.db.update(product, { pageCopy: null, pageCopyGeneratedAt: null }, (p) =>
        and(eq(p.id, row.id), eq(p.status, row.status)),
      );
      assertSafeCopy(copy);
    }
    if (!copy) {
      copy = await writePageCopy(env, row, supplier);
      // Never stored nor pushed when unsafe: the retry pays for a new copy.
      assertSafeCopy(copy);
      // Stored now (status unchanged) so a Shopify retry reuses it.
      await ctx.db.update(product, { pageCopy: copy, pageCopyGeneratedAt: now() }, (p) =>
        and(eq(p.id, row.id), eq(p.status, row.status)),
      );
    }

    await syncShopifyDraft(ctx, integrations, row, { choice, supplier, copy });
    return {};
  },
};
