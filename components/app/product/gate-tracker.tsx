import { CheckIcon, LoaderIcon, XIcon } from "lucide-react";

import type { Gate, ProductStatus } from "@/lib/domain/contracts";
import { GATES, PRODUCT_FLOW, STEPS, type ProductStep } from "@/lib/domain/state-machine";
import type { GatePart } from "@/lib/domain/state-machine";
import type { ApprovalDTO, GatePartState } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import { GATE_META, GATE_ORDER, STEP_LABELS, whoApproves } from "../product-status";
import { pagePartState } from "./page-state";

type GateState = "done" | "waiting" | "working" | "failed" | "upcoming";

/** Index in the happy path; `failed` maps to the step that failed. */
function flowIndex(status: ProductStatus, failedStep: ProductStep | null): number {
  if (status === "failed") {
    return failedStep ? PRODUCT_FLOW.indexOf(STEPS[failedStep].running) : 0;
  }
  return PRODUCT_FLOW.indexOf(status);
}

function gateState(gate: Gate, status: ProductStatus, failedStep: ProductStep | null): GateState {
  const at = flowIndex(status, failedStep);
  const gateAt = PRODUCT_FLOW.indexOf(GATES[gate].from);
  if (status === "launched" || at > gateAt) return "done";
  if (at === gateAt) return status === "failed" ? "failed" : "waiting";
  // The step leading to this gate is running (or failed).
  const prevGate = GATE_ORDER[GATE_ORDER.indexOf(gate) - 1];
  const prevAt = prevGate ? PRODUCT_FLOW.indexOf(GATES[prevGate].from) : -1;
  if (at > prevAt) return status === "failed" ? "failed" : "working";
  return "upcoming";
}

const PART_LABEL: Record<GatePart, string> = { page: "Page", videos: "Videos" };

function waitingDetail(
  gate: Gate,
  parts: Record<GatePart, GatePartState> | undefined,
  launching: boolean,
): string {
  const who = whoApproves(gate);
  if (gate === "content_approval" && parts) {
    if (pagePartState(parts) === "publishing") return "Page approved, publishing to Shopify";
    const keys = Object.keys(parts) as GatePart[];
    const approved = keys.filter((p) => parts[p] === "approved");
    const missing = keys.filter((p) => parts[p] !== "approved");
    if (approved.length > 0 && missing.length > 0) {
      const done = approved.map((p) => PART_LABEL[p]).join(" and ");
      const left = missing.map((p) => PART_LABEL[p].toLowerCase()).join(" and ");
      return `${done} approved. Waiting for: ${who} (${left})`;
    }
    return `Waiting for: ${who}`;
  }
  // GATE 4 stays in ready_to_launch while the launch step runs after approval
  // (an older approval of a failed launch does not count: it needs a new one).
  if (gate === "launch" && launching) return "Approved, launching on TikTok";
  return `Waiting for: ${who}`;
}

/**
 * Preparation tracker: the 4 human gates, with what each is waiting for
 * (Trendcart working, or a person with a given role).
 */
export function GateTracker({
  status,
  failedStep,
  approvals,
  contentParts,
  launching = false,
}: {
  status: ProductStatus;
  failedStep: ProductStep | null;
  approvals: ApprovalDTO[];
  /** GATE 3 parts (page, videos), approved separately. */
  contentParts?: Record<GatePart, GatePartState>;
  /** A GATE 4 launch is in flight (launchClaim). */
  launching?: boolean;
}) {
  return (
    <ol className="grid gap-3 md:grid-cols-4" aria-label="Approval gates">
      {GATE_ORDER.map((gate) => {
        const meta = GATE_META[gate];
        const state = gateState(gate, status, failedStep);
        const approval = approvals.find((a) => a.gate === gate && a.decision === "approved");
        const runningStep = GATES[gate].from;
        const stepLabel =
          STEP_LABELS[
            (Object.keys(STEPS) as ProductStep[]).find((s) => STEPS[s].success === runningStep) ??
              ""
          ] ?? "Preparing";

        const failedLabel = failedStep ? STEP_LABELS[failedStep] : stepLabel;
        const detail: Record<GateState, string> = {
          done: approval ? "Approved" : "Passed",
          waiting: waitingDetail(gate, contentParts, launching),
          working: `Trendcart is working: ${stepLabel}`,
          failed: `${failedLabel} failed. Retry below.`,
          upcoming: "Not started",
        };

        return (
          <li
            key={gate}
            aria-current={state === "waiting" ? "step" : undefined}
            className={cn(
              "grid gap-2 rounded-xl border p-3",
              state === "waiting" && "border-warning/40 bg-warning/10",
              state === "done" && "border-brand-border bg-brand-soft",
              state === "failed" && "border-danger/40 bg-danger/10",
              (state === "working" || state === "upcoming") && "border-border bg-background",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  state === "done" && "border-brand bg-brand text-brand-foreground",
                  state === "waiting" && "border-warning text-warning",
                  state === "failed" && "border-danger text-danger",
                  (state === "working" || state === "upcoming") &&
                    "border-border-strong text-muted-foreground",
                )}
              >
                {state === "done" ? (
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                ) : state === "failed" ? (
                  <XIcon aria-hidden="true" className="size-3.5" />
                ) : state === "working" ? (
                  <LoaderIcon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
                ) : (
                  meta.number
                )}
              </span>
              <span className="text-sm font-medium">
                <span className="sr-only">Gate {meta.number}: </span>
                {meta.label}
              </span>
            </div>
            <p
              className={cn(
                "text-xs",
                state === "waiting"
                  ? "text-warning"
                  : state === "failed"
                    ? "text-danger"
                    : "text-muted-foreground",
              )}
            >
              {detail[state]}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
