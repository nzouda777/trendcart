/**
 * Step "source": confirmed product → supplier listings (sourcing →
 * awaiting_supplier_choice, GATE 2).
 *
 * - SupplierFinder.find with the analysis keywords and reference image, in the
 *   brand's country and currency, through `metered` (cap + usage + job cost).
 *   An empty list is a valid result: the product still reaches GATE 2, where
 *   the user can search again (GATE 2 rejection).
 * - After a GATE 2 rejection ("none of these"), every listing URL rejected so
 *   far for the product is passed as `excludeUrls`, and never stored again.
 * - Listings are upserted on (product, url): a re-run never duplicates rows.
 * - Idempotent: if the product already has supplier rows (a previous attempt
 *   stored them, then crashed before the transition), the search is not paid
 *   for again. A GATE 2 rejection deletes the unselected rows first.
 *
 * Worst case the live finder takes about 80 s, well under the 300 s budget.
 */
import { and, eq } from "drizzle-orm";

import {
  IntegrationError,
  supplierListingSchema,
  type SupplierListing,
  type SupplierListingInput,
} from "@/lib/domain/contracts";
import { approval, brand, supplierMatch } from "@/lib/db/schema";
import type { ScopedDb } from "@/lib/tenant/scoped-db";

import { buildCallContext } from "../call-context";
import { decisionOrder } from "../gate-payloads";

import type { StepDefinition } from "./types";

/** Listings asked from the finder (1..10): room for AliExpress, CJ, Amazon and the best others. */
export const SUPPLIER_SEARCH_LIMIT = 6;

/** Extra listing fields kept on supplier_match.details. */
export type SupplierDetails = {
  variants: SupplierListing["variants"];
  matchScore: number;
  /** Quality/price ratio, rating and review count (absent on rows stored before them). */
  valueScore?: number;
  rating?: number | null;
  reviewCount?: number | null;
  /** Shipping currency when it differs from the price currency. */
  shippingCurrency?: string;
};

/** Upserts one listing on (product, url). Exported for tests and manual entries. */
export async function upsertSupplierListing(
  db: ScopedDb,
  productId: string,
  raw: SupplierListingInput,
) {
  const listing = supplierListingSchema.parse(raw);
  const details: SupplierDetails = {
    variants: listing.variants,
    matchScore: listing.matchScore,
    valueScore: listing.valueScore,
    rating: listing.rating,
    reviewCount: listing.reviewCount,
    ...(listing.shipping && listing.shipping.currency !== listing.price.currency
      ? { shippingCurrency: listing.shipping.currency }
      : {}),
  };
  const fields = {
    source: listing.source,
    title: listing.title.slice(0, 500),
    currency: listing.price.currency,
    price: listing.price.amount,
    shipping: listing.shipping?.amount ?? null,
    leadTime: listing.leadTimeDays,
    images: listing.images,
    details,
  };
  return db.upsert(
    supplierMatch,
    { productId, url: listing.url, ...fields },
    { target: (t) => [t.productId, t.url], set: fields },
  );
}

/** Most URLs passed as excludeUrls (newest rejections first). */
export const MAX_EXCLUDED_URLS = 100;

/**
 * Every listing URL rejected at GATE 2 ("none of these") for this product,
 * newest rejection first, deduplicated, capped at MAX_EXCLUDED_URLS.
 */
export async function loadRejectedListingUrls(db: ScopedDb, productId: string): Promise<string[]> {
  const rows = await db.select(approval, {
    where: and(
      eq(approval.productId, productId),
      eq(approval.gate, "supplier_choice"),
      eq(approval.decision, "rejected"),
    ),
    orderBy: decisionOrder,
  });
  const urls = new Set<string>();
  for (const row of rows) {
    const list = row.payload?.rejectedUrls;
    if (!Array.isArray(list)) continue;
    for (const url of list) if (typeof url === "string" && url) urls.add(url);
  }
  return [...urls].slice(0, MAX_EXCLUDED_URLS);
}

export const sourceStep: StepDefinition = {
  step: "source",
  limit: "ai",

  async run({ ctx, integrations, metered }, row) {
    const existing = await ctx.db.count(supplierMatch, eq(supplierMatch.productId, row.id));
    if (existing > 0) return {};

    if (!row.analysis) {
      throw new IntegrationError("workflow", "invalid_input", "The product has no analysis yet.", {
        retryable: false,
      });
    }
    const brandRow = await ctx.db.getById(brand, row.brandId);
    const call = await buildCallContext(ctx.db, row.brandId);
    const excludeUrls = await loadRejectedListingUrls(ctx.db, row.id);
    const result = await metered(() =>
      integrations.supplierFinder.find(call, {
        imageUrl: row.analysis!.referenceImageUrl,
        keywords: row.analysis!.keywords,
        country: brandRow.country,
        currency: brandRow.currency,
        limit: SUPPLIER_SEARCH_LIMIT,
        ...(excludeUrls.length > 0 ? { excludeUrls } : {}),
      }),
    );
    // Defence in depth: an exact rejected URL is never stored again, even if
    // the finder returned it.
    const rejected = new Set(excludeUrls);
    for (const listing of result.data) {
      if (rejected.has(listing.url)) continue;
      await upsertSupplierListing(ctx.db, row.id, listing);
    }
    return {};
  },
};
