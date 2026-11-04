/**
 * Step "build": GATE 2 choice → page copy → Shopify draft
 * (building_page_and_videos → awaiting_content_approval, GATE 3).
 *
 * 0. Template: the product template chosen at GATE 2 is read from the store's
 *    live theme (sections, blocks and the text metafields they render), so
 *    the copy fills its slots (PageCopy.templateFields → product metafields).
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
 *    When the page left a Trendcart-generated template for an existing one
 *    (GATE 3 template change), the orphaned product.tc-<id>.json is deleted
 *    from the theme, best effort, after the draft was switched.
 * 3. Videos (./videos.ts): gather related videos and run compliance checks
 *    (bounded fan-out), each idempotent on (product, tiktok_url).
 *
 * Every Shopify call is idempotent and the whole step stays well under the
 * function limit (one copy call, three Admin API calls, at most
 * MAX_CHECKS_PER_RUN compliance checks, CHECK_CONCURRENCY at a time).
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
  type PageTemplateChoice,
  type ProductTemplateStructure,
  type ShopifyProductRef,
  type SupplierListing,
} from "@/lib/domain/contracts";
import { findUnsafeClaims } from "@/lib/ai/copy-safety";
import { approval, brand, product, shopifyProduct, supplierMatch } from "@/lib/db/schema";
import { draftProductInputFromPageCopy } from "@/lib/integrations/shopify";
import { imageFilename } from "@/lib/integrations/shopify/product-input";
import { getShopifyCredentialsFor } from "@/lib/services/internal/credentials";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";

import { buildCallContext } from "../call-context";
import {
  generatedTemplateSuffix,
  buildGeneratedTemplate,
} from "@/lib/integrations/shopify/template-builder";

import { decisionOrder, loadSupplierChoice, type SupplierChoicePayload } from "../gate-payloads";
import { draftTemplateSuffix, resolvePageTemplate, templateLabel } from "../page-template";
import { isUnsafeText, pageImageUrls, safeVariantGroups, variantsFromListing } from "../page-input";
import type { SupplierDetails } from "./source";
import { buildVideos } from "./videos";

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
    rating: details.rating ?? null,
    reviewCount: details.reviewCount ?? null,
    valueScore: details.valueScore ?? 0,
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
  // A template change is not a verdict on the copy: it does not steer the next one.
  const pageRejections = rows.filter(
    (r) => r.payload?.part === "page" && r.payload?.kind !== "template",
  );
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
  template: ProductTemplateStructure | null = null,
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
      ...(template && template.slots.length > 0
        ? { template: { outline: template.outline, slots: template.slots } }
        : {}),
    }),
  );
  return pageCopySchema.parse(result.data);
}

/**
 * Structure of the template chosen at GATE 2 (read from the store's live
 * theme), so the copy follows its sections. A template removed from the theme
 * meanwhile fails the step without retry: go back to GATE 2 and pick another.
 */
export async function loadChosenTemplate(
  ctx: WorkspaceContext,
  integrations: Integrations,
  row: ProductRow,
  choice: SupplierChoicePayload,
): Promise<ProductTemplateStructure | null> {
  const { creds, templateSuffix: storeDefault } = await getShopifyCredentialsFor(
    ctx,
    integrations,
    choice.shopifyConnectionId,
  );
  const t = resolvePageTemplate(row, choice, storeDefault);
  // A generated template has no metafield slots: Claude writes its sections' text.
  if (t.mode === "generate") return null;
  try {
    return await integrations.shopify.getProductTemplateStructure(creds, t.suffix);
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "not_found") {
      fatal(
        `The template ${templateLabel(t.suffix)} is no longer in the store's theme. Choose another template.`,
      );
    }
    throw error;
  }
}

/**
 * "generate" mode: Claude designs a CRO page from the theme's sections (one
 * metered call), the template is built and validated against the section
 * schemas (unsafe text dropped), written to the live theme as
 * templates/product.tc-<product id>.json (same file on every rebuild), and
 * recorded on product.page_template.generated. Returns the updated row.
 */
