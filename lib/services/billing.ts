import "server-only";

import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import {
  DEFAULT_YEARLY_MULTIPLIER,
  hasAccess,
  planLimitsSchema,
  yearlyCents,
  type PlanLimits,
  type SubscriptionSource,
  type SubscriptionStatus,
} from "@/lib/domain/billing";
import { workspaceSubscription } from "@/lib/db/schema";
import { getStripe, isStripeConfigured } from "@/lib/platform/stripe";
import type { UserWorkspaceContext, WorkspaceContext } from "@/lib/tenant/context";
import type { ScopedDb } from "@/lib/tenant/scoped-db";

import { idSchema } from "./brands";
import { ServiceError } from "./errors";
import { loadEntitlement } from "./internal/entitlements";

/*
 * Billing for a workspace (the Owner pays): Stripe Checkout (hosted page) for
 * paid plans, the Stripe customer portal (hosted) to change card, plan or
 * cancel, and free trial plans started without Stripe (once per workspace).
 * The Stripe webhook (lib/platform/stripe-webhook) writes the subscription.
 */

export type BillingPlanDTO = {
  id: string;
  slug: string;
  kind: "paid" | "trial";
  name: string;
  description: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  limits: PlanLimits;
  features: string[];
  highlighted: boolean;
  badge: string | null;
  trialDays: number;
  trialRequiresCard: boolean;
  /** Buyable now (Stripe prices exist for paid plans). */
  available: boolean;
};

export type BillingOverviewDTO = {
  billingActive: boolean;
  access: boolean;
  suspended: { at: string; reason: string | null } | null;
  subscription: {
    planId: string | null;
    planName: string | null;
    source: SubscriptionSource;
    status: SubscriptionStatus;
    interval: "month" | "year" | null;
    amount: number | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    endsAt: string | null;
    cancelAtPeriodEnd: boolean;
    hasPortal: boolean;
  } | null;
  trialUsed: boolean;
  limits: PlanLimits;
  plans: BillingPlanDTO[];
  canManage: boolean;
  stripeConfigured: boolean;
};

async function multiplier(db: ScopedDb): Promise<number> {
  const value = await db.readPlatformSetting("billing");
  const m = Number((value as { yearlyMultiplier?: unknown } | null)?.yearlyMultiplier);
  return Number.isFinite(m) && m >= 1 ? m : DEFAULT_YEARLY_MULTIPLIER;
}

export async function getBillingOverview(ctx: UserWorkspaceContext): Promise<BillingOverviewDTO> {
  requirePermission(ctx, "workspace:read");
  const [e, rows, defaultMultiplier] = await Promise.all([
    loadEntitlement(ctx.db),
    ctx.db.readPlans(),
    multiplier(ctx.db),
  ]);
  const sub = e.subscription;
  const plans = rows
    .filter((p) => p.status === "published")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p): BillingPlanDTO => {
      const monthly = p.kind === "paid" ? p.priceMonthlyCents : null;
      return {
        id: p.id,
        slug: p.slug,
        kind: p.kind,
        name: p.name,
        description: p.description,
        priceMonthly: monthly === null ? null : monthly / 100,
        priceYearly:
          monthly === null
            ? null
            : yearlyCents(monthly, p.yearlyMultiplier ?? defaultMultiplier) / 100,
        limits: planLimitsSchema.safeParse(p.limits).data ?? planLimitsSchema.parse({}),
        features: p.features ?? [],
        highlighted: p.highlighted,
        badge: p.badge,
        trialDays: p.trialDays,
        trialRequiresCard: p.trialRequiresCard,
        available:
          p.kind === "trial" ||
          (isStripeConfigured() && !!p.stripeMonthlyPriceId && !!p.stripeYearlyPriceId),
      };
    });
  return {
    billingActive: e.billingActive,
    access: e.access,
    suspended: e.suspended
      ? { at: e.suspended.at.toISOString(), reason: e.suspended.reason }
      : null,
    subscription: sub
      ? {
          planId: sub.planId,
          planName: e.plan?.name ?? null,
          source: sub.source,
          status: sub.status,
          interval: sub.interval,
          amount: sub.unitAmountCents === null ? null : sub.unitAmountCents / 100,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          endsAt: sub.endsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          hasPortal: !!sub.stripeCustomerId && isStripeConfigured(),
        }
      : null,
    trialUsed: !!sub?.trialUsedAt,
    limits: e.limits,
    plans,
    canManage: ctx.actor.role === "owner",
    stripeConfigured: isStripeConfigured(),
  };
}

const checkoutSchema = z.object({
  planId: idSchema,
  interval: z.enum(["month", "year"]),
});

function requireOwner(ctx: UserWorkspaceContext) {
  requirePermission(ctx, "workspace:update");
}

