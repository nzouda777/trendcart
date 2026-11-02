import type { GatePart } from "@/lib/domain/state-machine";
import type { GatePartState } from "@/lib/services/types";

/**
 * State of the GATE 3 page part as the UI sees it. "publishing" is the window
 * between the approval claim and the Shopify publish being recorded (the
 * service may not list it in GatePartState yet, so it is added here).
 */
export type PagePartState = GatePartState | "publishing";

export function pagePartState(parts: Record<GatePart, GatePartState>): PagePartState {
  return parts.page;
}

/**
 * Marker the approve action puts in `fieldErrors.copyVersion` when the copy
 * changed since the reviewer loaded it: the UI then offers a reload instead
 * of a retry.
 */
export const STALE_COPY_FIELD = "copyVersion";
