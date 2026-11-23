import "server-only";

import { and, count, desc, eq, gte, inArray, isNotNull, ne, or, sql, sum } from "drizzle-orm";

import { hasAccess, type SubscriptionStatus } from "@/lib/domain/billing";
import {
  campaign,
  job,
  organization,
  platformAuditLog,
  product,
  shopifyConnection,
  stripeEvent,
  tiktokAdConnection,
  tiktokProfileConnection,
  usageMonthly,
  user,
  workspaceSettings,
  workspaceSubscription,
} from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

/*
 * Admin dashboard figures, computed from Trendcart's own tables only.
 * Revenue is what subscribers pay according to their stored Stripe price
 * (monthly recurring revenue: yearly prices / 12). Nothing is estimated.
 */

const DAY = 86_400_000;

export type DashboardDTO = {
  totals: {
    workspaces: number;
    users: number;
    products: number;
    campaignsActive: number;
    campaignsLaunched: number;
    suspended: number;
  };
  last30: { workspaces: number; users: number; products: number };
  billing: {
    mrrUsd: number;
    payingSubscriptions: number;
    trials: number;
    adminGrants: number;
    pastDue: number;
    canceledLast30: number;
    byPlan: { planId: string | null; count: number }[];
  };
  ai: { month: string; costUsd: number; apiCalls: number };
  aiByMonth: { month: string; costUsd: number }[];
  signupsByDay: { day: string; users: number; workspaces: number }[];
  health: {
    failedJobs7d: number;
    connectionsNeedingAttention: number;
    stripeEventErrors: number;
  };
  recentAdminActions: { id: string; action: string; createdAt: string; targetId: string | null }[];
};

