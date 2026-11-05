"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  AI_VISION_PROVIDERS,
  ANALYSIS_MODELS,
  analysisProviderOf,
  COPYWRITING_MODELS,
  DEFAULT_CLAUDE_ANALYSIS_MODEL,
  type AiVisionProvider,
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

  // Gemini or Claude for product identification and the ad rules check. The
  // provider is the chosen model's; "" = default model (Gemini unless the env
  // default says otherwise).
  const [analysisModel, setAnalysisModel] = useState(current(settings.analysisModel));
  const defaultProvider = analysisProviderOf(settings.analysisModel.defaultValue);
  const provider: AiVisionProvider =
    analysisModel === DEFAULT ? defaultProvider : analysisProviderOf(analysisModel);
  const providerModels = ANALYSIS_MODELS.filter((m) => m.provider === provider);
  const analysisOptions =
    provider === defaultProvider
      ? modelOptions(providerModels, settings.analysisModel.defaultValue)
      : providerModels.map((m) => ({ value: m.id, label: m.label }));

  function switchProvider(next: AiVisionProvider) {
    if (next === provider) return;
    if (next === defaultProvider) setAnalysisModel(DEFAULT);
    else
      setAnalysisModel(
        next === "anthropic"
          ? DEFAULT_CLAUDE_ANALYSIS_MODEL
          : (ANALYSIS_MODELS.find((m) => m.provider === next)?.id ?? DEFAULT),
      );
  }
  const providerMeta = AI_VISION_PROVIDERS.find((p) => p.id === provider)!;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: WorkspaceSettingsInput = {
      analysisModel: stringOrNull(analysisModel) as WorkspaceSettingsInput["analysisModel"],
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
          <div
            role="radiogroup"
            aria-labelledby="ai-provider-label"
            aria-describedby="ai-provider-hint"
            className="grid gap-2 sm:col-span-2"
          >
            <span id="ai-provider-label" className="text-sm font-medium">
              Product identification and ad rules check
            </span>
            <div className="flex w-fit gap-1 rounded-lg border border-border bg-surface-2 p-1">
              {AI_VISION_PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-muted-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                >
                  <input
                    type="radio"
                    name="aiProvider"
                    value={p.id}
                    checked={provider === p.id}
                    onChange={() => switchProvider(p.id)}
                    className="sr-only"
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <p
              id="ai-provider-hint"
              className={
                provider === "anthropic" ? "text-xs text-warning" : "text-xs text-muted-foreground"
              }
            >
              {providerMeta.description}
              {provider === "anthropic" ? " Needs ANTHROPIC_API_KEY." : " Needs GEMINI_API_KEY."}
            </p>
          </div>
          <SelectField
            id="analysisModel"
            name="analysisModel"
            label={`${providerMeta.label} model`}
            options={analysisOptions}
            value={analysisModel}
            onChange={(e) => setAnalysisModel(e.currentTarget.value)}
            hint={
              provider === "anthropic"
                ? "Identifies the product from the cover image, caption or product page, and reviews the caption and claims."
                : "Watches the TikTok video or reads the product page, and reviews the video against the ad rules."
            }
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
