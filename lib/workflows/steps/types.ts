import type { Integrations, Metered } from "@/lib/domain/contracts";
import type { ProductStep } from "@/lib/domain/state-machine";
import type { product } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Patch, Row } from "@/lib/tenant/scoped-db";

import type { LimitKind } from "../concurrency";

export type StepEnv = {
  /** Scoped to the product's workspace. Steps never check roles: the service that triggered them did. */
  ctx: WorkspaceContext;
  integrations: Integrations;
  now: () => Date;
  /**
   * Wraps every AI / paid-API call: monthly cap check, then usage recorded in
   * usage_monthly (lib/ai meteredCall) and the cost added to the job row.
   * Throws IntegrationError("quota_exceeded") (not retryable) at the cap.
   */
  metered: <T>(call: () => Promise<Metered<T>>) => Promise<Metered<T> & { costUsd: number }>;
};

export type StepResult = {
  /** Product columns written atomically with the step_succeeded transition. */
  patch?: Omit<Patch<typeof product>, "status">;
};

/**
 * One pipeline step. `run` must be idempotent: it may be called again after a
 * crash or a retry, and must converge to the same result without duplicating
 * side effects (upserts keyed on natural ids, check-before-create).
 */
export type StepDefinition = {
  step: ProductStep;
  /** Workspace concurrency bucket this step counts against. */
  limit: LimitKind;
  run(env: StepEnv, row: Row<typeof product>): Promise<StepResult>;
};
