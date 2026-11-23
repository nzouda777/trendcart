import "server-only";

import {
  hasAccess,
  LIMIT_LABELS,
  planLimitsSchema,
  withinLimit,
  type PlanLimits,
} from "@/lib/domain/billing";
import { workspaceSettings, workspaceSubscription } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";

import { ServiceError } from "../errors";

/*
 * What a workspace may do, from its subscription and the platform plans.
 *
 * - Suspended by a platform admin: nothing (pages show the suspension).
 * - No plan published yet: billing does not apply, no limits.
 * - Otherwise the workspace needs a subscription giving access (Stripe
 *   trialing/active/past_due, a running free trial, or an admin grant). Its
 *   plan limits apply live: an admin editing a plan changes every subscriber.
 */

const UNLIMITED: PlanLimits = planLimitsSchema.parse({});

export type Entitlement = {
  billingActive: boolean;
  access: boolean;
  suspended: { at: Date; reason: string | null } | null;
  subscription: Row<typeof workspaceSubscription> | null;
  plan: { id: string; name: string; kind: "paid" | "trial" } | null;
  limits: PlanLimits;
};

export async function loadEntitlement(db: ScopedDb, now: Date = new Date()): Promise<Entitlement> {
  const [settings, sub] = await Promise.all([
    db.findFirst(workspaceSettings),
    db.findFirst(workspaceSubscription),
  ]);
  const plans = await db.readPlans(sub?.planId ? [sub.planId] : []);
  const suspended = settings?.suspendedAt
    ? { at: settings.suspendedAt, reason: settings.suspendedReason ?? null }
    : null;
  const billingActive = plans.some((p) => p.status === "published");
  const planRow = sub?.planId ? (plans.find((p) => p.id === sub.planId) ?? null) : null;
  const subscribed = hasAccess(sub, now);
  const limits =
    subscribed && planRow
      ? (planLimitsSchema.safeParse(planRow.limits).data ?? UNLIMITED)
      : UNLIMITED;
  return {
    billingActive,
    access: !suspended && (!billingActive || subscribed),
    suspended,
    subscription: sub ?? null,
    plan: planRow ? { id: planRow.id, name: planRow.name, kind: planRow.kind } : null,
    limits: billingActive ? limits : UNLIMITED,
  };
}

/** Refuses when the workspace is suspended or has no subscription giving access. */
export async function assertAccess(ctx: WorkspaceContext, now?: Date): Promise<Entitlement> {
  const e = await loadEntitlement(ctx.db, now);
  if (e.suspended) {
    throw new ServiceError(
      "precondition_failed",
      `This workspace is suspended${e.suspended.reason ? ` (${e.suspended.reason})` : ""}. Contact Trendcart support.`,
      { reason: "workspace_suspended" },
    );
  }
  if (!e.access) {
    throw new ServiceError(
      "precondition_failed",
      "This workspace has no active subscription. Choose a plan in Billing to continue.",
      { reason: "subscription_required" },
    );
  }
  return e;
}

/** Access plus one plan limit: `used` is the current count, `adding` what the action adds. */
export async function assertWithinLimit(
  ctx: WorkspaceContext,
  key: Exclude<keyof PlanLimits, "aiMonthlyCapUsd">,
  used: number | (() => Promise<number>),
  adding = 1,
): Promise<void> {
  const e = await assertAccess(ctx);
  const limit = e.limits[key];
  if (limit === null) return;
  const count = typeof used === "function" ? await used() : used;
  if (!withinLimit(limit, count, adding)) {
    throw new ServiceError(
      "precondition_failed",
      `Your plan${e.plan ? ` (${e.plan.name})` : ""} allows ${limit} ${LIMIT_LABELS[key].toLowerCase()}. Upgrade in Billing to add more.`,
      { reason: "plan_limit" },
    );
  }
}
