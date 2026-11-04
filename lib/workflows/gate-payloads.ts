/**
 * Shapes of `approval.payload` per gate, written by the gate services and
 * read back by the steps (the build step reads the GATE 2 choice). Kept in
 * one place so both sides agree; parsed with zod on read.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Gate } from "@/lib/domain/contracts";
import { gatePartSchema, type GatePart } from "@/lib/domain/state-machine";
import { approval, product } from "@/lib/db/schema";
import type { NewRow, Row, ScopedDb } from "@/lib/tenant/scoped-db";

/** GATE 2 approval: the chosen listing, the target store and the confirmed prices. */
export const supplierChoicePayloadSchema = z.object({
  supplierMatchId: z.string().min(1),
  shopifyConnectionId: z.string().min(1),
  /**
   * Product template the page is built on (templates/product.<suffix>.json,
   * null = default). Absent on choices recorded before templates were picked
   * per page: the store's default template then applies.
   */
  templateSuffix: z.string().min(1).max(100).nullable().optional(),
  /** "generate": Claude designs a template from `templateSuffix` (base). Absent = existing. */
  templateMode: z.enum(["existing", "generate"]).optional(),
  sellingPrice: z.number().positive(),
  compareAtPrice: z.number().positive().nullable(),
  priceSource: z.enum(["pricing_rule", "default_rule", "min_margin", "manual"]),
  fxRate: z.number().positive().nullable(),
  otherCosts: z.number().nonnegative(),
  marginRate: z.number(),
  meetsTarget: z.boolean(),
  warnings: z.array(z.string()),
});
export type SupplierChoicePayload = z.infer<typeof supplierChoicePayloadSchema>;

/** Template of a GATE 2 choice, or the store's default when the choice predates the picker. */
export function effectiveTemplateSuffix(
  choice: Pick<SupplierChoicePayload, "templateSuffix">,
  storeDefault: string | null,
): string | null {
  return choice.templateSuffix !== undefined ? choice.templateSuffix : storeDefault;
}

/** GATE 3 decisions are per part; `kind` tells a rejection from a plain regeneration. */
export const contentPartPayloadSchema = z
  .object({
    part: gatePartSchema,
    /** "template": the page was sent back to be rebuilt on another template. */
    kind: z.enum(["approve", "reject", "regenerate", "template"]).optional(),
  })
  .passthrough();

export type ApprovalRow = Row<typeof approval>;

/**
 * Lifecycle of a GATE 3 page approval (payload.state). "publishing" is
 * recorded before the Shopify publish and already closes the page part;
 * "published" once Shopify and the database agree; "voided" when the publish
 * failed and was reverted (the row stays as history, the gate reopens).
 * Rows without a state (older rows, other gates) are plain decisions.
 */
export type ApprovalState = "publishing" | "published" | "voided";

export function approvalState(row: Pick<ApprovalRow, "payload">): ApprovalState | null {
  const s = row.payload?.state;
  return s === "publishing" || s === "published" || s === "voided" ? s : null;
}

const isVoided = (row: Pick<ApprovalRow, "payload">) => approvalState(row) === "voided";

/**
 * Decision order, latest first: created_at, then the per-product sequence
 * number recorded with the decision (payload.seq, monotonic under the product
 * lock), then the id for rows written before the sequence existed.
 */
export const decisionOrder = (t: typeof approval) => [
  desc(t.createdAt),
  desc(sql`coalesce((${t.payload}->>'seq')::int, 0)`),
  desc(t.id),
];

/**
 * Locks the product row for the rest of the transaction (a no-op UPDATE) and
 * returns its current version. Every gate decision takes this lock first, so
 * two decisions on one product are serialized: the second one re-reads the
 * status and the gate parts after the first one committed.
 */
export async function lockProduct(tx: ScopedDb, productId: string): Promise<Row<typeof product>> {
  const [row] = await tx.update(product, { updatedAt: new Date() }, (p) => eq(p.id, productId));
  // No row: the standard not-found error of the scoped db (404).
  return row ?? tx.getById(product, productId);
}

/**
 * Inserts a gate decision with a monotonic order: payload.seq = previous + 1
 * for this product, and created_at never before the previous decision's.
 * Call it inside a transaction, after lockProduct.
 */
export async function recordGateDecision(
  tx: ScopedDb,
  values: Omit<NewRow<typeof approval>, "createdAt">,
): Promise<ApprovalRow> {
  const previous = await tx.findFirst(approval, eq(approval.productId, values.productId), {
    orderBy: (t) => [desc(sql`coalesce((${t.payload}->>'seq')::int, 0)`), desc(t.createdAt)],
  });
  const prevSeq = Number(previous?.payload?.seq ?? 0);
  const seq = (Number.isInteger(prevSeq) ? prevSeq : 0) + 1;
  const now = Date.now();
  const createdAt = new Date(previous ? Math.max(now, previous.createdAt.getTime() + 1) : now);
  return tx.insert(approval, {
    ...values,
    createdAt,
    payload: { ...(values.payload ?? {}), seq },
  });
}

/** Latest decision for a gate (voided page approvals are skipped). */
export async function latestApproval(
  db: ScopedDb,
  productId: string,
  gate: Gate,
): Promise<ApprovalRow | undefined> {
  const rows = await db.select(approval, {
    where: and(eq(approval.productId, productId), eq(approval.gate, gate)),
    orderBy: decisionOrder,
  });
  return rows.find((r) => !isVoided(r));
}

/** The GATE 2 choice in force (latest supplier_choice approval, if it is an approval). */
export async function loadSupplierChoice(
  db: ScopedDb,
  productId: string,
): Promise<(SupplierChoicePayload & { approvalId: string }) | null> {
  const row = await latestApproval(db, productId, "supplier_choice");
  if (!row || row.decision !== "approved") return null;
  const parsed = supplierChoicePayloadSchema.safeParse(row.payload);
  return parsed.success ? { ...parsed.data, approvalId: row.id } : null;
}

/** "publishing": a page approval is claimed and its Shopify publish is in flight. */
export type GatePartState = "pending" | "publishing" | "approved" | "rejected";

/**
 * State of each part of a multi-part gate: the latest decision recorded for
 * each part wins (a rejection triggers a rebuild and the next approval
 * supersedes it). Parts never decided are pending. A page approval whose
 * publish is in flight is "publishing" (the part is closed, not yet
 * approved); a voided one is ignored (the gate reopened).
 */
export async function gatePartStates(
  db: ScopedDb,
  productId: string,
  gate: Gate,
): Promise<Record<GatePart, GatePartState>> {
  const rows = await db.select(approval, {
    where: and(eq(approval.productId, productId), eq(approval.gate, gate)),
    orderBy: decisionOrder,
  });
  const states: Record<GatePart, GatePartState> = { page: "pending", videos: "pending" };
  const seen = new Set<GatePart>();
  for (const row of rows) {
    const parsed = contentPartPayloadSchema.safeParse(row.payload);
    if (!parsed.success || seen.has(parsed.data.part) || isVoided(row)) continue;
    seen.add(parsed.data.part);
    states[parsed.data.part] = approvalState(row) === "publishing" ? "publishing" : row.decision;
  }
  return states;
}
