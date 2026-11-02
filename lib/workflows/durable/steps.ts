/**
 * Step functions of the durable product workflow (Vercel Workflow, "use
 * step"). They run as normal server code with full Node.js access, are
 * retried by the engine, and only take and return ids and plain values.
 *
 * Each step re-reads the product and goes through the same runner as the
 * inline engine (lib/workflows/runner.ts): job rows, workspace concurrency
 * slots, AI metering and optimistic status checks are identical.
 */
import { eq } from "drizzle-orm";
import { FatalError, getStepMetadata, RetryableError } from "workflow";

import type { ProductStatus } from "@/lib/domain/contracts";
import type { ProductStep } from "@/lib/domain/state-machine";
import { product } from "@/lib/db/schema";
import { getIntegrations } from "@/lib/integrations";
import { getSystemContext } from "@/lib/tenant/system";

import { getConcurrencyLimiter } from "../concurrency";
import { applyProductEvent } from "../product-status";
import { runProductStep, type StepOutcome } from "../runner";

import {
  DURABLE_STEP_ATTEMPTS,
  durableRetryDelayMs,
  nextActionFor,
  type NextAction,
} from "./config";

function systemContext(workspaceId: string, name: string) {
  return getSystemContext(workspaceId, `workflow:${name}`);
}

/** Reads the product and decides the next move (starts an imported product). */
export async function loadNextAction(workspaceId: string, productId: string): Promise<NextAction> {
  "use step";
  const ctx = systemContext(workspaceId, "next");
  let row = await ctx.db.findFirst(product, eq(product.id, productId));
  if (!row) throw new FatalError("Product not found in this workspace.");
  if (row.status === "imported") row = await applyProductEvent(ctx.db, row.id, { type: "start" });
  return nextActionFor(workspaceId, productId, row.status);
}

/** Runs one pipeline step; retryable failures go back to the engine with a long backoff. */
export async function runPipelineStep(
  workspaceId: string,
  productId: string,
  step: ProductStep,
): Promise<{ status: StepOutcome["status"]; productStatus: ProductStatus }> {
  "use step";
  const { attempt } = getStepMetadata();
  const outcome = await runProductStep(systemContext(workspaceId, step), productId, step, {
    integrations: getIntegrations(),
    limiter: getConcurrencyLimiter(),
    // One in-process attempt: the engine owns retries and their backoff.
    maxAttempts: 1,
    deferRetryable: attempt < DURABLE_STEP_ATTEMPTS,
  });
  if (outcome.status === "deferred") {
    throw new RetryableError(outcome.error, { retryAfter: durableRetryDelayMs(attempt) });
  }
  return { status: outcome.status, productStatus: outcome.product.status };
}
runPipelineStep.maxRetries = DURABLE_STEP_ATTEMPTS - 1;
