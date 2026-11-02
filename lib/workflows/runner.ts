/**
 * Runs one pipeline step for one product, the same way the durable workflow
 * will: job row → attempts with backoff (retryable errors only) inside a
 * workspace concurrency slot → step_succeeded (with the step's patch) or
 * step_failed with the error stored on the job.
 *
 * Idempotent: if the product is no longer in the step's running status
 * (another run finished it, or it was never started) nothing happens.
 */
import { meteredCall } from "@/lib/ai/metering";
import type { Integrations } from "@/lib/domain/contracts";
import { STEPS, type ProductStep } from "@/lib/domain/state-machine";
import { product } from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { withWorkspaceSlot, type ConcurrencyLimiter } from "./concurrency";
import {
  addJobCost,
  beginAttempt,
  deferJob,
  failJob,
  queueJob,
  succeedJob,
  type JobRow,
} from "./jobs";
import { applyProductEventTo, type ProductRow } from "./product-status";
import { describeError, isRetryable, MAX_ATTEMPTS, withBackoff, type Sleep } from "./retry";
import { STEP_HANDLERS } from "./steps";
import type { StepDefinition, StepEnv } from "./steps/types";

export type RunnerDeps = {
  integrations: Integrations;
  limiter: ConcurrencyLimiter;
  now?: () => Date;
  sleep?: Sleep;
  maxAttempts?: number;
  /** Monthly AI cap override (defaults to AI_MONTHLY_CAP_USD via lib/ai). */
  aiCapUsd?: number;
  /** Override the step registry (tests). */
  handlers?: Partial<Record<ProductStep, StepDefinition>>;
  /**
   * Durable engine: when the last in-process attempt fails with a retryable
   * error, keep the product in its running status, put the job back to
   * "queued" with the error, and return `deferred` so the engine retries the
   * step later (longer backoff than in-process). The engine passes false on
   * its own last attempt, so the product then enters `failed` as usual.
   */
  deferRetryable?: boolean;
};

export type StepOutcome =
  | { status: "succeeded"; step: ProductStep; product: ProductRow }
  | { status: "failed"; step: ProductStep; product: ProductRow; error: string }
  /** No handler yet (later milestone): the job stays queued. */
  | { status: "queued"; step: ProductStep; product: ProductRow }
  /** The product was not in the step's running status: nothing to do. */
  | { status: "skipped"; step: ProductStep; product: ProductRow }
  /** Retryable failure handed back to the durable engine (deferRetryable). */
  | { status: "deferred"; step: ProductStep; product: ProductRow; error: string };

class NotRunning extends Error {}

export async function runProductStep(
  ctx: WorkspaceContext,
  productId: string,
  step: ProductStep,
  deps: RunnerDeps,
): Promise<StepOutcome> {
  const { db } = ctx;
  const now = deps.now ?? (() => new Date());
  const running = STEPS[step].running;

  const initial = await db.getById(product, productId);
  if (initial.status !== running || step === "launch") {
    return { status: "skipped", step, product: initial };
  }

  const handler = (deps.handlers ?? STEP_HANDLERS)[step];
  if (!handler) {
    await queueJob(db, productId, step);
    return { status: "queued", step, product: initial };
  }

  let jobRow: JobRow | undefined;
  try {
    const result = await withBackoff(
      async () => {
        jobRow = await beginAttempt(db, productId, step, now());
        const row = await db.getById(product, productId);
        if (row.status !== running) throw new NotRunning();

        const metered: StepEnv["metered"] = async (call) => {
          const result = await meteredCall(db, { workspaceId: ctx.workspaceId }, call, {
            capUsd: deps.aiCapUsd,
            now,
          });
          if (jobRow) jobRow = await addJobCost(db, jobRow, result.costUsd);
          return result;
        };
        return withWorkspaceSlot(deps.limiter, ctx.workspaceId, handler.limit, () =>
          handler.run({ ctx, integrations: deps.integrations, now, metered }, row),
        );
      },
      { sleep: deps.sleep, maxAttempts: deps.maxAttempts ?? MAX_ATTEMPTS },
    );

    const updated = await applyProductEventTo(
      db,
      { id: productId, status: running },
      { type: "step_succeeded", step },
      result.patch ?? {},
    );
    if (jobRow) await succeedJob(db, jobRow.id, now());
    return { status: "succeeded", step, product: updated };
  } catch (error) {
    if (error instanceof NotRunning || isConflict(error)) {
      if (jobRow) await succeedJob(db, jobRow.id, now());
      return { status: "skipped", step, product: await db.getById(product, productId) };
    }

    const message = describeError(error);
    if (deps.deferRetryable && isRetryable(error)) {
      if (jobRow) await deferJob(db, jobRow.id, message);
      return {
        status: "deferred",
        step,
        product: await db.getById(product, productId),
        error: message,
      };
    }
    if (!(error instanceof Error) || error.name !== "IntegrationError") {
      // Unexpected (bug, schema mismatch): keep it visible to Sentry / logs.
      console.error(`[workflow] step "${step}" failed for product ${productId}`, error);
    }
    if (jobRow) await failJob(db, jobRow.id, message, now());
    const failed = await applyProductEventTo(
      db,
      { id: productId, status: running },
      { type: "step_failed", step, error: message },
    ).catch(async (e) => {
      if (isConflict(e)) return db.getById(product, productId);
      throw e;
    });
    return { status: "failed", step, product: failed, error: message };
  }
}

function isConflict(error: unknown) {
  return error instanceof ServiceError && error.code === "conflict";
}
