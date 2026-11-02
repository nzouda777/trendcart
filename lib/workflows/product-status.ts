/**
 * Applies a state-machine event to a product row with an optimistic check:
 * the UPDATE only matches if the status is still the one the transition was
 * computed from, so two concurrent approvals or step completions cannot both
 * win. Extra columns (e.g. the analysis) are written in the same UPDATE.
 */
import { and, eq } from "drizzle-orm";

import type { ProductStatus } from "@/lib/domain/contracts";
import { transition, type ProductEvent } from "@/lib/domain/state-machine";
import { product } from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";
import type { Patch, Row, ScopedDb } from "@/lib/tenant/scoped-db";

export type ProductRow = Row<typeof product>;

export async function applyProductEvent(
  db: ScopedDb,
  productId: string,
  event: ProductEvent,
  extra: Omit<Patch<typeof product>, "status"> = {},
): Promise<ProductRow> {
  const current = await db.getById(product, productId);
  return applyProductEventTo(db, current, event, extra);
}

/** Same, when the caller already loaded the row (its status is the expected one). */
export async function applyProductEventTo(
  db: ScopedDb,
  current: Pick<ProductRow, "id" | "status">,
  event: ProductEvent,
  extra: Omit<Patch<typeof product>, "status"> = {},
): Promise<ProductRow> {
  const to: ProductStatus = transition(current.status, event);
  const [updated] = await db.update(product, { ...extra, status: to }, (p) =>
    and(eq(p.id, current.id), eq(p.status, current.status)),
  );
  if (!updated) {
    throw new ServiceError(
      "conflict",
      "This product was updated by someone else in the meantime. Refresh and try again.",
    );
  }
  return updated;
}
