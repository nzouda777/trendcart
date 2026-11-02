"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/components/app/action-result";
import { STALE_COPY_FIELD } from "@/components/app/product/page-state";
import type { PageCopy } from "@/lib/domain/contracts";
import {
  approvePage,
  confirmProduct,
  quoteSupplierChoice,
  regeneratePageCopy,
  rejectPage,
  rejectProduct,
  rejectSuppliers,
  retryStep,
  selectSupplier,
  updatePageCopy,
  type ServiceFailure,
  type SupplierQuoteDTO,
} from "@/lib/services";

import { runAction } from "../../_lib/action";

type Messages = Partial<Record<ServiceFailure["code"], string>>;

/**
 * Swaps service messages for screen-specific ones. On a state or concurrency
 * failure the route is refreshed too, so the screen shows what changed.
 */
function explain<T>(result: ActionResult<T>, messages: Messages): ActionResult<T> {
  if (result.ok) return result;
  if (result.code === "invalid_state" || result.code === "conflict") refresh();
  const message = messages[result.code];
  return message ? { ...result, error: message } : result;
}

const CONFLICT =
  "Someone else changed this product in the meantime. The screen was refreshed: check it and try again.";

/** Rebuild actions (reject suppliers, reject page, regenerate) are rate-limited per product. */
const REBUILD_LIMIT = "Too many rebuilds for now. Nothing was changed: try again later.";

const optionalText = (value: string | undefined) => value?.trim() || undefined;

/* GATE 1 ------------------------------------------------------------------- */

/** GATE 1: confirm the AI identified the right product (optionally renaming it). */
export async function confirmProductAction(
  productId: string,
  input: { name?: string; note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await confirmProduct(ctx, {
      productId,
      name: optionalText(input.name),
      note: optionalText(input.note),
    });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: "This product is no longer waiting for confirmation.",
    forbidden: "Your role cannot confirm products.",
  });
}

/** GATE 1 rejection: the product goes back to a fresh analysis. */
export async function rejectProductAction(
  productId: string,
  input: { note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await rejectProduct(ctx, { productId, note: optionalText(input.note) });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: "This product is no longer waiting for confirmation.",
    forbidden: "Your role cannot reject products.",
  });
}

export async function retryStepAction(productId: string): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await retryStep(ctx, productId);
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: "This step is not failed or stalled anymore.",
    forbidden: "Your role cannot retry steps.",
  });
}

/* GATE 2 ------------------------------------------------------------------- */

export type PriceInput = {
  supplierMatchId: string;
  fxRate?: number;
  sellingPrice?: number;
  /** null removes the compare-at price. */
  compareAtPrice?: number | null;
  otherCosts?: number;
};

/** GATE 2 preview: suggested prices and margin for one listing. Records nothing. */
export async function quoteSupplierAction(
  productId: string,
  input: PriceInput,
): Promise<ActionResult<SupplierQuoteDTO>> {
  const result = await runAction((ctx) => quoteSupplierChoice(ctx, { productId, ...input }));
  return explain(result, {});
}

/** GATE 2: choose a listing, the target store and the prices. Starts the page build. */
export async function selectSupplierAction(
  productId: string,
  input: PriceInput & { shopifyConnectionId?: string; acceptLowMargin: boolean; note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await selectSupplier(ctx, { productId, ...input, note: optionalText(input.note) });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: "This product is no longer waiting for a supplier choice.",
    forbidden: "Your role cannot choose suppliers.",
  });
}

/** GATE 2 rejection ("none of these"): the supplier search runs again. */
export async function rejectSuppliersAction(
  productId: string,
  input: { note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await rejectSuppliers(ctx, { productId, note: optionalText(input.note) });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: "This product is no longer waiting for a supplier choice.",
    forbidden: "Your role cannot reject suppliers.",
    rate_limited: REBUILD_LIMIT,
  });
}

/* GATE 3: the page ---------------------------------------------------------- */

const PAGE_CLOSED =
  "The page is not open for review anymore (it is being published, was approved, or is being rebuilt).";

/**
 * Edits page copy fields and pushes them to the Shopify draft. Returns the new
 * copy version so the approve button binds to the edited copy at once. A
 * copy-safety refusal (invalid_input) keeps the service message, which lists
 * the fields and rules.
 */
export async function updatePageCopyAction(
  productId: string,
  copy: Partial<PageCopy>,
): Promise<ActionResult<{ previewUrl: string | null; copyVersion: string | null }>> {
  const result = await runAction(async (ctx) => {
    const pipeline = await updatePageCopy(ctx, { productId, copy });
    return {
      previewUrl: pipeline.shopify?.previewUrl ?? null,
      copyVersion: pipeline.pageCopyVersion,
    };
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: PAGE_CLOSED,
    conflict: CONFLICT,
    forbidden: "Your role cannot edit the page.",
  });
}

/** Writes the page copy again (same Shopify draft). */
export async function regeneratePageCopyAction(productId: string): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await regeneratePageCopy(ctx, { productId });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: PAGE_CLOSED,
    conflict: CONFLICT,
    forbidden: "Your role cannot regenerate the page.",
    rate_limited: REBUILD_LIMIT,
  });
}

/** GATE 3 page rejection with a note that steers the next version. */
export async function rejectPageAction(
  productId: string,
  input: { note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await rejectPage(ctx, { productId, note: optionalText(input.note) });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    invalid_state: PAGE_CLOSED,
    conflict: CONFLICT,
    forbidden: "Your role cannot reject the page.",
    rate_limited: REBUILD_LIMIT,
  });
}

const approvePageInput = z.object({
  /** `pageCopyVersion` of the copy the reviewer saw. */
  copyVersion: z.string().regex(/^[0-9a-f]{16}$/, "Invalid copy version."),
  note: z.string().max(2000).optional(),
});

/** Shown when the service refuses with reason "copy_changed" (copy edited after loading). */
const STALE_COPY =
  "The page changed since you loaded it. Reload to review the latest version before approving.";

/**
 * GATE 3 page approval: publishes the product on the Shopify store, bound to
 * the copy version the reviewer saw. When the copy changed meanwhile, the
 * route is NOT refreshed here, so a second click cannot approve a copy nobody
 * looked at: the failure carries `fieldErrors.copyVersion` and the UI offers
 * an explicit reload. It is detected by `reason: "copy_changed"`, not by the
 * message text. Other state failures keep the service message (already
 * approved, being published, not at GATE 3) and refresh the route. The same
 * action is the "Retry approval" of a stuck publish: approvePage takes over a
 * claim older than its 5-minute limit.
 */
export async function approvePageAction(
  productId: string,
  input: { copyVersion: string; note?: string },
): Promise<ActionResult> {
  const parsed = approvePageInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      error: "This page version is not valid. Reload the page and review it again.",
      fieldErrors: { [STALE_COPY_FIELD]: ["invalid"] },
    };
  }
  const result = await runAction(async (ctx) => {
    await approvePage(ctx, {
      productId,
      copyVersion: parsed.data.copyVersion,
      note: optionalText(parsed.data.note),
    });
    return undefined;
  });
  if (result.ok) {
    refresh();
    return result;
  }
  if (result.reason === "copy_changed") {
    return {
      ...result,
      error: STALE_COPY,
      fieldErrors: { [STALE_COPY_FIELD]: ["stale"] },
    };
  }
  return explain(result, {
    conflict: CONFLICT,
    forbidden: "Your role cannot approve and publish pages.",
  });
}