export async function generatePageTemplate(
  env: Pick<StepEnv, "ctx" | "integrations" | "metered" | "now">,
  row: ProductRow,
  input: { choice: SupplierChoicePayload; supplier: SupplierRow; copy: PageCopy },
): Promise<ProductRow> {
  const { ctx, integrations } = env;
  const { choice, copy } = input;
  if (!row.analysis) fatal("The product has no analysis yet.");
  // The draft first: its handle is the target of the page buttons, and its
  // photos (uploaded to the store) are what image sections show.
  const draft = await syncShopifyDraft(ctx, integrations, row, input);
  const { creds, templateSuffix: storeDefault } = await getShopifyCredentialsFor(
    ctx,
    integrations,
    choice.shopifyConnectionId,
  );
  const t = resolvePageTemplate(row, choice, storeDefault);
  let design: Awaited<ReturnType<Integrations["shopify"]["getTemplateDesignContext"]>>;
  try {
    design = await integrations.shopify.getTemplateDesignContext(creds, t.suffix);
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "not_found") {
      fatal(`The base template ${templateLabel(t.suffix)} is no longer in the store's theme.`);
    }
    throw error;
  }
  const brandRow = await ctx.db.getById(brand, row.brandId);
  const call = await buildCallContext(ctx.db, row.brandId);
  const result = await env.metered(() =>
    integrations.copywriter.designTemplate(call, {
      analysis: row.analysis!,
      copy,
      language: brandRow.language,
      brandName: brandRow.name,
      sections: design.sections,
      mainSection: design.mainSection,
      colorSchemes: design.colorSchemes,
      imageUrls: draft.imageUrls,
      withImages: t.withImages,
    }),
  );

  let built: ReturnType<typeof buildGeneratedTemplate>;
  try {
    built = buildGeneratedTemplate(design.base, result.data, design.sections, isUnsafeText, {
      mainSection: design.mainSection,
      context: {
        productHandle: draft.ref.handle,
        colorSchemes: design.colorSchemes.map((c) => c.id),
        // Product photos as theme image references (the files Trendcart uploaded).
        images: t.withImages
          ? draft.imageUrls.map((url) => `shopify://shop_images/${imageFilename(url)}`)
          : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid template.";
    // No main product section in the base: retrying cannot help. An unusable plan can.
    throw new IntegrationError("workflow", "invalid_input", message, {
      retryable: !/main product section/.test(message),
    });
  }
  const suffix = generatedTemplateSuffix(row.id);
  await integrations.shopify.upsertProductTemplate(creds, { suffix, template: built.template });

  const pageTemplate: PageTemplateChoice = {
    ...t,
    generated: { suffix, sections: built.sections, generatedAt: env.now().toISOString() },
  };
  const [saved] = await ctx.db.update(product, { pageTemplate }, (p) =>
    and(eq(p.id, row.id), eq(p.status, row.status)),
  );
  return saved ?? { ...row, pageTemplate };
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
): Promise<{
  ref: ShopifyProductRef;
  shopifyProduct: Row<typeof shopifyProduct>;
  /** The gallery sent to Shopify (supplier photo URLs). */
  imageUrls: string[];
}> {
  const { choice, supplier, copy } = input;
  const brandRow = await ctx.db.getById(brand, row.brandId);
  const { creds, templateSuffix: storeDefault } = await getShopifyCredentialsFor(
    ctx,
    integrations,
    choice.shopifyConnectionId,
  );
  const templateSuffix = draftTemplateSuffix(resolvePageTemplate(row, choice, storeDefault));
  const listing = listingFromSupplierRow(supplier);
  const price = row.sellingPrice ?? choice.sellingPrice;
  const compareAt = row.compareAtPrice ?? choice.compareAtPrice;
  const { options, variants } = variantsFromListing(
    safeVariantGroups(listing.variants),
    price,
    compareAt,
  );

  // Photos of the other listings of this product top up a short gallery.
  const others = await ctx.db.select(supplierMatch, {
    where: eq(supplierMatch.productId, row.id),
    orderBy: (t) => t.createdAt,
  });
  const imageUrls = pageImageUrls({
    selected: listing.images,
    referenceImageUrl: row.analysis?.referenceImageUrl,
    others: others
      .filter((o) => o.id !== supplier.id)
      .map((o) => ({
        images: o.images,
        matchScore: ((o.details ?? {}) as Partial<SupplierDetails>).matchScore ?? 0,
      })),
  });

  await integrations.shopify.ensureMetafieldDefinitions(creds);
  const ref = await integrations.shopify.createDraftProduct(
    creds,
    draftProductInputFromPageCopy({
      productId: row.id,
      copy,
      templateSuffix,
      options,
      variants,
      imageUrls,
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
  return { ref, shopifyProduct: saved, imageUrls };
}

/**
 * Whether the page was moved off a Trendcart-generated template (a GATE 3
 * template change recorded `previousGeneratedSuffix`).
 */
async function leftGeneratedTemplate(db: ScopedDb, productId: string): Promise<boolean> {
  const rows = await db.select(approval, {
    where: and(
      eq(approval.productId, productId),
      eq(approval.gate, "content_approval"),
      eq(approval.decision, "rejected"),
    ),
  });
  return rows.some(
    (r) => r.payload?.kind === "template" && typeof r.payload?.previousGeneratedSuffix === "string",
  );
}

/**
 * Best effort: deletes the product's generated theme template
 * (product.tc-<product id>.json) from the store chosen at GATE 2. Shopify
 * refuses while the product is ACTIVE and uses it; the call is idempotent.
 * Used when the page moved to another template, when the product goes back
 * to GATE 2, and when it is deleted while still a draft. Never after a failed
 * publish (that one is retried). Failures are logged, never thrown.
 */
export async function deleteGeneratedTemplate(
  ctx: WorkspaceContext,
  integrations: Integrations,
  input: { productId: string; connectionId: string; shopifyProductId?: string | null },
): Promise<boolean> {
  try {
    const { creds } = await getShopifyCredentialsFor(ctx, integrations, input.connectionId);
    const { deleted } = await integrations.shopify.deleteProductTemplate(creds, {
      suffix: generatedTemplateSuffix(input.productId),
      ...(input.shopifyProductId ? { productId: input.shopifyProductId } : {}),
    });
    return deleted;
  } catch (error) {
    console.error("[template] could not delete the generated product template", error);
    return false;
  }
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
    let current = row;
    if (!copy) {
      const template = await loadChosenTemplate(ctx, integrations, row, choice);
      copy = await writePageCopy(env, row, supplier, template);
      // Never stored nor pushed when unsafe: the retry pays for a new copy.
      assertSafeCopy(copy);
      // Stored now (status unchanged) so a Shopify retry reuses it. A new copy
      // also means a new generated template (designed from this copy).
      const pageTemplate = row.pageTemplate ? { ...row.pageTemplate, generated: null } : null;
      const [saved] = await ctx.db.update(
        product,
        { pageCopy: copy, pageCopyGeneratedAt: now(), pageTemplate },
        (p) => and(eq(p.id, row.id), eq(p.status, row.status)),
      );
      current = saved ?? { ...row, pageCopy: copy, pageTemplate };
    }

    // Separate from the copy (stored above), so a retry after a design or theme
    // failure does not pay for the copy again.
    if (current.pageTemplate?.mode === "generate" && !current.pageTemplate.generated) {
      current = await generatePageTemplate(env, current, { choice, supplier, copy });
    }

    const synced = await syncShopifyDraft(ctx, integrations, current, { choice, supplier, copy });
    if (
      current.pageTemplate?.mode !== "generate" &&
      (await leftGeneratedTemplate(ctx.db, row.id))
    ) {
      // The draft now uses another template: the generated one is orphaned.
      await deleteGeneratedTemplate(ctx, integrations, {
        productId: row.id,
        connectionId: choice.shopifyConnectionId,
        shopifyProductId: synced.ref.productId,
      });
    }
    await buildVideos(env, current, copy);
    return {};
  },
};
