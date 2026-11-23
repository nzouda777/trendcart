import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { PlanEditor } from "@/components/admin/plan-editor";
import { AdminTitle, Card, Pill } from "@/components/admin/ui";
import { fromCents } from "@/lib/domain/billing";
import { plan, workspaceSubscription } from "@/lib/db/schema";
import { requireAdminPage } from "@/lib/platform/guard";
import { getBillingSettings, limitsOf } from "@/lib/platform/plans";
import { isStripeConfigured } from "@/lib/platform/stripe";

import { deletePlanAction, syncPlanAction, updatePlanAction } from "../actions";

export const metadata: Metadata = { title: "Edit plan" };

export default async function EditPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const admin = await requireAdminPage();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [row] = await admin.db.select().from(plan).where(eq(plan.id, id));
  if (!row) notFound();
  const [settings, [subs]] = await Promise.all([
    getBillingSettings(admin.db),
    admin.db
      .select({ c: count() })
      .from(workspaceSubscription)
      .where(eq(workspaceSubscription.planId, id)),
  ]);
  const stripe = isStripeConfigured();

  return (
    <div className="grid max-w-4xl gap-4">
      <Link href="/admin/plans" className="text-sm text-muted-foreground hover:text-foreground">
        ← All plans
      </Link>
      <AdminTitle
        title={row.name}
        description={`${row.kind === "paid" ? "Paid plan" : "Free trial"} · ${Number(subs?.c ?? 0)} workspace subscription record(s) use it.`}
      />
      {query.saved ? (
        <p role="status" className="rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand-text">
          Plan created.
        </p>
      ) : null}

      {row.kind === "paid" ? (
        <Card
          title="Stripe"
          description="One product with a monthly and a yearly price. Old prices stay for their subscribers."
          actions={
            stripe ? (
              <ActionButton
                label="Sync with Stripe"
                title="Sync this plan with Stripe?"
                description="Updates the product, and creates new prices if the amounts changed (old prices are archived; current subscribers keep them)."
                onConfirm={syncPlanAction.bind(null, row.id)}
              />
            ) : (
              <Pill tone="danger">Stripe not configured</Pill>
            )
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Product</dt>
              <dd className="font-mono text-xs break-all">{row.stripeProductId ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Monthly price</dt>
              <dd className="font-mono text-xs break-all">
                {row.stripeMonthlyPriceId ?? "–"}
                {row.stripeMonthlyCents !== null ? ` ($${fromCents(row.stripeMonthlyCents)})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Yearly price</dt>
              <dd className="font-mono text-xs break-all">
                {row.stripeYearlyPriceId ?? "–"}
                {row.stripeYearlyCents !== null ? ` ($${fromCents(row.stripeYearlyCents)})` : ""}
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}

      <PlanEditor
        defaultMultiplier={settings.yearlyMultiplier}
        stripeConfigured={stripe}
        onSave={updatePlanAction.bind(null, row.id)}
        initial={{
          slug: row.slug,
          kind: row.kind,
          name: row.name,
          description: row.description,
          priceMonthly: row.priceMonthlyCents === null ? null : fromCents(row.priceMonthlyCents),
          yearlyMultiplier: row.yearlyMultiplier,
          limits: limitsOf(row),
          features: row.features ?? [],
          highlighted: row.highlighted,
          badge: row.badge,
          ctaLabel: row.ctaLabel,
          sortOrder: row.sortOrder,
          status: row.status,
          trialDays: row.trialDays,
          trialRequiresCard: row.trialRequiresCard,
        }}
      />

      <Card
        title="Delete plan"
        description="Only for a plan nobody ever subscribed to. Otherwise set it to Archived."
        className="border-danger/30"
      >
        <ActionButton
          label="Delete plan"
          variant="destructive"
          destructive
          title={`Delete ${row.name}?`}
          description="The plan and its Stripe product are removed (archived in Stripe). This cannot be undone."
          onConfirm={deletePlanAction.bind(null, row.id)}
        />
      </Card>
    </div>
  );
}