/** Stripe Checkout (hosted) for a paid plan. Returns the URL to redirect to. */
export async function startCheckout(
  ctx: UserWorkspaceContext,
  input: z.input<typeof checkoutSchema>,
  urls: { successUrl: string; cancelUrl: string },
): Promise<{ url: string }> {
  requireOwner(ctx);
  const v = checkoutSchema.parse(input);
  if (!isStripeConfigured()) {
    throw new ServiceError("precondition_failed", "Payments are not set up yet. Try again later.");
  }
  const [planRow] = (await ctx.db.readPlans()).filter(
    (p) => p.id === v.planId && p.status === "published" && p.kind === "paid",
  );
  const priceId =
    v.interval === "month" ? planRow?.stripeMonthlyPriceId : planRow?.stripeYearlyPriceId;
  if (!planRow || !priceId) {
    throw new ServiceError("invalid_input", "This plan cannot be bought right now.");
  }
  const sub = await ctx.db.findFirst(workspaceSubscription);
  if (sub?.source === "stripe" && sub.stripeSubscriptionId && hasAccess(sub, new Date())) {
    throw new ServiceError(
      "invalid_state",
      "This workspace already has a subscription. Change plan or billing period in Manage billing.",
    );
  }
  const stripe = getStripe();
  const trial = planRow.trialDays > 0 && !sub?.trialUsedAt ? planRow.trialDays : 0;
  const metadata = { workspaceId: ctx.workspaceId, planId: planRow.id };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    client_reference_id: ctx.workspaceId,
    ...(sub?.stripeCustomerId
      ? { customer: sub.stripeCustomerId }
      : { customer_email: ctx.actor.email }),
    metadata,
    allow_promotion_codes: true,
    ...(trial > 0 && !planRow.trialRequiresCard
      ? { payment_method_collection: "if_required" }
      : {}),
    subscription_data: {
      metadata,
      ...(trial > 0
        ? {
            trial_period_days: trial,
            ...(planRow.trialRequiresCard
              ? {}
              : { trial_settings: { end_behavior: { missing_payment_method: "cancel" } } }),
          }
        : {}),
    },
  });
  if (!session.url)
    throw new ServiceError("invalid_state", "Stripe did not return a checkout page.");
  await writeAudit(ctx, {
    action: "billing.checkout_started",
    targetType: "plan",
    targetId: planRow.id,
    metadata: { interval: v.interval, trialDays: trial },
  });
  return { url: session.url };
}

/** Stripe customer portal (hosted): card, invoices, plan changes, cancellation. */
export async function openBillingPortal(
  ctx: UserWorkspaceContext,
  returnUrl: string,
): Promise<{ url: string }> {
  requireOwner(ctx);
  const sub = await ctx.db.findFirst(workspaceSubscription);
  if (!sub?.stripeCustomerId || !isStripeConfigured()) {
    throw new ServiceError("invalid_state", "This workspace has no Stripe billing account yet.");
  }
  const portal = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: portal.url };
}

const trialSchema = z.object({ planId: idSchema });

/** Starts a free trial plan (no card, no Stripe). Once per workspace. */
export async function startFreeTrial(
  ctx: UserWorkspaceContext,
  input: z.input<typeof trialSchema>,
  now: Date = new Date(),
): Promise<void> {
  requireOwner(ctx);
  const v = trialSchema.parse(input);
  const [planRow] = (await ctx.db.readPlans()).filter(
    (p) => p.id === v.planId && p.status === "published" && p.kind === "trial",
  );
  if (!planRow) throw new ServiceError("invalid_input", "This free trial is not available.");
  await ctx.db.transaction(async (tx) => {
    const sub = await tx.findFirst(workspaceSubscription);
    if (sub?.trialUsedAt) {
      throw new ServiceError("invalid_state", "This workspace already used its free trial.");
    }
    if (hasAccess(sub, now)) {
      throw new ServiceError("invalid_state", "This workspace already has an active plan.");
    }
    const endsAt = new Date(now.getTime() + planRow.trialDays * 86_400_000);
    const values = {
      planId: planRow.id,
      source: "trial" as const,
      status: "trialing" as const,
      interval: null,
      unitAmountCents: 0,
      trialEndsAt: endsAt,
      endsAt,
      trialUsedAt: now,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      subscribedBy: ctx.actor.userId,
    };
    if (sub) await tx.update(workspaceSubscription, values, undefined);
    else await tx.insert(workspaceSubscription, values);
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "billing.trial_started",
        targetType: "plan",
        targetId: planRow.id,
        metadata: { days: planRow.trialDays, endsAt: endsAt.toISOString() },
      },
    );
  });
}

/** For layouts: whether the workspace can use the app (and why not). */
export async function getAccessState(ctx: WorkspaceContext): Promise<{
  access: boolean;
  suspended: { reason: string | null } | null;
  billingActive: boolean;
}> {
  const e = await loadEntitlement(ctx.db);
  return {
    access: e.access,
    suspended: e.suspended ? { reason: e.suspended.reason } : null,
    billingActive: e.billingActive,
  };
}