const n = (v: unknown) => Number(v ?? 0);

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function loadDashboard(db: Database, now = new Date()): Promise<DashboardDTO> {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const month = now.toISOString().slice(0, 7);
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
    .toISOString()
    .slice(0, 7);
  const nonAdmin = or(ne(user.role, "admin"), sql`${user.role} is null`);

  const [
    [ws],
    [us],
    [pr],
    [campActive],
    [campLaunched],
    [suspended],
    [ws30],
    [us30],
    [pr30],
    subs,
    [aiNow],
    aiMonths,
    newUsers,
    newWorkspaces,
    [failed],
    [shopBad],
    [adsBad],
    [profilesBad],
    [stripeErrors],
    recent,
  ] = await Promise.all([
    db.select({ c: count() }).from(organization),
    db.select({ c: count() }).from(user).where(nonAdmin),
    db.select({ c: count() }).from(product),
    db.select({ c: count() }).from(campaign).where(eq(campaign.status, "active")),
    db.select({ c: count() }).from(campaign).where(isNotNull(campaign.launchedAt)),
    db
      .select({ c: count() })
      .from(workspaceSettings)
      .where(isNotNull(workspaceSettings.suspendedAt)),
    db.select({ c: count() }).from(organization).where(gte(organization.createdAt, since30)),
    db
      .select({ c: count() })
      .from(user)
      .where(and(nonAdmin, gte(user.createdAt, since30))),
    db.select({ c: count() }).from(product).where(gte(product.createdAt, since30)),
    db.select().from(workspaceSubscription),
    db
      .select({ cost: sum(usageMonthly.aiCostUsd), calls: sum(usageMonthly.apiCalls) })
      .from(usageMonthly)
      .where(eq(usageMonthly.month, month)),
    db
      .select({ month: usageMonthly.month, cost: sum(usageMonthly.aiCostUsd) })
      .from(usageMonthly)
      .where(gte(usageMonthly.month, sixMonthsAgo))
      .groupBy(usageMonthly.month)
      .orderBy(usageMonthly.month),
    db
      .select({ createdAt: user.createdAt })
      .from(user)
      .where(and(nonAdmin, gte(user.createdAt, since30))),
    db
      .select({ createdAt: organization.createdAt })
      .from(organization)
      .where(gte(organization.createdAt, since30)),
    db
      .select({ c: count() })
      .from(job)
      .where(and(eq(job.status, "failed"), gte(job.updatedAt, since7))),
    db
      .select({ c: count() })
      .from(shopifyConnection)
      .where(inArray(shopifyConnection.status, ["needs_reauth", "revoked", "expiring"])),
    db
      .select({ c: count() })
      .from(tiktokAdConnection)
      .where(inArray(tiktokAdConnection.status, ["needs_reauth", "revoked", "expiring"])),
    db
      .select({ c: count() })
      .from(tiktokProfileConnection)
      .where(inArray(tiktokProfileConnection.status, ["needs_reauth", "revoked", "expiring"])),
    db
      .select({ c: count() })
      .from(stripeEvent)
      .where(and(isNotNull(stripeEvent.error), sql`${stripeEvent.processedAt} is null`)),
    db.select().from(platformAuditLog).orderBy(desc(platformAuditLog.createdAt)).limit(8),
  ]);

  let mrrCents = 0;
  let paying = 0;
  let trials = 0;
  let grants = 0;
  let pastDue = 0;
  let canceled30 = 0;
  const byPlan = new Map<string | null, number>();
  for (const s of subs) {
    const status = s.status as SubscriptionStatus;
    if (status === "canceled" && s.canceledAt && s.canceledAt >= since30) canceled30++;
    if (!hasAccess(s, now)) continue;
    byPlan.set(s.planId, (byPlan.get(s.planId) ?? 0) + 1);
    if (s.source === "admin") grants++;
    else if (status === "trialing") trials++;
    if (status === "past_due") pastDue++;
    if (s.source === "stripe" && status !== "trialing" && s.unitAmountCents) {
      paying++;
      mrrCents += s.interval === "year" ? s.unitAmountCents / 12 : s.unitAmountCents;
    }
  }

  const days: DashboardDTO["signupsByDay"] = [];
  for (let i = 29; i >= 0; i--) {
    days.push({ day: dayKey(new Date(now.getTime() - i * DAY)), users: 0, workspaces: 0 });
  }
  const index = new Map(days.map((d, i) => [d.day, i]));
  for (const u of newUsers) {
    const i = index.get(dayKey(u.createdAt));
    if (i !== undefined) days[i]!.users++;
  }
  for (const w of newWorkspaces) {
    const i = index.get(dayKey(w.createdAt));
    if (i !== undefined) days[i]!.workspaces++;
  }

  return {
    totals: {
      workspaces: n(ws?.c),
      users: n(us?.c),
      products: n(pr?.c),
      campaignsActive: n(campActive?.c),
      campaignsLaunched: n(campLaunched?.c),
      suspended: n(suspended?.c),
    },
    last30: { workspaces: n(ws30?.c), users: n(us30?.c), products: n(pr30?.c) },
    billing: {
      mrrUsd: Math.round(mrrCents) / 100,
      payingSubscriptions: paying,
      trials,
      adminGrants: grants,
      pastDue,
      canceledLast30: canceled30,
      byPlan: [...byPlan.entries()].map(([planId, c]) => ({ planId, count: c })),
    },
    ai: { month, costUsd: Math.round(n(aiNow?.cost) * 100) / 100, apiCalls: n(aiNow?.calls) },
    aiByMonth: aiMonths.map((m) => ({
      month: m.month,
      costUsd: Math.round(n(m.cost) * 100) / 100,
    })),
    signupsByDay: days,
    health: {
      failedJobs7d: n(failed?.c),
      connectionsNeedingAttention: n(shopBad?.c) + n(adsBad?.c) + n(profilesBad?.c),
      stripeEventErrors: n(stripeErrors?.c),
    },
    recentAdminActions: recent.map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      targetId: r.targetId,
    })),
  };
}
