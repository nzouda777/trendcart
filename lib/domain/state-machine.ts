/**
 * Product state machine (CLAUDE.md "Product state machine").
 *
 *   imported → analyzing → awaiting_product_confirmation      (GATE 1)
 *   → sourcing → awaiting_supplier_choice                     (GATE 2)
 *   → building_page_and_videos → awaiting_content_approval    (GATE 3)
 *   → preparing_campaign → ready_to_launch                    (GATE 4)
 *   → launched
 *
 * - Automated work happens in *steps*. A step runs while the product is in
 *   its running status and ends in `step_succeeded` (next status) or
 *   `step_failed` (→ failed). `retry` re-enters the failed step.
 * - Gates only move forward on `gate_approved`, which must carry the
 *   recorded approval (approved, for this product, for the current gate).
 *   Nothing else can leave an `awaiting_*` / `ready_to_launch` status,
 *   except `gate_rejected` with the recorded rejection, for gates that
 *   define `onReject` (GATE 1: back to analyzing for a fresh analysis;
 *   GATE 2: back to sourcing for a new search; GATE 3: back to building for
 *   a new page copy on the same Shopify draft).
 * - A gate can have *parts* that are approved one by one (GATE 3: the page,
 *   then the videos). Approving a part is recorded in `approval` (payload
 *   `{ part }`) without moving the product; the gate transition happens when
 *   the approval that completes the last part is presented with every part
 *   in `approval.parts`.
 * - The launch step has no running status: it executes while the product is
 *   `ready_to_launch`, after GATE 4 was approved. If it fails, `retry` goes
 *   back to `ready_to_launch`, so a new GATE 4 approval is required.
 *
 * Pure and dependency-free (apart from the zod enums): safe on the client.
 */
import { z } from "zod";

import type { Gate, ProductStatus } from "./contracts";

export const productStepSchema = z.enum([
  "analyze",
  "source",
  "build", // Shopify draft page + related videos + compliance checks
  "prepare_campaign",
  "launch",
]);
export type ProductStep = z.infer<typeof productStepSchema>;

type StepDef = {
  /** Status the product is in while the step runs. */
  running: ProductStatus;
  /** Status after the step succeeds. */
  success: ProductStatus;
  /** Status `retry` returns to after a failure. */
  retryTo: ProductStatus;
};

export const STEPS: Readonly<Record<ProductStep, StepDef>> = {
  analyze: {
    running: "analyzing",
    success: "awaiting_product_confirmation",
    retryTo: "analyzing",
  },
  source: { running: "sourcing", success: "awaiting_supplier_choice", retryTo: "sourcing" },
  build: {
    running: "building_page_and_videos",
    success: "awaiting_content_approval",
    retryTo: "building_page_and_videos",
  },
  prepare_campaign: {
    running: "preparing_campaign",
    success: "ready_to_launch",
    retryTo: "preparing_campaign",
  },
  // Runs inside ready_to_launch; success is the GATE 4 transition itself.
  launch: { running: "ready_to_launch", success: "launched", retryTo: "ready_to_launch" },
};

/** Parts of a gate that are approved separately (GATE 3: page now, videos in M3). */
export const gatePartSchema = z.enum(["page", "videos"]);
export type GatePart = z.infer<typeof gatePartSchema>;

type GateDef = {
  from: ProductStatus;
  to: ProductStatus;
  nextStep: ProductStep;
  /** Parts that must all be approved before the gate moves the product. */
  parts?: readonly GatePart[];
  /**
   * Where a recorded rejection sends the product, and which step re-runs.
   * Absent: rejecting this gate is not a transition (yet: M2/M3 decide).
   */
  onReject?: { to: ProductStatus; step: ProductStep };
};

export const GATES: Readonly<Record<Gate, GateDef>> = {
  product_confirmation: {
    from: "awaiting_product_confirmation",
    to: "sourcing",
    nextStep: "source",
    // "Wrong product": analyse again from scratch.
    onReject: { to: "analyzing", step: "analyze" },
  },
  supplier_choice: {
    from: "awaiting_supplier_choice",
    to: "building_page_and_videos",
    nextStep: "build",
    // "None of these": search suppliers again.
    onReject: { to: "sourcing", step: "source" },
  },
  content_approval: {
    from: "awaiting_content_approval",
    to: "preparing_campaign",
    nextStep: "prepare_campaign",
    // The page is approved (and published) first; videos plug in with M3.
    parts: ["page", "videos"],
    // Page rejected (or copy regenerated): build again, same Shopify draft.
    onReject: { to: "building_page_and_videos", step: "build" },
  },
  launch: { from: "ready_to_launch", to: "launched", nextStep: "launch" },
};

/** Happy path, in order (for progress bars). `failed` is off the path. */
export const PRODUCT_FLOW: readonly ProductStatus[] = [
  "imported",
  "analyzing",
  "awaiting_product_confirmation",
  "sourcing",
  "awaiting_supplier_choice",
  "building_page_and_videos",
  "awaiting_content_approval",
  "preparing_campaign",
  "ready_to_launch",
  "launched",
];

/** What a gate transition must present: the approval row that was recorded. */
export type ApprovalEvidence = {
  id: string;
  productId: string;
  gate: Gate;
  decision: "approved" | "rejected";
  userId: string;
  /** For gates with parts: every part approved once this approval is recorded. */
  parts?: readonly GatePart[];
};

