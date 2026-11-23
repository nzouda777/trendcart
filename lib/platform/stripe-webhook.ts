import "server-only";

import { eq, or } from "drizzle-orm";
import type Stripe from "stripe";

import { writeAuditForWorkspace } from "@/lib/audit";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/lib/domain/billing";
import { plan, stripeEvent, workspaceSubscription } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { getDb } from "@/lib/db/client";

import { getStripe, isStripeConfigured } from "./stripe";

/*
 * Stripe webhook events → workspace_subscription. Signature checked by the
 * route (stripe.webhooks.constructEvent on the raw body). Events can arrive
 * twice or out of order: each event id is recorded once, and the
 * subscription is always re-read from Stripe before it is stored, so the row
 * matches Stripe's current state whatever the order.
 */

export const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
]);

const asId = (v: string | { id: string } | null | undefined) =>
  typeof v === "string" ? v : (v?.id ?? null);

function subscriptionIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      return s.mode === "subscription" ? asId(s.subscription) : null;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      return asId(inv.parent?.subscription_details?.subscription ?? null);
    }
    default:
      return typeof obj.id === "string" && String(obj.object) === "subscription" ? obj.id : null;
  }
}

const toDate = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

function statusOf(s: Stripe.Subscription.Status): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s)
    ? (s as SubscriptionStatus)
    : "incomplete";
}

/** Stores Stripe's current state of a subscription on its workspace. */
export async function syncStripeSubscription(
  db: Database,
  sub: Stripe.Subscription,
): Promise<{ workspaceId: string } | null> {
  const subscriptionId = sub.id;
  const customerId = asId(sub.customer);
  let workspaceId = sub.metadata?.workspaceId ?? null;
  if (!workspaceId) {
    const [row] = await db
      .select({ workspaceId: workspaceSubscription.workspaceId })
      .from(workspaceSubscription)
      .where(
        or(
          eq(workspaceSubscription.stripeSubscriptionId, subscriptionId),
          ...(customerId ? [eq(workspaceSubscription.stripeCustomerId, customerId)] : []),
        ),
      );
    workspaceId = row?.workspaceId ?? null;
  }
  if (!workspaceId) {
    console.warn(`[stripe] subscription ${subscriptionId} has no Trendcart workspace; ignored.`);
    return null;
  }

  const item = sub.items.data[0];
  const price = item?.price;
  const priceId = price?.id ?? null;
  let planId = sub.metadata?.planId ?? price?.metadata?.trendcart_plan_id ?? null;
  if (!planId && priceId) {
    const [p] = await db
      .select({ id: plan.id })
      .from(plan)
      .where(or(eq(plan.stripeMonthlyPriceId, priceId), eq(plan.stripeYearlyPriceId, priceId)));
    planId = p?.id ?? null;
  }

  const scoped = createScopedDb(db, workspaceId);
  const current = await scoped.findFirst(workspaceSubscription);
  // A newer Stripe subscription for the workspace wins over an old canceled one.
  if (
    current?.stripeSubscriptionId &&
    current.stripeSubscriptionId !== subscriptionId &&
    sub.status === "canceled" &&
    current.status !== "canceled"
  ) {
    return { workspaceId };
  }
  const values = {
    planId,
    source: "stripe" as const,
    status: statusOf(sub.status),
    interval: (price?.recurring?.interval === "year" ? "year" : "month") as "month" | "year",
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
    unitAmountCents: price?.unit_amount ?? null,
    // Since API 2025-03-31 the period lives on subscription items.
    currentPeriodEnd: toDate(item?.current_period_end),
    trialEndsAt: toDate(sub.trial_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: toDate(sub.canceled_at),
    endsAt: null,
    // A Stripe trial counts as the workspace's one trial.
    ...(sub.trial_end && !current?.trialUsedAt ? { trialUsedAt: new Date() } : {}),
  };
  if (current) await scoped.update(workspaceSubscription, values, undefined);
  else await scoped.insert(workspaceSubscription, values);

  if (!current || current.status !== values.status || current.planId !== planId) {
    await writeAuditForWorkspace(db, {
      workspaceId,
      actorUserId: null,
      entry: {
        action: "billing.subscription_updated",
        targetType: "subscription",
        targetId: subscriptionId,
        metadata: {
          from: current?.status ?? null,
          to: values.status,
          planId,
          priceId,
          amountCents: values.unitAmountCents,
        },
      },
    });
  }
  return { workspaceId };
}

/**
 * Handles one verified event. Returns "duplicate" when it was already
 * processed. Throws on failure (the route answers 500 so Stripe retries).
 */
export async function handleStripeEvent(
  db: Database,
  event: Stripe.Event,
  stripe: Pick<Stripe, "subscriptions"> = getStripe(),
): Promise<"processed" | "duplicate" | "ignored"> {
  const [seen] = await db.select().from(stripeEvent).where(eq(stripeEvent.id, event.id));
  if (seen?.processedAt) return "duplicate";
  if (!seen) {
    await db.insert(stripeEvent).values({ id: event.id, type: event.type }).onConflictDoNothing();
  }
  if (!HANDLED_EVENTS.has(event.type)) {
    await db
      .update(stripeEvent)
      .set({ processedAt: new Date(), error: null })
      .where(eq(stripeEvent.id, event.id));
    return "ignored";
  }
  try {
    const subscriptionId = subscriptionIdOf(event);
    if (subscriptionId) {
      // Always the current state, whatever the event order.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await syncStripeSubscription(db, sub);
    }
    await db
      .update(stripeEvent)
      .set({ processedAt: new Date(), error: null })
      .where(eq(stripeEvent.id, event.id));
    return "processed";
  } catch (error) {
    await db
      .update(stripeEvent)
      .set({ error: (error instanceof Error ? error.message : String(error)).slice(0, 500) })
      .where(eq(stripeEvent.id, event.id));
    throw error;
  }
}

/**
 * The webhook route's whole job: verify the signature on the raw body, then
 * handle the event. Returns the HTTP status and body to answer.
 */
export async function handleStripeWebhookRequest(
  rawBody: string,
  signature: string | null,
): Promise<{ status: number; body: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !isStripeConfigured()) return { status: 503, body: "Stripe is not configured." };
  if (!signature) return { status: 400, body: "Missing Stripe-Signature." };
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: "Invalid signature." };
  }
  try {
    return { status: 200, body: await handleStripeEvent(getDb(), event, stripe) };
  } catch (error) {
    console.error(`[stripe] ${event.type} ${event.id} failed`, error);
    return { status: 500, body: "Handling failed." };
  }
}
