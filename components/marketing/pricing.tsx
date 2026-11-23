import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Section, SectionHeading } from "@/components/marketing/shared";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { landing } from "@/content/landing";
import { LIMIT_LABELS, type PlanLimits } from "@/lib/domain/billing";
import { getPublicPricing } from "@/lib/platform/public-pricing";
import type { PublicPlan } from "@/lib/platform/plans";

import { PricingPlans, type DisplayPlan } from "./pricing-plans";

/*
 * Pricing section. Plans, prices, limits and features come from the plans a
 * platform admin published (/admin/plans), never from hard-coded copy. With
 * no published plan the grid is not shown (only the custom-plan contact).
 */

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function limitRows(limits: PlanLimits) {
  return (Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[])
    .filter((k) => limits[k] !== null || k !== "aiMonthlyCapUsd")
    .map((k) => {
      const v = limits[k];
      return {
        id: k,
        label: LIMIT_LABELS[k],
        value: v === null ? "Unlimited" : k === "aiMonthlyCapUsd" ? usd(v) : String(v),
      };
    });
}

function toDisplay(p: PublicPlan): DisplayPlan {
  const price =
    p.kind === "paid" && p.priceMonthly !== null && p.priceYearly !== null
      ? { monthly: p.priceMonthly, yearly: p.priceYearly }
      : null;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price,
    trialDays: p.trialDays,
    paidTrialDays: p.kind === "paid" ? p.trialDays : 0,
    limits: limitRows(p.limits),
    features: p.features,
    cta: {
      label: p.ctaLabel ?? (p.kind === "trial" ? "Start free trial" : `Start with ${p.name}`),
      href: siteConfig.links.signUp,
    },
    highlighted: p.highlighted,
    ...(p.badge ? { badge: p.badge } : {}),
  };
}

/** "2 months free" when every paid plan has the same whole number of free months. */
function yearlyBadge(plans: PublicPlan[]): string | null {
  const months = plans
    .filter((p) => p.kind === "paid" && p.priceMonthly && p.priceYearly)
    .map((p) => Math.round((12 - p.priceYearly! / p.priceMonthly!) * 100) / 100);
  if (months.length === 0 || new Set(months).size !== 1) return null;
  const m = months[0]!;
  return Number.isInteger(m) && m > 0 ? `${m} month${m === 1 ? "" : "s"} free` : null;
}

function footnote(plans: PublicPlan[]): string | null {
  const paid = plans.filter((p) => p.kind === "paid" && p.priceMonthly && p.priceYearly);
  if (paid.length === 0) return null;
  const multipliers = new Set(
    paid.map((p) => Math.round((p.priceYearly! / p.priceMonthly!) * 100) / 100),
  );
  const badge = yearlyBadge(plans);
  return multipliers.size === 1
    ? `Prices in USD. Yearly billing is ${[...multipliers][0]}× the monthly price${badge ? `: ${badge}` : ""}.`
    : "Prices in USD.";
}

export async function Pricing() {
  const { pricing } = landing;
  const plans = await getPublicPricing();
  const note = footnote(plans);

  return (
    <Section id="pricing" aria-labelledby="pricing-title">
      <SectionHeading
        id="pricing-title"
        eyebrow={pricing.eyebrow}
        title={pricing.title}
        description={pricing.description}
        align="center"
      />

      {plans.length ? (
        <PricingPlans plans={plans.map(toDisplay)} yearlyBadge={yearlyBadge(plans)} />
      ) : null}

      <div className="mt-8 flex flex-col gap-4 rounded-2xl border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{pricing.enterprise.title}</h3>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {pricing.enterprise.description}
          </p>
        </div>
        <Button asChild size="xl" variant="outline" className="sm:shrink-0">
          <Link href={pricing.enterprise.cta.href}>
            {pricing.enterprise.cta.label}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {note ? <p className="mt-6 text-center text-xs text-muted-foreground">{note}</p> : null}
    </Section>
  );
}
