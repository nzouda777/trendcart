/**
 * One durable workflow run per product (Vercel Workflow, "use workflow"):
 *
 *   analyze → GATE 1 → source → GATE 2 → build → GATE 3 → prepare_campaign
 *   → GATE 4 → (launch, done by the launch service)
 *
 * The run is driven by the product row, not by its own memory: each loop
 * iteration asks `loadNextAction` what to do (run the step of the current
 * running status, or wait). At a gate it waits on the gate hook
 * (`gateHookToken`); when failed it waits on the resume hook
 * (`resumeHookToken`). Gate and retry services record the decision and move
 * the status first, then resume the hook with ids only, so a replay or a
 * duplicate wake-up can never skip a gate: the next iteration re-reads the
 * status. A GATE 1/2/3 rejection simply lands on a running status again.
 *
 * Two runs for one product (e.g. a new run started because a wake-up raced
 * the hook registration) are harmless: steps are idempotent and status
 * changes are optimistic, and the run that loses the hook token stops.
 */
import { createHook } from "workflow";

import { MAX_WORKFLOW_ITERATIONS, resumeHookToken, type WakePayload } from "./config";
import { loadNextAction, runPipelineStep } from "./steps";

export async function productWorkflow(workspaceId: string, productId: string) {
  "use workflow";

  for (let i = 0; i < MAX_WORKFLOW_ITERATIONS; i++) {
    const next = await loadNextAction(workspaceId, productId);
    if (next.kind === "done") return { status: next.status };

    if (next.kind === "run") {
      const result = await runPipelineStep(workspaceId, productId, next.step);
      // "queued": no handler for this step yet (later milestone). Wait for a retry.
      if (result.status !== "queued") continue;
    }

    const token = next.kind === "wait" ? next.token : resumeHookToken(workspaceId, productId);
    const hook = createHook<WakePayload>({ token });
    try {
      await hook;
    } catch {
      // Another run owns this product's hook: let it carry on alone.
      return { status: "superseded" as const };
    } finally {
      hook.dispose();
    }
  }
  return { status: "iteration_limit" as const };
}
