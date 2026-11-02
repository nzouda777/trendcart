/**
 * Durable engine settings and pure helpers (no workflow runtime imports, so
 * tests and the inline engine can use them).
 */
import type { Gate, ProductStatus } from "@/lib/domain/contracts";
import { gateForStatus, stepForStatus, type ProductStep } from "@/lib/domain/state-machine";

/** Engine attempts per step (step.maxRetries = DURABLE_STEP_ATTEMPTS - 1). */
export const DURABLE_STEP_ATTEMPTS = 5;
const DURABLE_BASE_DELAY_MS = 30_000;
const DURABLE_MAX_DELAY_MS = 10 * 60_000;

/** Delay before the engine retries a deferred step: 30 s, 1 min, 2 min … capped at 10 min. */
export function durableRetryDelayMs(attempt: number): number {
  return Math.min(DURABLE_MAX_DELAY_MS, DURABLE_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

/** Loop guard: each iteration is one step run or one wait (far below 25,000 events). */
export const MAX_WORKFLOW_ITERATIONS = 200;

/** Hook token one workflow run waits on for one gate (unique per product and gate). */
export function gateHookToken(workspaceId: string, productId: string, gate: Gate) {
  return `tc:gate:${workspaceId}:${productId}:${gate}`;
}

/** Hook a failed (or stuck) product's run waits on until retryStep wakes it. */
export function resumeHookToken(workspaceId: string, productId: string) {
  return `tc:resume:${workspaceId}:${productId}`;
}

/** What wakes a waiting run. Only ids: the services already did the work. */
export type WakePayload = {
  reason: "gate_approved" | "gate_rejected" | "retry" | "step_back";
  gate?: Gate;
  approvalId?: string;
};

export type NextAction =
  | { kind: "run"; step: ProductStep }
  | { kind: "wait"; token: string; why: "gate" | "retry" }
  | { kind: "done"; status: ProductStatus };

/** What the workflow does next for a product in `status` (pure). */
export function nextActionFor(
  workspaceId: string,
  productId: string,
  status: ProductStatus,
): NextAction {
  if (status === "launched") return { kind: "done", status };
  const step = stepForStatus(status);
  if (step) return { kind: "run", step };
  const gate = gateForStatus(status);
  if (gate)
    return { kind: "wait", token: gateHookToken(workspaceId, productId, gate), why: "gate" };
  // failed (and imported, which `start` moves on before the run begins).
  return { kind: "wait", token: resumeHookToken(workspaceId, productId), why: "retry" };
}
