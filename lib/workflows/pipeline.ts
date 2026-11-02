/**
 * The product pipeline as services see it. One implementation per engine,
 * same step design either way:
 *
 *   analyze → GATE 1 → source → GATE 2 → build → GATE 3 → prepare_campaign
 *   → GATE 4 → launch
 *
 * - `createInlinePipeline` (M1): runs each step synchronously inside the
 *   service call, through `runProductStep`.
 * - Vercel Workflow (M2): `start` calls `start(productWorkflow, [workspaceId,
 *   productId])` from "workflow/api"; the workflow awaits a hook per gate
 *   (`gateHookToken`) and `continueAfterGate` calls `resumeHook(token,
 *   { approvalId })`. The gate service has already recorded the approval and
 *   moved the status, so the hook only wakes the run; the step re-checks the
 *   status (idempotent) before doing anything.
 */
import type { Gate, ProductStatus } from "@/lib/domain/contracts";
import { GATES, rejectionTarget, type ProductStep } from "@/lib/domain/state-machine";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { applyProductEvent } from "./product-status";
import { runProductStep, type RunnerDeps, type StepOutcome } from "./runner";

export interface ProductPipeline {
  /** imported → analyzing, then runs (or schedules) the analyze step. */
  start(ctx: WorkspaceContext, productId: string): Promise<StepOutcome>;
  /** After a gate approval moved the product into the next step. */
  continueAfterGate(
    ctx: WorkspaceContext,
    productId: string,
    gate: Gate,
    approvalId: string,
  ): Promise<StepOutcome | null>;
  /**
   * After a gate rejection moved the product back (GATE 1: into analyzing).
   * Durable engine: resume the gate hook with { decision: "rejected" } and
   * the workflow loops back to the rejected gate's `onReject.step`.
   */
  restartAfterRejection(
    ctx: WorkspaceContext,
    productId: string,
    gate: Gate,
    approvalId: string,
  ): Promise<StepOutcome | null>;
  /** After `retry` moved a failed product back into `step`. */
  resumeStep(ctx: WorkspaceContext, productId: string, step: ProductStep): Promise<StepOutcome>;
  /**
   * After `step_back` moved a product from `from` to an earlier gate. Nothing
   * runs: the durable engine wakes the run waiting on `from`'s hook so it
   * re-reads the status and waits on the earlier gate instead.
   */
  wakeAfterStepBack(ctx: WorkspaceContext, productId: string, from: ProductStatus): Promise<void>;
}

export { gateHookToken } from "./durable/config";

export function createInlinePipeline(deps: RunnerDeps): ProductPipeline {
  return {
    async start(ctx, productId) {
      await applyProductEvent(ctx.db, productId, { type: "start" });
      return runProductStep(ctx, productId, "analyze", deps);
    },

    async continueAfterGate(ctx, productId, gate) {
      const next = GATES[gate].nextStep;
      // Launch is performed by the launch service itself.
      if (next === "launch") return null;
      return runProductStep(ctx, productId, next, deps);
    },

    async restartAfterRejection(ctx, productId, gate) {
      const target = rejectionTarget(gate);
      return target ? runProductStep(ctx, productId, target.step, deps) : null;
    },

    async resumeStep(ctx, productId, step) {
      return runProductStep(ctx, productId, step, deps);
    },

    // Inline: no run is waiting, the next gate decision runs the next step.
    async wakeAfterStepBack() {},
  };
}
