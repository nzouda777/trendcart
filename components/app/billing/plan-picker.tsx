"use client";

import { CheckIcon } from "lucide-react";
import { useState, useTransition } from "react";

import type { ActionResult } from "@/components/app/action-result";
import { FormError } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";
import { LIMIT_LABELS, type PlanLimits } from "@/lib/domain/billing";
import type { BillingPlanDTO } from "@/lib/services/billing";
import { cn } from "@/lib/utils";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function limitLines(limits: PlanLimits) {
  return (Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[]).map((k) => {
    const v = limits[k];
    const value = v === null ? "Unlimited" : k === "aiMonthlyCapUsd" ? usd(v) : String(v);
    return { key: k, label: LIMIT_LABELS[k], value };
  });
}

export function PlanPicker({
  plans,
  canManage,
  trialUsed,
  currentPlanId,
  hasStripeSubscription,
  onCheckout,
  onTrial,
}: {
  plans: BillingPlanDTO[];
  canManage: boolean;
  trialUsed: boolean;
  currentPlanId: string | null;
  hasStripeSubscription: boolean;
  onCheckout: (input: { planId: string; interval: "month" | "year" }) => Promise<ActionResult>;
  onTrial: (planId: string) => Promise<ActionResult>;
}) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const hasPaid = plans.some((p) => p.kind === "paid");

  function run(id: string, fn: () => Promise<ActionResult>) {
    setError(null);
    setPendingId(id);
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      setPendingId(null);
    });
  }

  return (
    <div className="grid gap-4">
      {hasPaid ? (
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="flex w-fit gap-1 rounded-lg border border-border bg-surface p-1"
        >
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                interval === i ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              {i === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      ) : null}
      <FormError message={error} />
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => {
          const current = p.id === currentPlanId;
          const price = interval === "month" ? p.priceMonthly : p.priceYearly;
          const disabled =
            !canManage ||
            !p.available ||
            current ||
            (p.kind === "trial" && trialUsed) ||
            (p.kind === "paid" && hasStripeSubscription);
          return (
            <li
              key={p.id}
              className={cn(
                "flex flex-col rounded-2xl border bg-surface p-5",
                p.highlighted ? "border-brand-border ring-1 ring-brand-border" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{p.name}</h3>
                {current ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-text">
                    Current
                  </span>
                ) : p.badge ? (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold">
                    {p.badge}
                  </span>
                ) : null}
              </div>
              {p.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
              ) : null}
              <p className="mt-4 text-3xl font-semibold tabular-nums">
                {p.kind === "trial" ? "Free" : price !== null ? usd(price) : "–"}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {p.kind === "trial"
                    ? `for ${p.trialDays} days`
                    : interval === "month"
                      ? "/ month"
                      : "/ year"}
                </span>
              </p>
              {p.kind === "paid" && p.trialDays > 0 && !trialUsed ? (
                <p className="mt-1 text-xs text-brand-text">
                  {p.trialDays}-day free trial{p.trialRequiresCard ? "" : ", no card needed"}
                </p>
              ) : null}
              <dl className="mt-4 grid gap-1 text-sm">
                {limitLines(p.limits).map((l) => (
                  <div key={l.key} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{l.label}</dt>
                    <dd className="font-medium">{l.value}</dd>
                  </div>
                ))}
              </dl>
              {p.features.length ? (
                <ul className="mt-4 grid gap-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <CheckIcon
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-brand-text"
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-auto pt-5">
                <Button
                  className="w-full"
                  size="lg"
                  variant={p.highlighted ? "default" : "outline"}
                  disabled={disabled || pendingId !== null}
                  onClick={() =>
                    run(p.id, () =>
                      p.kind === "trial" ? onTrial(p.id) : onCheckout({ planId: p.id, interval }),
                    )
                  }
                >
                  {pendingId === p.id
                    ? "Opening…"
                    : current
                      ? "Your plan"
                      : p.kind === "trial"
                        ? trialUsed
                          ? "Trial already used"
                          : "Start free trial"
                        : hasStripeSubscription
                          ? "Change in Manage billing"
                          : "Subscribe"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
