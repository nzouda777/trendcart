import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminTitle, Card, DataTable, Pill, usd } from "@/components/admin/ui";
import { fromCents } from "@/lib/domain/billing";
import { requireAdminPage } from "@/lib/platform/guard";
import { getBillingSettings, listPlans, planPrices } from "@/lib/platform/plans";
import { isStripeConfigured } from "@/lib/platform/stripe";

export const metadata: Metadata = { title: "Plans & pricing" };

const STATUS_TONE = { draft: "neutral", published: "good", archived: "warning" } as const;

export default async function PlansPage() {
  const admin = await requireAdminPage();
  const [plans, settings] = await Promise.all([listPlans(admin.db), getBillingSettings(admin.db)]);
  const stripe = isStripeConfigured();

  const newLink = (kind: "paid" | "trial", label: string) => (
    <Link
      href={`/admin/plans/new?kind=${kind}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-brand-hover"
    >
      <PlusIcon aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );

  return (
    <div className="grid gap-6">
      <AdminTitle
        title="Plans & pricing"
        description={
          <>
            Plans shown on the landing page and sold with Stripe Checkout, in USD. Yearly price =
            monthly × {settings.yearlyMultiplier} by default (change it in{" "}
            <Link href="/admin/settings" className="text-brand-text underline">
              Settings
            </Link>
            ). Limits apply in the app as soon as a plan is saved.
          </>
        }
        actions={
          <>
            {newLink("paid", "New paid plan")}
            <Link
              href="/admin/plans/new?kind=trial"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2"
            >
              <PlusIcon aria-hidden="true" className="size-4" />
              New free trial
            </Link>
          </>
        }
      />
      {!stripe ? (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
          Stripe is not configured (STRIPE_SECRET_KEY). Paid plans can be prepared as drafts but
          cannot be published.
        </p>
      ) : null}
      <Card>
        <DataTable
          caption="Plans"
          empty="No plan yet. While no plan is published, billing is off and every workspace uses the app freely."
          head={["Plan", "Type", "Monthly", "Yearly", "Trial", "Status", "Stripe", ""]}
          rows={plans.map((p) => {
            const prices = planPrices(p, settings);
            return [
              <div key="n">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.slug}</p>
              </div>,
              p.kind === "paid" ? "Paid" : "Free trial",
              prices ? usd(fromCents(prices.monthlyCents)) : "–",
              prices ? usd(fromCents(prices.yearlyCents)) : "–",
              p.trialDays ? `${p.trialDays} days` : "–",
              <Pill key="s" tone={STATUS_TONE[p.status]}>
                {p.status}
              </Pill>,
              p.kind === "trial" ? (
                "Not needed"
              ) : p.stripeMonthlyPriceId ? (
                <Pill key="st" tone="good">
                  Synced
                </Pill>
              ) : (
                <Pill key="st" tone="warning">
                  Not synced
                </Pill>
              ),
              <Link
                key="e"
                href={`/admin/plans/${p.id}`}
                className="text-brand-text hover:underline"
              >
                Edit
              </Link>,
            ];
          })}
        />
      </Card>
    </div>
  );
}
