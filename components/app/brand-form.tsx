"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { BrandDTO } from "@/lib/services/types";

import type { ActionResult } from "./action-result";
import { FormError, FormSuccess, SelectField, TextField } from "./form-controls";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS, LANGUAGE_OPTIONS, withCurrent } from "./locale-options";

export type BrandFormValues = {
  name: string;
  country: string;
  language: string;
  currency: string;
  defaultTestBudget: number | null;
  minMargin: number | null;
  pricingRule: { multiplier: number; roundTo?: number; compareAtMultiplier?: number } | null;
};

type Props = {
  mode: "create" | "edit";
  brand?: BrandDTO;
  /** false renders the form read-only (role without brand:update). */
  canEdit?: boolean;
  /** Collapse budget, margin and pricing under "More settings" (onboarding). */
  compact?: boolean;
  submitLabel?: string;
  onSubmit: (values: BrandFormValues) => Promise<ActionResult<{ id: string }>>;
};

function numberOrNull(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Brand settings: market, budget, margin floor and pricing rule. */
export function BrandForm({
  mode,
  brand,
  canEdit = true,
  compact = false,
  submitLabel,
  onSubmit,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<{ id: string }> | null>(null);
  const [saved, setSaved] = useState(false);

  const err = (key: string) => (result && !result.ok ? result.fieldErrors?.[key]?.[0] : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const minMarginPct = numberOrNull(form.get("minMargin"));
    const multiplier = numberOrNull(form.get("multiplier"));
    const roundTo = numberOrNull(form.get("roundTo"));
    const compareAt = numberOrNull(form.get("compareAtMultiplier"));

    const values: BrandFormValues = {
      name: String(form.get("name") ?? "").trim(),
      country: String(form.get("country") ?? ""),
      language: String(form.get("language") ?? ""),
      currency: String(form.get("currency") ?? ""),
      defaultTestBudget: numberOrNull(form.get("defaultTestBudget")),
      minMargin: minMarginPct === null ? null : minMarginPct / 100,
      pricingRule:
        multiplier === null
          ? null
          : {
              multiplier,
              ...(roundTo !== null ? { roundTo } : {}),
              ...(compareAt !== null ? { compareAtMultiplier: compareAt } : {}),
            },
    };

    setSaved(false);
    setResult(null);
    startTransition(async () => {
      const r = await onSubmit(values);
      setResult(r);
      if (r.ok) setSaved(true);
    });
  }

  const marginPct =
    brand?.minMargin !== null && brand?.minMargin !== undefined
      ? String(Math.round(brand.minMargin * 1000) / 10)
      : "";

  const advanced = (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        id="defaultTestBudget"
        name="defaultTestBudget"
        label="Default test budget (daily)"
        type="number"
        inputMode="decimal"
        min={1}
        step="0.01"
        defaultValue={brand?.defaultTestBudget ?? ""}
        suffix={brand?.currency}
        hint="Prefilled on new campaigns. Changes are recorded in the audit log."
        error={err("defaultTestBudget")}
      />
      <TextField
        id="minMargin"
        name="minMargin"
        label="Minimum margin"
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step="0.1"
        defaultValue={marginPct}
        suffix="%"
        hint="Suppliers below this margin are flagged."
        error={err("minMargin")}
      />
      <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:col-span-2 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">Pricing rule</legend>
        <TextField
          id="multiplier"
          name="multiplier"
          label="Price multiplier"
          type="number"
          inputMode="decimal"
          min={1}
          max={20}
          step="0.01"
          placeholder="e.g. 2.5"
          defaultValue={brand?.pricingRule?.multiplier ?? ""}
          hint="Selling price = landed cost × this."
          error={err("pricingRule.multiplier")}
        />
        <TextField
          id="roundTo"
          name="roundTo"
          label="Price ending"
          type="number"
          inputMode="decimal"
          min={0}
          max={0.99}
          step="0.01"
          placeholder="e.g. 0.99"
          defaultValue={brand?.pricingRule?.roundTo ?? ""}
          hint="Optional cents ending."
          error={err("pricingRule.roundTo")}
        />
        <TextField
          id="compareAtMultiplier"
          name="compareAtMultiplier"
          label="Compare-at multiplier"
          type="number"
          inputMode="decimal"
          min={1}
          max={5}
          step="0.01"
          placeholder="e.g. 1.4"
          defaultValue={brand?.pricingRule?.compareAtMultiplier ?? ""}
          hint="Optional strike-through price."
          error={err("pricingRule.compareAtMultiplier")}
        />
      </fieldset>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <fieldset disabled={!canEdit || pending} className="grid gap-5 disabled:opacity-90">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="name"
            name="name"
            label="Brand name"
            required
            maxLength={120}
            autoComplete="organization"
            defaultValue={brand?.name ?? ""}
            className="sm:col-span-2"
            error={err("name")}
          />
          <SelectField
            id="country"
            name="country"
            label="Main country"
            options={withCurrent(COUNTRY_OPTIONS, brand?.country)}
            defaultValue={brand?.country ?? "US"}
            hint="Default targeting for campaigns."
            error={err("country")}
          />
          <SelectField
            id="language"
            name="language"
            label="Language"
            options={withCurrent(LANGUAGE_OPTIONS, brand?.language)}
            defaultValue={brand?.language ?? "en"}
            hint="Used for product pages and ad copy."
            error={err("language")}
          />
          <SelectField
            id="currency"
            name="currency"
            label="Currency"
            options={withCurrent(CURRENCY_OPTIONS, brand?.currency)}
            defaultValue={brand?.currency ?? "USD"}
            hint="Should match your Shopify store currency."
            error={err("currency")}
          />
        </div>

        {compact ? (
          <details className="group rounded-xl border border-border">
            <summary className="cursor-pointer list-none rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden="true"
                className="mr-2 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
              >
                ›
              </span>
              Budget, margin and pricing (optional)
            </summary>
            <div className="px-4 pb-4">{advanced}</div>
          </details>
        ) : (
          advanced
        )}
      </fieldset>

      {result && !result.ok ? <FormError message={result.error} /> : null}
      {saved && mode === "edit" ? <FormSuccess message="Brand settings saved." /> : null}

      {canEdit ? (
        <div>
          <Button type="submit" size="xl" disabled={pending} aria-busy={pending}>
            {pending
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : (submitLabel ?? (mode === "create" ? "Create brand" : "Save changes"))}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your role can view these settings but not change them.
        </p>
      )}
    </form>
  );
}
