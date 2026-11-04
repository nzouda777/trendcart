/**
 * ProductPipeline on Vercel Workflow. Services stay engine-agnostic: they
 * record approvals and move statuses, then call these methods, which only
 * start a run or wake the one waiting on the product's hook.
 *
 * Waking: `resumeHook(token, payload)`. If no hook is registered yet (the run
 * is between a step and its wait, or the product has no run, e.g. imported
 * before the engine landed), a few short retries, then a new run is started.
 * The new run re-reads the status, so it picks up where the product is.
 *
 * Deployments: a run executes on the deployment that started it, with that
 * deployment's code and environment variables. A product imported before a
 * deploy (new code, or an env var such as ANTHROPIC_API_KEY added since)
 * would keep running its later steps on the old deployment. So when the run
 * waiting on the hook belongs to another deployment, it is cancelled and a
 * new run is started on the current one instead of being woken.
 *
 * The workflow runtime is imported lazily so tests and the inline engine
 * never load it.
 */
import type { Gate, ProductStatus } from "@/lib/domain/contracts";
import { GATES, rejectionTarget, type ProductStep } from "@/lib/domain/state-machine";
import { product } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";

import type { ProductPipeline } from "../pipeline";
import { applyProductEvent } from "../product-status";
import { realSleep, type Sleep } from "../retry";
import type { StepOutcome } from "../runner";

import { gateHookToken, nextActionFor, resumeHookToken, type WakePayload } from "./config";

const WAKE_DELAYS_MS = [250, 750, 2_000];

/** The run waiting on the hook was started by another (older) deployment. */
export class StaleDeploymentRunError extends Error {
  constructor(readonly runId: string) {
    super("The workflow run waiting on this hook belongs to another deployment.");
    this.name = "StaleDeploymentRunError";
  }
}

export type DurableEngine = {
  startRun(workspaceId: string, productId: string): Promise<{ runId: string }>;
  resume(token: string, payload: WakePayload): Promise<void>;
};

/** The real engine (workflow/api), loaded on first use. */
export const vercelWorkflowEngine: DurableEngine = {
  async startRun(workspaceId, productId) {
    const [{ start }, { productWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("./product-workflow"),
    ]);
    const run = await start(productWorkflow, [workspaceId, productId]);
    return { runId: run.runId };
  },
  async resume(token, payload) {
    const { getHookByToken, getRun, resumeHook } = await import("workflow/api");
    const current = process.env.VERCEL_DEPLOYMENT_ID;
    if (current) {
      // Throws when no hook is registered: the caller retries, then starts a run.
      const hook = await getHookByToken(token);
      const owner = hook.resumeContext?.deploymentId;
      if (owner && owner !== current) {
        try {
          await getRun(hook.runId).cancel({
            cancelReason: `Superseded by a run on deployment ${current}.`,
          });
        } catch (error) {
          // Already ended, or not cancellable: the new run takes the hook over.
          console.warn("[workflow] could not cancel a run from an older deployment", error);
        }
        throw new StaleDeploymentRunError(hook.runId);
      }
    }
    await resumeHook(token, payload);
  },
};

export function createDurablePipeline(
  engine: DurableEngine = vercelWorkflowEngine,
  options: { sleep?: Sleep } = {},
): ProductPipeline {
  const sleep = options.sleep ?? realSleep;

  async function wakeOrStart(
    ctx: WorkspaceContext,
    productId: string,
    token: string,
    payload: WakePayload,
  ): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        await engine.resume(token, payload);
        return;
      } catch (error) {
        // The waiting run is on an older deployment (and was cancelled): start
        // a fresh run here right away, it re-reads the product status.
        if (error instanceof StaleDeploymentRunError) break;
        if (i >= WAKE_DELAYS_MS.length) break;
        await sleep(WAKE_DELAYS_MS[i]!);
      }
    }
    await engine.startRun(ctx.workspaceId, productId);
  }

  async function queued(
    ctx: WorkspaceContext,
    productId: string,
    step: ProductStep,
  ): Promise<StepOutcome> {
    return { status: "queued", step, product: await ctx.db.getById(product, productId) };
  }

  return {
    async start(ctx, productId) {
      await applyProductEvent(ctx.db, productId, { type: "start" });
      await engine.startRun(ctx.workspaceId, productId);
      return queued(ctx, productId, "analyze");
    },

    async continueAfterGate(ctx, productId, gate: Gate, approvalId) {
      await wakeOrStart(ctx, productId, gateHookToken(ctx.workspaceId, productId, gate), {
        reason: "gate_approved",
        gate,
        approvalId,
      });
      const next = GATES[gate].nextStep;
      return next === "launch" ? null : queued(ctx, productId, next);
    },

    async restartAfterRejection(ctx, productId, gate: Gate, approvalId) {
      const target = rejectionTarget(gate);
      if (!target) return null;
      await wakeOrStart(ctx, productId, gateHookToken(ctx.workspaceId, productId, gate), {
        reason: "gate_rejected",
        gate,
        approvalId,
      });
      return queued(ctx, productId, target.step);
    },

    async resumeStep(ctx, productId, step) {
      await wakeOrStart(ctx, productId, resumeHookToken(ctx.workspaceId, productId), {
        reason: "retry",
      });
      return queued(ctx, productId, step);
    },

    async wakeAfterStepBack(ctx, productId, from: ProductStatus) {
      // The run waits on the hook of the status the product left (a gate, or
      // the resume hook when it failed). Woken, it re-reads the status and
      // waits on the earlier gate. No run to wake: the next gate decision
      // starts one (wakeOrStart), so nothing is started here.
      const next = nextActionFor(ctx.workspaceId, productId, from);
      if (next.kind !== "wait") return;
      for (let i = 0; ; i++) {
        try {
          await engine.resume(next.token, { reason: "step_back" });
          return;
        } catch (error) {
          // Old-deployment run cancelled: the next gate decision starts a new one.
          if (error instanceof StaleDeploymentRunError) return;
          if (i >= WAKE_DELAYS_MS.length) return;
          await sleep(WAKE_DELAYS_MS[i]!);
        }
      }
    },
  };
}
