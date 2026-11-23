"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { fieldError, type ActionResult } from "@/components/app/action-result";
import { FormError, FormSuccess, SelectField, TextField } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";
import { LIMIT_LABELS, type PlanInput, type PlanLimits } from "@/lib/domain/billing";

export type PlanFormValue = {
  slug: string;
  kind: "paid" | "trial";
  name: string;
  description: string;
  priceMonthly: number | null;
  yearlyMultiplier: number | null;
  limits: PlanLimits;
  features: string[];
  highlighted: boolean;
  badge: string | null;
  ctaLabel: string | null;
  sortOrder: number;
  status: "draft" | "published" | "archived";
  trialDays: number;
  trialRequiresCard: boolean;
};

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[];

function numOrNull(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function PlanEditor({
  initial,
  defaultMultiplier,
  stripeConfigured,
  onSave,
}: {
  initial: PlanFormValue;
  defaultMultiplier: number;
  stripeConfigured: boolean;
  onSave: (input: PlanInput) => Promise<ActionResult<{ id: string }>>;
}) {
  const [v, setV] = useState(initial);
  const [price, setPrice] = useState(
    initial.priceMonthly === null ? "" : String(initial.priceMonthly),
  );
  const [multiplier, setMultiplier] = useState(
    initial.yearlyMultiplier === null ? "" : String(initial.yearlyMultiplier),
  );
  const [limits, setLimits] = useState<Record<keyof PlanLimits, string>>(
    Object.fromEntries(
      LIMIT_KEYS.map((k) => [k, initial.limits[k] === null ? "" : String(initial.limits[k])]),
    ) as Record<keyof PlanLimits, string>,
  );
  const [features, setFeatures] = useState<string[]>(
    initial.features.length ? initial.features : [""],
  );
  const [result, setResult] = useState<ActionResult<{ id: string }> | null>(null);
  const [pending, start] = useTransition();
  const err = (k: string) => fieldError(result, k);
  const set = <K extends keyof PlanFormValue>(k: K, value: PlanFormValue[K]) =>
    setV((cur) => ({ ...cur, [k]: value }));

  const monthly = numOrNull(price);
  const m = numOrNull(multiplier) ?? defaultMultiplier;
  const yearly =
    monthly && Number.isFinite(monthly) && Number.isFinite(m)
      ? Math.round(monthly * m * 100) / 100
      : null;
  const priceChanged = initial.priceMonthly !== null && monthly !== initial.priceMonthly;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input: PlanInput = {
      ...v,
      priceMonthly: v.kind === "paid" ? monthly : null,
      yearlyMultiplier: v.kind === "paid" ? numOrNull(multiplier) : null,
      limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, numOrNull(limits[k])])) as PlanLimits,
      features: features.map((f) => f.trim()).filter(Boolean),
      badge: v.badge?.trim() || null,
      ctaLabel: v.ctaLabel?.trim() || null,
    };
    start(async () => setResult(await onSave(input)));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">Plan</h2>
        <TextField
          id="plan-name"
          label="Name"
          required
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
          error={err("name")}
        />
        <TextField
          id="plan-slug"
          label="Plan id"
          required
          value={v.slug}
          onChange={(e) => set("slug", e.target.value)}
          hint="Lowercase, e.g. growth. Used in Stripe lookup keys."
          error={err("slug")}
        />
        <TextField
          id="plan-description"
          label="Short description"
          className="sm:col-span-2"
          value={v.description}
          maxLength={300}
          onChange={(e) => set("description", e.target.value)}
          error={err("description")}
        />
        <SelectField
          id="plan-status"
          label="Status"
          value={v.status}
          onChange={(e) => set("status", e.target.value as PlanFormValue["status"])}
          options={[
            { value: "draft", label: "Draft (hidden)" },
            { value: "published", label: "Published (landing page + buyable)" },
            { value: "archived", label: "Archived (hidden, subscribers keep it)" },
          ]}
          hint="Billing applies to every workspace as soon as one plan is published."
          error={err("status")}
        />
        <TextField
          id="plan-order"
          label="Order on the landing page"
          type="number"
          min={0}
          value={v.sortOrder}
          onChange={(e) => set("sortOrder", Number(e.target.value) || 0)}
        />
      </div>

      {v.kind === "paid" ? (
        <div className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-3">
          <h2 className="text-sm font-semibold sm:col-span-3">Price (USD)</h2>
          <TextField
            id="plan-price"
            label="Monthly price"
            inputMode="decimal"
            required
            value={price}
            suffix="USD"
            onChange={(e) => setPrice(e.target.value)}
            error={err("priceMonthly")}
          />
          <TextField
            id="plan-multiplier"
            label="Yearly = monthly ×"
            inputMode="decimal"
            placeholder={String(defaultMultiplier)}
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            hint={`Empty: platform default (×${defaultMultiplier}, in Settings).`}
            error={err("yearlyMultiplier")}
          />
          <div className="grid content-start gap-1.5">
            <span className="text-sm font-medium">Yearly price</span>
            <span className="flex h-10 items-center text-lg font-semibold tabular-nums">
              {yearly === null ? "–" : `$${yearly}`}
            </span>
          </div>
          {priceChanged ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning sm:col-span-3">
              Saving creates new Stripe prices. Current subscribers keep their price; new
              subscribers pay the new one.
            </p>
          ) : null}
          {!stripeConfigured ? (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger sm:col-span-3">
              STRIPE_SECRET_KEY is not set: this plan can be saved as a draft but not published.
            </p>
          ) : null}
          <TextField
            id="plan-trial"
            label="Stripe free trial"
            type="number"
            min={0}
            max={730}
            value={v.trialDays}
            suffix="days"
            onChange={(e) => set("trialDays", Number(e.target.value) || 0)}
            hint="0 = no trial. One trial per workspace."
            error={err("trialDays")}
          />
          {v.trialDays > 0 ? (
            <label className="flex items-start gap-2.5 self-center text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--brand)]"
                checked={v.trialRequiresCard}
                onChange={(e) => set("trialRequiresCard", e.target.checked)}
              />
              <span>
                Ask for a card at checkout
                <span className="block text-xs text-muted-foreground">
                  Off: the trial starts without a card and the subscription is canceled at the end
                  unless a card was added.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Free trial</h2>
          <TextField
            id="plan-trial-days"
            label="Length"
            type="number"
            min={1}
            max={730}
            required
            value={v.trialDays}
            suffix="days"
            onChange={(e) => set("trialDays", Number(e.target.value) || 0)}
            hint="No card, no Stripe. Once per workspace; after it, the workspace chooses a paid plan."
            error={err("trialDays")}
          />
        </div>
      )}

      <div className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <h2 className="text-sm font-semibold">Limits</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Applied in the app to every workspace on this plan, as soon as you save. Empty =
            unlimited.
          </p>
        </div>
        {LIMIT_KEYS.map((k) => (
          <TextField
            key={k}
            id={`plan-limit-${k}`}
            label={LIMIT_LABELS[k]}
            inputMode="decimal"
            placeholder="Unlimited"
            value={limits[k]}
            onChange={(e) => setLimits((cur) => ({ ...cur, [k]: e.target.value }))}
            error={err(`limits.${k}`)}
          />
        ))}
      </div>

      <div className="grid gap-4 rounded-2xl border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold">Landing page</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The feature list, badge and button shown on the pricing section.
          </p>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Features</span>
          {features.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={`Feature ${i + 1}`}
                className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={f}
                maxLength={120}
                onChange={(e) =>
                  setFeatures((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove feature ${i + 1}`}
                onClick={() => setFeatures((cur) => cur.filter((_, j) => j !== i))}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
          ))}
          {features.length < 20 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setFeatures((cur) => [...cur, ""])}
            >
              <PlusIcon aria-hidden="true" />
              Add a feature
            </Button>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            id="plan-badge"
            label="Badge"
            placeholder="e.g. Most popular"
            value={v.badge ?? ""}
            maxLength={30}
            onChange={(e) => set("badge", e.target.value)}
          />
          <TextField
            id="plan-cta"
            label="Button text"
            placeholder={
              v.kind === "trial" ? "Start free trial" : `Start with ${v.name || "this plan"}`
            }
            value={v.ctaLabel ?? ""}
            maxLength={40}
            onChange={(e) => set("ctaLabel", e.target.value)}
          />
          <label className="flex items-center gap-2.5 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={v.highlighted}
              onChange={(e) => set("highlighted", e.target.checked)}
            />
            Highlight this plan
          </label>
        </div>
      </div>

      <FormError message={result && !result.ok ? result.error : null} />
      <FormSuccess message={result?.ok ? "Plan saved." : null} />
      <div className="flex justify-end">
        <Button type="submit" size="xl" disabled={pending}>
          {pending ? "Saving…" : "Save plan"}
        </Button>
      </div>
    </form>
  );
}
