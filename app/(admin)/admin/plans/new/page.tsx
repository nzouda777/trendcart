import type { Metadata } from "next";
import Link from "next/link";

import { PlanEditor } from "@/components/admin/plan-editor";
import { AdminTitle } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/platform/guard";
import { getBillingSettings } from "@/lib/platform/plans";
import { isStripeConfigured } from "@/lib/platform/stripe";

import { createPlanAction } from "../actions";

export const metadata: Metadata = { title: "New plan" };

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const admin = await requireAdminPage();
  const kind = (await searchParams).kind === "trial" ? "trial" : "paid";
  const settings = await getBillingSettings(admin.db);
  return (
    <div className="grid max-w-4xl gap-4">
      <Link href="/admin/plans" className="text-sm text-muted-foreground hover:text-foreground">
        ← All plans
      </Link>
      <AdminTitle
        title={kind === "trial" ? "New free trial" : "New paid plan"}
        description={
          kind === "trial"
            ? "A free, time-limited plan with its own limits and features. No card, no Stripe."
            : "Saved as a Stripe product with a monthly and a yearly price when Stripe is configured."
        }
      />
      <PlanEditor
        defaultMultiplier={settings.yearlyMultiplier}
        stripeConfigured={isStripeConfigured()}
        onSave={createPlanAction}
        initial={{
          slug: "",
          kind,
          name: "",
          description: "",
          priceMonthly: null,
          yearlyMultiplier: null,
          limits: {
            brands: null,
            stores: null,
            seats: null,
            productsPerMonth: null,
            aiMonthlyCapUsd: null,
          },
          features: [],
          highlighted: false,
          badge: null,
          ctaLabel: null,
          sortOrder: 0,
          status: "draft",
          trialDays: 0,
          trialRequiresCard: true,
        }}
      />
    </div>
  );
}
