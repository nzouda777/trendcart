import "server-only";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/guards";
import { usageMonthly } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import { monthKey } from "@/lib/ai/metering";

import type { UsageDTO } from "./types";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

/** AI cost and paid API calls for one UTC month (default: current month). Zeros when none. */
export async function getUsage(ctx: WorkspaceContext, month?: string): Promise<UsageDTO> {
  requirePermission(ctx, "usage:read");
  const key = month === undefined ? monthKey(new Date()) : monthSchema.parse(month);
  const row = await ctx.db.findFirst(usageMonthly, eq(usageMonthly.month, key));
  return { month: key, aiCostUsd: row?.aiCostUsd ?? 0, apiCalls: row?.apiCalls ?? 0 };
}

/** Most recent months first (for a usage chart). */
export async function listUsage(ctx: WorkspaceContext, limit = 12): Promise<UsageDTO[]> {
  requirePermission(ctx, "usage:read");
  const n = z.number().int().min(1).max(36).parse(limit);
  const rows = await ctx.db.select(usageMonthly, { orderBy: (t) => desc(t.month), limit: n });
  return rows.map((r) => ({ month: r.month, aiCostUsd: r.aiCostUsd, apiCalls: r.apiCalls }));
}
