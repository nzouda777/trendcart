import "server-only";

/**
 * AI cost metering and the per-workspace monthly cap.
 *
 * Adapters return `Metered<T>` (data + AiUsage[]) and never touch the
 * database. The caller (service or workflow step) wraps the call:
 *
 *   const { data, usage } = await meteredCall(ctx.db, callCtx, () =>
 *     integrations.productAnalyzer.analyze(callCtx, input),
 *   );
 *   // usage cost is already in usage_monthly; add it to job.ai_cost_usd too.
 *
 * - Before the call: throws IntegrationError("quota_exceeded") when the
 *   workspace already spent >= its cap this month (UTC).
 * - After the call: atomically adds the cost and call count to
 *   usage_monthly (one row per workspace and month), even when that pushes
 *   the total past the cap, because the money is already spent.
 * - A failed call records nothing (adapters only report usage on success).
 */
import { eq, sql } from "drizzle-orm";

import { usageMonthly } from "@/lib/db/schema";
import {
  aiUsageSchema,
  IntegrationError,
  type AiUsage,
  type CallContext,
  type Metered,
} from "@/lib/domain/contracts";
import type { ScopedDb } from "@/lib/tenant/scoped-db";

/** Default monthly AI budget per workspace, in USD. Override with AI_MONTHLY_CAP_USD. */
export const DEFAULT_AI_MONTHLY_CAP_USD = 50;

export function getAiMonthlyCapUsd(
  env: Partial<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.AI_MONTHLY_CAP_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_AI_MONTHLY_CAP_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("AI_MONTHLY_CAP_USD must be a non-negative number (0 disables AI calls).");
  }
  return value;
}

/** "YYYY-MM" in UTC, the usage_monthly.month key. */
export function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export type MonthlyUsage = { month: string; aiCostUsd: number; apiCalls: number };

export async function getMonthlyUsage(db: ScopedDb, at: Date = new Date()): Promise<MonthlyUsage> {
  const month = monthKey(at);
  const row = await db.findFirst(usageMonthly, (t) => eq(t.month, month));
  return { month, aiCostUsd: Number(row?.aiCostUsd ?? 0), apiCalls: row?.apiCalls ?? 0 };
}

export type BudgetOptions = { capUsd?: number; now?: () => Date };

export type BudgetStatus = MonthlyUsage & {
  capUsd: number;
  remainingUsd: number;
  exceeded: boolean;
};

export async function getAiBudget(
  db: ScopedDb,
  options: BudgetOptions = {},
): Promise<BudgetStatus> {
  const capUsd = options.capUsd ?? getAiMonthlyCapUsd();
  const usage = await getMonthlyUsage(db, (options.now ?? (() => new Date()))());
  const remainingUsd = Math.max(0, capUsd - usage.aiCostUsd);
  return { ...usage, capUsd, remainingUsd, exceeded: usage.aiCostUsd >= capUsd };
}

/** Throws IntegrationError("quota_exceeded") when the monthly cap is reached. */
export async function assertAiBudget(
  db: ScopedDb,
  options: BudgetOptions = {},
): Promise<BudgetStatus> {
  const status = await getAiBudget(db, options);
  if (status.exceeded) {
    throw new IntegrationError(
      "ai",
      "quota_exceeded",
      `Monthly AI budget reached ($${status.aiCostUsd.toFixed(2)} of $${status.capUsd.toFixed(2)} for ${status.month}).`,
      { retryable: false },
    );
  }
  return status;
}

export function totalCostUsd(usage: AiUsage[]): number {
  return Math.round(usage.reduce((sum, u) => sum + u.costUsd, 0) * 1e6) / 1e6;
}

/**
 * Adds `usage` to this month's usage_monthly row (atomic increment, safe under
 * concurrency). `api_calls` counts one per AiUsage entry.
 */
export async function recordAiUsage(
  db: ScopedDb,
  usage: AiUsage[],
  options: { now?: () => Date } = {},
): Promise<{ month: string; costUsd: number; calls: number }> {
  const entries = usage.map((u) => aiUsageSchema.parse(u));
  const month = monthKey((options.now ?? (() => new Date()))());
  const costUsd = totalCostUsd(entries);
  const calls = entries.length;
  if (calls === 0) return { month, costUsd: 0, calls: 0 };

  // `numeric` columns accept the increment expression; the Patch type only knows numbers.
  const increment = {
    aiCostUsd: sql`${usageMonthly.aiCostUsd} + ${costUsd}` as unknown as number,
    apiCalls: sql`${usageMonthly.apiCalls} + ${calls}` as unknown as number,
  };
  await db.upsert(
    usageMonthly,
    { month, aiCostUsd: costUsd, apiCalls: calls },
    { target: (t) => [t.month], set: increment },
  );
  return { month, costUsd, calls };
}

/**
 * Cap check -> call -> record. `ctx` must belong to the same workspace as `db`.
 */
export async function meteredCall<T>(
  db: ScopedDb,
  ctx: Pick<CallContext, "workspaceId">,
  call: () => Promise<Metered<T>>,
  options: BudgetOptions = {},
): Promise<Metered<T> & { costUsd: number }> {
  if (ctx.workspaceId !== db.workspaceId) {
    throw new Error("meteredCall: call context and scoped db belong to different workspaces.");
  }
  await assertAiBudget(db, options);
  const result = await call();
  const { costUsd } = await recordAiUsage(db, result.usage, { now: options.now });
  return { ...result, costUsd };
}
