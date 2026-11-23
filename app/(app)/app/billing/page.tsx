import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { PlanPicker } from "@/components/app/billing/plan-picker";
import { PortalButton } from "@/components/app/billing/portal-button";
import { Notice, Section } from "@/components/app/surface";
import { STATUS_LABELS } from "@/lib/domain/billing";
import { getBillingOverview } from "@/lib/services/billing";

import { getPageContext } from "../_lib/page-context";
import { checkoutAction, portalAction, startTrialAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ ctx }, query] = await Promise.all([getPageContext(), searchParams]);
  const b = await getBillingOverview(ctx);
  const sub = b.subscription;
  const waiting = query.checkout === "success" && !b.access;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Billing"
        description="Your Trendcart plan. Payments are handled by Stripe: Trendcart never sees your card."
        actions={sub?.hasPortal && b.canManage ? <PortalButton onOpen={portalAction} /> : undefined}
      />

      {waiting ? (
        <Notice tone="info" title="Payment received, activating your plan…">
          This page updates on its own in a few seconds.
          <AutoRefresh intervalMs={3000} />
        </Notice>
      ) : query.checkout === "success" ? (
        <Notice tone="success" title="Your plan is active">
          Thank you. You can use Trendcart now.
        </Notice>
      ) : query.checkout === "cancel" ? (
        <Notice tone="info" title="Checkout canceled">
          Nothing was charged.
        </Notice>
      ) : null}

      {b.suspended ? (
        <Notice tone="danger" title="This workspace is suspended">
          {b.suspended.reason ?? "Contact Trendcart support."}
        </Notice>
      ) : null}

      {!b.billingActive ? (
        <Notice tone="info" title="No plan to choose yet">
          Trendcart has not published its plans yet: your workspace uses the app freely for now.
        </Notice>
      ) : null}

      {sub ? (
        <Section id="current" title="Current plan">
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Plan</dt>
              <dd className="font-medium">{sub.planName ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>{STATUS_LABELS[sub.status]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Price</dt>
              <dd>
                {sub.source === "stripe" && sub.amount !== null
                  ? `$${sub.amount} / ${sub.interval}`
                  : sub.source === "trial"
                    ? "Free trial"
                    : "Provided by Trendcart"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {sub.source === "stripe"
                  ? sub.cancelAtPeriodEnd
                    ? "Ends on"
                    : sub.status === "trialing"
                      ? "Trial ends"
                      : "Renews on"
                  : "Access until"}
              </dt>
              <dd>
                {sub.source === "stripe"
                  ? (fmt(sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd) ?? "–")
                  : (fmt(sub.endsAt) ?? "No end date")}
              </dd>
            </div>
          </dl>
          {sub.status === "past_due" ? (
            <p className="mt-4 text-sm text-warning">
              The last payment failed. Stripe will retry: update your card in Manage billing.
            </p>
          ) : null}
        </Section>
      ) : null}

      {b.billingActive ? (
        <Section
          id="plans"
          title={b.access ? "Plans" : "Choose a plan"}
          description={
            b.canManage
              ? "Prices in USD. You can change plan, billing period or card, or cancel, at any time in Manage billing."
              : "Only the workspace owner can choose or change the plan."
          }
        >
          <PlanPicker
            plans={b.plans}
            canManage={b.canManage}
            trialUsed={b.trialUsed}
            currentPlanId={b.access ? (sub?.planId ?? null) : null}
            hasStripeSubscription={sub?.source === "stripe" && b.access}
            onCheckout={checkoutAction}
            onTrial={startTrialAction}
          />
        </Section>
      ) : null}
    </div>
  );
}