export type ProductEvent =
  /** imported → analyzing (the pipeline starts). */
  | { type: "start" }
  | { type: "step_succeeded"; step: ProductStep }
  | { type: "step_failed"; step: ProductStep; error: string }
  | { type: "gate_approved"; productId: string; approval: ApprovalEvidence }
  /** A recorded rejection; only gates with `onReject` accept it. */
  | { type: "gate_rejected"; productId: string; approval: ApprovalEvidence }
  /** failed → the failed step's retry status. */
  | { type: "retry"; step: ProductStep };

export class InvalidTransitionError extends Error {
  readonly from: ProductStatus;
  readonly event: ProductEvent["type"];

  constructor(from: ProductStatus, event: ProductEvent, reason: string) {
    super(`Cannot apply "${event.type}" to a product in "${from}": ${reason}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.event = event.type;
  }
}

type Result = { ok: true; to: ProductStatus } | { ok: false; reason: string };

function evaluate(from: ProductStatus, event: ProductEvent): Result {
  switch (event.type) {
    case "start":
      return from === "imported"
        ? { ok: true, to: STEPS.analyze.running }
        : { ok: false, reason: "only an imported product can start" };

    case "step_succeeded": {
      // Launch success goes through gate_approved, never here.
      if (event.step === "launch") {
        return { ok: false, reason: "launch completes through the GATE 4 approval" };
      }
      const step = STEPS[event.step];
      return from === step.running
        ? { ok: true, to: step.success }
        : { ok: false, reason: `step "${event.step}" is not running` };
    }

    case "step_failed": {
      const step = STEPS[event.step];
      return from === step.running
        ? { ok: true, to: "failed" }
        : { ok: false, reason: `step "${event.step}" is not running` };
    }

    case "retry":
      return from === "failed"
        ? { ok: true, to: STEPS[event.step].retryTo }
        : { ok: false, reason: "only a failed product can be retried" };

    case "gate_approved":
    case "gate_rejected": {
      const { approval } = event;
      const gate = GATES[approval.gate];
      const approving = event.type === "gate_approved";
      if (from !== gate.from) {
        return { ok: false, reason: `the product is not waiting at gate "${approval.gate}"` };
      }
      if (approval.decision !== (approving ? "approved" : "rejected")) {
        return {
          ok: false,
          reason: approving
            ? "the recorded decision is not an approval"
            : "the recorded decision is not a rejection",
        };
      }
      if (approval.productId !== event.productId) {
        return { ok: false, reason: "the approval belongs to another product" };
      }
      if (!approval.id || !approval.userId) {
        return { ok: false, reason: "the approval was not recorded by a user" };
      }
      if (approving) {
        const missing = missingGateParts(approval.gate, approval.parts ?? []);
        if (missing.length > 0) {
          return { ok: false, reason: `parts not approved yet: ${missing.join(", ")}` };
        }
        return { ok: true, to: gate.to };
      }
      if (!gate.onReject) {
        return { ok: false, reason: `rejecting gate "${approval.gate}" is not supported yet` };
      }
      return { ok: true, to: gate.onReject.to };
    }
  }
}

/** Parts of a gate (empty for single-decision gates). */
export function gateParts(gate: Gate): readonly GatePart[] {
  return GATES[gate].parts ?? [];
}

/** Parts of `gate` not in `approved`. */
export function missingGateParts(gate: Gate, approved: readonly GatePart[]): GatePart[] {
  return gateParts(gate).filter((part) => !approved.includes(part));
}

/** Whether a rejection at this gate moves the product (and which step re-runs). */
export function rejectionTarget(gate: Gate): GateDef["onReject"] | null {
  return GATES[gate].onReject ?? null;
}

/** Next status, or throws InvalidTransitionError. */
export function transition(from: ProductStatus, event: ProductEvent): ProductStatus {
  const result = evaluate(from, event);
  if (!result.ok) throw new InvalidTransitionError(from, event, result.reason);
  return result.to;
}

export function canTransition(from: ProductStatus, event: ProductEvent): boolean {
  return evaluate(from, event).ok;
}

/** The gate the product is waiting at, if any. */
export function gateForStatus(status: ProductStatus): Gate | null {
  for (const [gate, def] of Object.entries(GATES) as [Gate, GateDef][]) {
    if (def.from === status) return gate;
  }
  return null;
}

/** The step that runs in this status (ready_to_launch → null: it waits for GATE 4). */
export function stepForStatus(status: ProductStatus): ProductStep | null {
  for (const [step, def] of Object.entries(STEPS) as [ProductStep, StepDef][]) {
    if (step !== "launch" && def.running === status) return step;
  }
  return null;
}

export function isRunningStatus(status: ProductStatus): boolean {
  return stepForStatus(status) !== null;
}

export function isTerminalStatus(status: ProductStatus): boolean {
  return status === "launched";
}

/** 0..1 position on the happy path (failed → null). */
export function progressOf(status: ProductStatus): number | null {
  const index = PRODUCT_FLOW.indexOf(status);
  return index < 0 ? null : index / (PRODUCT_FLOW.length - 1);
}
