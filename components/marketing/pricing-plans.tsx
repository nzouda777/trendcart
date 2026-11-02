"use client";

import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { landing } from "@/content/landing";
import type { BillingPeriod, PricingPlan } from "@/content/types";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

const { pricing } = landing;
const { billing } = pricing;

/** Fixed locale so server and client render identical strings (no hydration mismatch). */
const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatAmount(value: number) {
  return `${pricing.currencySymbol}${amountFormat.format(value)}`;
}

/** Effective per-month amount for the selected period. */
function perMonth(plan: PricingPlan, period: BillingPeriod) {
  return period === "monthly"
    ? plan.price.monthly
    : Math.round((plan.price.yearly / 12) * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/*  Billing toggle: native radio group styled as a segmented control           */
/* -------------------------------------------------------------------------- */

function BillingToggle({
  value,
  onChange,
}: {
  value: BillingPeriod;
  onChange: (value: BillingPeriod) => void;
}) {
  const name = useId();
  const options = [
    { value: "monthly", label: billing.monthlyLabel },
    { value: "yearly", label: billing.yearlyLabel },
  ] as const satisfies readonly { value: BillingPeriod; label: string }[];

  return (
    <fieldset className="mx-auto flex w-fit flex-col items-center">
      <legend className="sr-only">{billing.toggleLabel}</legend>
      <div className="inline-flex items-center gap-1 rounded-full border bg-surface p-1">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors select-none",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-focus-visible:outline-none",
                checked
                  ? "bg-surface-2 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
              {option.value === "yearly" ? (
                <span className="rounded-full border border-brand-border bg-brand-soft px-2 py-px text-[11px] leading-4 font-semibold text-brand-text">
                  {billing.yearlyBadge}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/*  Price                                                                      */
/* -------------------------------------------------------------------------- */

function Price({ plan, period }: { plan: PricingPlan; period: BillingPeriod }) {
  const reduce = useReducedMotion();
  const amount = formatAmount(perMonth(plan, period));
  const yearlyTotal = formatAmount(plan.price.yearly);
  const srText =
    period === "monthly"
      ? `${amount} ${billing.perMonthSrLabel}`
      : `${amount} ${billing.perMonthSrLabel}, ${yearlyTotal} ${billing.billedYearlyNote}`;

  return (
    <div>
      <p className="sr-only">{srText}</p>
      <div aria-hidden="true">
        <p className="flex items-baseline gap-1">
          <span className="relative inline-flex overflow-hidden text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={amount}
                className="inline-block"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -12 }}
                transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                {amount}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="text-sm text-muted-foreground">{billing.perMonthSuffix}</span>
        </p>
        <p className="mt-1 h-5 text-xs text-muted-foreground">
          {period === "yearly" ? `${yearlyTotal} ${billing.billedYearlyNote}` : null}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Plan card                                                                  */
/* -------------------------------------------------------------------------- */

function PlanCard({ plan, period }: { plan: PricingPlan; period: BillingPeriod }) {
  const titleId = `plan-${plan.id}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-surface p-6 sm:p-8",
        plan.highlighted && "border-brand-border ring-1 ring-brand-border",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-lg font-semibold tracking-tight">
          {plan.name}
        </h3>
        {plan.badge ? (
          <span className="rounded-full border border-brand-border bg-brand-soft px-2.5 py-px text-xs font-semibold text-brand-text">
            {plan.badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 min-h-[2lh] text-sm leading-relaxed text-muted-foreground">
        {plan.description}
      </p>

      <div className="mt-6">
        <Price plan={plan} period={period} />
      </div>

      <Button
        asChild
        size="xl"
        variant={plan.highlighted ? "default" : "outline"}
        className="mt-6 w-full"
      >
        <Link href={plan.cta.href} aria-label={plan.cta.ariaLabel}>
          {plan.cta.label}
        </Link>
      </Button>

      <dl className="mt-8 divide-y rounded-xl border bg-surface-2/40 text-sm">
        {plan.limits.map((limit) => (
          <div key={limit.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted-foreground">{limit.label}</dt>
            <dd className="text-right font-medium">{limit.value}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-8 space-y-3 text-sm">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-text" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Plans                                                                      */
/* -------------------------------------------------------------------------- */

export function PricingPlans() {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <div className="mt-10 md:mt-12">
      <BillingToggle value={period} onChange={setPeriod} />
      <ul className="mx-auto mt-10 grid max-w-lg grid-cols-1 gap-5 lg:max-w-none lg:grid-cols-3 lg:items-stretch">
        {pricing.plans.map((plan) => (
          <li key={plan.id} className="min-w-0">
            <PlanCard plan={plan} period={period} />
          </li>
        ))}
      </ul>
    </div>
  );
}
