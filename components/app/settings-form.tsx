"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  ANALYSIS_MODELS,
  COPYWRITING_MODELS,
  TIMEOUT_LIMITS,
  type WorkspaceSettingsInput,
} from "@/lib/domain/settings";

import type { ActionResult } from "./action-result";
import { FormError, FormSuccess, SelectField, TextField } from "./form-controls";

type Field<T> = { value: T; isDefault: boolean; defaultValue: T };

export type SettingsFormValues = {
  analysisModel: Field<string>;
  copywritingModel: Field<string>;
  aiMonthlyCapUsd: Field<number>;
  analysisTimeoutSec: Field<number>;
  copywritingTimeoutSec: Field<number>;
};

type Props = {
  settings: SettingsFormValues;
  /** false renders the form read-only (role without workspace:update). */
  canEdit: boolean;
  onSubmit: (values: WorkspaceSettingsInput) => Promise<ActionResult>;
};

/** "" = default (null); anything else is the chosen value. */
const DEFAULT = "";

function modelOptions(list: readonly { id: string; label: string }[], fallback: string) {
  const known = list.find((m) => m.id === fallback)?.label ?? fallback;
  return [
    { value: DEFAULT, label: `Default (${known})` },
    ...list.map((m) => ({ value: m.id, label: m.label })),
  ];
}

function numberOrNull(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const stringOrNull = (raw: FormDataEntryValue | null) => {
  const s = String(raw ?? "");
  return s === DEFAULT ? null : s;
};

/** Workspace AI settings: models, monthly budget and time limits. Empty = default. */
export function SettingsForm({ settings, canEdit, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saved, setSaved] = useState(false);

  const err = (key: string) => (result && !result.ok ? result.fieldErrors?.[key]?.[0] : undefined);
  const current = <T,>(f: Field<T>) => (f.isDefault ? "" : String(f.value));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: WorkspaceSettingsInput = {
      analysisModel: stringOrNull(
        form.get("analysisModel"),
      ) as WorkspaceSettingsInput["analysisModel"],
      copywritingModel: stringOrNull(
        form.get("copywritingModel"),
      ) as WorkspaceSettingsInput["copywritingModel"],
      aiMonthlyCapUsd: numberOrNull(form.get("aiMonthlyCapUsd")),
      analysisTimeoutSec: numberOrNull(form.get("analysisTimeoutSec")),
      copywritingTimeoutSec: numberOrNull(form.get("copywritingTimeoutSec")),
    };
    setSaved(false);
    setResult(null);
    startTransition(async () => {
      const r = await onSubmit(values);
      setResult(r);
      if (r.ok) setSaved(true);
    });
  }

  const seconds = `${TIMEOUT_LIMITS.minSec} to ${TIMEOUT_LIMITS.maxSec} seconds`;

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <fieldset disabled={!canEdit || pending} className="grid gap-6 disabled:opacity-90">
        <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">AI usage</legend>
          <SelectField
            id="analysisModel"
            name="analysisModel"
            label="Product identification"
            options={modelOptions(ANALYSIS_MODELS, settings.analysisModel.defaultValue)}
            defaultValue={current(settings.analysisModel)}
            hint="Gemini watches the TikTok video or reads the product page."
            error={err("analysisModel")}
          />
          <SelectField
            id="copywritingModel"
            name="copywritingModel"
            label="Product page copy"
            options={modelOptions(COPYWRITING_MODELS, settings.copywritingModel.defaultValue)}
            defaultValue={current(settings.copywritingModel)}
            hint="Claude writes the Shopify page in the brand language."
            error={err("copywritingModel")}
          />
          <TextField
            id="aiMonthlyCapUsd"
            name="aiMonthlyCapUsd"
            label="Monthly AI budget"
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            placeholder={String(settings.aiMonthlyCapUsd.defaultValue)}
            defaultValue={current(settings.aiMonthlyCapUsd)}
            suffix="USD"
            hint="AI and paid search calls stop for the month once reached. 0 turns AI off."
            error={err("aiMonthlyCapUsd")}
            className="sm:col-span-2"
          />
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Time limits</legend>
          <TextField
            id="analysisTimeoutSec"
            name="analysisTimeoutSec"
            label="Product identification"
            type="number"
            inputMode="numeric"
            min={TIMEOUT_LIMITS.minSec}
            max={TIMEOUT_LIMITS.maxSec}
            step="1"
            placeholder={String(settings.analysisTimeoutSec.defaultValue)}
            defaultValue={current(settings.analysisTimeoutSec)}
            suffix="s"
            hint={`Download, upload and analysis of one video, ${seconds}. When it runs out, the step is retried later.`}
            error={err("analysisTimeoutSec")}
          />
          <TextField
            id="copywritingTimeoutSec"
            name="copywritingTimeoutSec"
            label="Product page copy"
            type="number"
            inputMode="numeric"
            min={TIMEOUT_LIMITS.minSec}
            max={TIMEOUT_LIMITS.maxSec}
            step="1"
            placeholder={String(settings.copywritingTimeoutSec.defaultValue)}
            defaultValue={current(settings.copywritingTimeoutSec)}
            suffix="s"
            hint={`Writing one product page, ${seconds}.`}
            error={err("copywritingTimeoutSec")}
          />
        </fieldset>
      </fieldset>

      <p className="text-sm text-muted-foreground">
        Leave a field empty (or pick Default) to use the default value shown in grey. Changes apply
        to the next AI step and are recorded in the audit log.
      </p>

      {result && !result.ok ? <FormError message={result.error} /> : null}
      {saved ? <FormSuccess message="Settings saved." /> : null}

      {canEdit ? (
        <div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
