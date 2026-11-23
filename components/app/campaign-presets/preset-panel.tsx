"use client";

import { CopyIcon, PencilIcon, PlusIcon, RocketIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { fieldError, type ActionResult } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormError, SelectField, TextField, selectClass } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";
import {
  AGE_GROUP_LABELS,
  AGE_GROUPS,
  BUILT_IN_SETTINGS,
  DEFAULT_TOTAL_DAYS,
  MAX_TOTAL_DAYS,
  OPERATING_SYSTEMS,
  PRESET_KIND_LABELS,
  type CampaignPresetKind,
  type CampaignPresetSettings,
} from "@/lib/domain/campaign-presets";
import type { CampaignPresetDTO } from "@/lib/services/campaign-presets";
import { cn } from "@/lib/utils";

type PresetInput = { name: string; isDefault: boolean; settings: CampaignPresetSettings };

export type PresetPanelProps = {
  brandCurrency: string;
  brandCountry: string;
  defaultTestBudget: number | null;
  presets: CampaignPresetDTO[];
  canEdit: boolean;
  onCreate: (kind: CampaignPresetKind, input: PresetInput) => Promise<ActionResult<{ id: string }>>;
  onUpdate: (presetId: string, input: PresetInput) => Promise<ActionResult<{ id: string }>>;
  onDelete: (presetId: string) => Promise<ActionResult>;
  onSetDefault: (presetId: string) => Promise<ActionResult>;
};

const KIND_HELP: Record<CampaignPresetKind, string> = {
  new_test:
    "Used when Trendcart prepares the paused test campaign of a new product (GATE 3). The default one is preselected; you can pick another when approving the videos.",
  duplicate:
    "Used when you duplicate a launched campaign. The copy is created paused and only spends after you launch it.",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function summary(s: CampaignPresetSettings, currency: string, kind: CampaignPresetKind): string {
  const budget =
    s.budget.amount !== null
      ? `${s.budget.amount} ${currency}`
      : kind === "duplicate"
        ? "same budget as the source"
        : "brand default budget";
  const parts = [
    `${budget} ${s.budget.mode === "daily" ? "per day" : `total over ${s.budget.totalDays} days`}`,
    s.budget.level === "campaign" ? "campaign budget (CBO)" : "per ad group",
    s.bidding.strategy === "cost_cap" ? `cost cap ${s.bidding.bidAmount}` : "lowest cost",
    s.objective === "WEB_CONVERSIONS" ? "website conversions" : "traffic",
    s.structure.adGroups === "per_video" ? "1 ad group per video" : "1 ad group",
    s.targeting.countries.length ? s.targeting.countries.join(", ") : "brand country",
  ];
  if (s.placements.searchResults) parts.push("search placement on");
  if (s.dayparting) parts.push("dayparting");
  return parts.join(" · ");
}

export function PresetPanel(props: PresetPanelProps) {
  return (
    <div className="grid gap-8">
      {(["new_test", "duplicate"] as const).map((kind) => (
        <PresetKindList key={kind} kind={kind} {...props} />
      ))}
    </div>
  );
}

function PresetKindList({ kind, ...props }: PresetPanelProps & { kind: CampaignPresetKind }) {
  const presets = props.presets.filter((p) => p.kind === kind);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const Icon = kind === "new_test" ? RocketIcon : CopyIcon;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon aria-hidden="true" className="size-4 text-brand-text" />
            {PRESET_KIND_LABELS[kind]}
          </h3>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{KIND_HELP[kind]}</p>
        </div>
        {props.canEdit && editing !== "new" ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <PlusIcon aria-hidden="true" />
            New setting
          </Button>
        ) : null}
      </div>
      <FormError message={error} />

      {editing === "new" ? (
        <PresetEditor
          kind={kind}
          brandCurrency={props.brandCurrency}
          brandCountry={props.brandCountry}
          defaultTestBudget={props.defaultTestBudget}
          initial={{
            name: `${kind === "new_test" ? "Brand new campaign setup" : "Campaign duplicate settings"} ${presets.length + 1}`,
            isDefault: presets.length === 0,
            settings: BUILT_IN_SETTINGS,
          }}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            const result = await props.onCreate(kind, input);
            if (result.ok) setEditing(null);
            return result;
          }}
        />
      ) : null}

      {presets.length === 0 && editing !== "new" ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground">
          No saved settings yet.{" "}
          {kind === "new_test"
            ? "Trendcart uses its built-in setup: one ad group in the brand country, the brand default budget per day, lowest cost, TikTok placement only."
            : "Duplicates keep the source budget with the built-in setup."}
        </p>
      ) : null}

      <ul className="grid gap-2">
        {presets.map((p) =>
          editing === p.id ? (
            <li key={p.id}>
              <PresetEditor
                kind={kind}
                brandCurrency={props.brandCurrency}
                brandCountry={props.brandCountry}
                defaultTestBudget={props.defaultTestBudget}
                initial={{ name: p.name, isDefault: p.isDefault, settings: p.settings }}
                onCancel={() => setEditing(null)}
                onSave={async (input) => {
                  const result = await props.onUpdate(p.id, input);
                  if (result.ok) setEditing(null);
                  return result;
                }}
              />
            </li>
          ) : (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.name}
                  {p.isDefault ? (
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-text">
                      Default
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {summary(p.settings, props.brandCurrency, kind)}
                </p>
              </div>
              {props.canEdit ? (
                <div className="flex flex-wrap gap-1.5">
                  {!p.isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          setError(null);
                          const r = await props.onSetDefault(p.id);
                          if (!r.ok) setError(r.error);
                        })
                      }
                    >
                      <StarIcon aria-hidden="true" />
                      Make default
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setEditing(p.id)}>
                    <PencilIcon aria-hidden="true" />
                    Edit
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`}>
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    }
                    title={`Delete “${p.name}”?`}
                    description="Campaigns already built from it keep their settings."
                    confirmLabel="Delete"
                    pendingLabel="Deleting…"
                    destructive
                    onConfirm={() => props.onDelete(p.id)}
                  />
                </div>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/* Editor ---------------------------------------------------------------------- */

function listInput(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function Check({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-sm">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--brand)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function PresetEditor({
  kind,
  brandCurrency,
  brandCountry,
  defaultTestBudget,
  initial,
  onCancel,
  onSave,
}: {
  kind: CampaignPresetKind;
  brandCurrency: string;
  brandCountry: string;
  defaultTestBudget: number | null;
  initial: PresetInput;
  onCancel: () => void;
  onSave: (input: PresetInput) => Promise<ActionResult<{ id: string }>>;
}) {
  const [name, setName] = useState(initial.name);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [s, setS] = useState<CampaignPresetSettings>(initial.settings);
  const [amount, setAmount] = useState(
    initial.settings.budget.amount === null ? "" : String(initial.settings.budget.amount),
  );
  const [bid, setBid] = useState(
    initial.settings.bidding.bidAmount ? String(initial.settings.bidding.bidAmount) : "",
  );
  const [countries, setCountries] = useState(initial.settings.targeting.countries.join(", "));
  const [languages, setLanguages] = useState(initial.settings.targeting.languages.join(", "));
  const [result, setResult] = useState<ActionResult<{ id: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const p = `preset-${kind}`;
  const err = (name: string) => fieldError(result, name);

  function set<K extends keyof CampaignPresetSettings>(
    key: K,
    patch: Partial<CampaignPresetSettings[K]>,
  ) {
    setS((cur) => ({ ...cur, [key]: { ...(cur[key] as object), ...patch } }));
  }

  function toggle<T extends string>(list: readonly T[], value: T, on: boolean): T[] {
    return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountValue = amount.trim() === "" ? null : Number(amount.replace(",", "."));
    const bidValue = bid.trim() === "" ? undefined : Number(bid.replace(",", "."));
    const settings: CampaignPresetSettings = {
      ...s,
      budget: { ...s.budget, amount: amountValue },
      bidding: { ...s.bidding, bidAmount: bidValue },
      targeting: {
        ...s.targeting,
        countries: listInput(countries).map((c) => c.toUpperCase()),
        languages: listInput(languages).map((l) => l.toLowerCase()),
      },
    };
    startTransition(async () => {
      setResult(await onSave({ name, isDefault, settings }));
    });
  }

  const budgetHint =
    kind === "duplicate"
      ? "In the brand currency. Empty: same budget as the campaign you duplicate."
      : `In the brand currency. Empty: the brand default test budget${defaultTestBudget ? ` (${defaultTestBudget} ${brandCurrency})` : ""}.`;

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-xl border border-brand-border bg-background p-4"
      aria-label={`${PRESET_KIND_LABELS[kind]}: edit`}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField
          id={`${p}-name`}
          label="Name"
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
          error={err("name")}
        />
        <Check
          id={`${p}-default`}
          label="Default for this brand"
          checked={isDefault}
          onChange={setIsDefault}
        />
      </div>

      <Fieldset legend="Budget and bidding">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            id={`${p}-amount`}
            label="Budget"
            inputMode="decimal"
            placeholder={kind === "duplicate" ? "Same as source" : "Brand default"}
            value={amount}
            suffix={brandCurrency}
            onChange={(e) => setAmount(e.target.value)}
            hint={budgetHint}
            error={err("settings.budget.amount")}
          />
          <SelectField
            id={`${p}-mode`}
            label="Budget type"
            value={s.budget.mode}
            onChange={(e) => set("budget", { mode: e.target.value as "daily" | "total" })}
            options={[
              { value: "daily", label: "Daily" },
              { value: "total", label: "Total (lifetime)" },
            ]}
          />
          <SelectField
            id={`${p}-level`}
            label="Budget on"
            value={s.budget.level}
            onChange={(e) => set("budget", { level: e.target.value as "campaign" | "ad_group" })}
            options={[
              { value: "ad_group", label: "Each ad group (ABO)" },
              { value: "campaign", label: "Campaign (CBO)" },
            ]}
            hint="CBO lets TikTok move the budget between ad groups."
          />
        </div>
        {s.budget.mode === "total" ? (
          <TextField
            id={`${p}-days`}
            label="Run for"
            type="number"
            min={1}
            max={MAX_TOTAL_DAYS}
            value={s.budget.totalDays}
            suffix="days"
            className="sm:max-w-48"
            onChange={(e) =>
              set("budget", { totalDays: Number(e.target.value) || DEFAULT_TOTAL_DAYS })
            }
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            id={`${p}-bid`}
            label="Bidding"
            value={s.bidding.strategy}
            onChange={(e) =>
              set("bidding", { strategy: e.target.value as "lowest_cost" | "cost_cap" })
            }
            options={[
              { value: "lowest_cost", label: "Lowest cost" },
              { value: "cost_cap", label: "Cost cap" },
            ]}
          />
          {s.bidding.strategy === "cost_cap" ? (
            <TextField
              id={`${p}-bid-amount`}
              label="Bid (cost cap)"
              inputMode="decimal"
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              hint="In the TikTok Ads account currency."
              error={err("settings.bidding.bidAmount")}
            />
          ) : null}
          <SelectField
            id={`${p}-pacing`}
            label="Pacing"
            value={s.bidding.pacing}
            onChange={(e) => set("bidding", { pacing: e.target.value as "smooth" | "fast" })}
            options={[
              { value: "smooth", label: "Standard (spread over the day)" },
              { value: "fast", label: "Accelerated (spend as fast as possible)" },
            ]}
          />
        </div>
        <Check
          id={`${p}-daypart`}
          label="Only deliver at certain times (dayparting)"
          hint="In the TikTok Ads account time zone."
          checked={!!s.dayparting}
          onChange={(on) =>
            setS((cur) => ({
              ...cur,
              dayparting: on ? { days: [0, 1, 2, 3, 4, 5, 6], startHour: 8, endHour: 23 } : null,
            }))
          }
        />
        {s.dayparting ? (
          <div className="grid gap-3 rounded-lg bg-surface p-3">
            <div className="flex flex-wrap gap-3" role="group" aria-label="Days">
              {DAYS.map((d, i) => (
                <Check
                  key={d}
                  id={`${p}-day-${i}`}
                  label={d}
                  checked={s.dayparting!.days.includes(i)}
                  onChange={(on) =>
                    setS((cur) => ({
                      ...cur,
                      dayparting: {
                        ...cur.dayparting!,
                        days: on
                          ? [...new Set([...cur.dayparting!.days, i])].sort()
                          : cur.dayparting!.days.filter((x) => x !== i),
                      },
                    }))
                  }
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor={`${p}-from`}>From</label>
              <select
                id={`${p}-from`}
                className={cn(selectClass, "w-24")}
                value={s.dayparting.startHour}
                onChange={(e) =>
                  setS((cur) => ({
                    ...cur,
                    dayparting: { ...cur.dayparting!, startHour: Number(e.target.value) },
                  }))
                }
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${h}:00`}</option>
                ))}
              </select>
              <label htmlFor={`${p}-to`}>to</label>
              <select
                id={`${p}-to`}
                className={cn(selectClass, "w-24")}
                value={s.dayparting.endHour}
                onChange={(e) =>
                  setS((cur) => ({
                    ...cur,
                    dayparting: { ...cur.dayparting!, endHour: Number(e.target.value) },
                  }))
                }
              >
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                  <option key={h} value={h}>{`${h}:00`}</option>
                ))}
              </select>
            </div>
            <FormError
              message={err("settings.dayparting.endHour") ?? err("settings.dayparting.days")}
            />
          </div>
        ) : null}
      </Fieldset>

      <Fieldset legend="Targeting">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id={`${p}-countries`}
            label="Countries"
            placeholder={brandCountry}
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
            hint={`2-letter codes separated by commas. Empty: the brand country (${brandCountry}).`}
            error={err("settings.targeting.countries.0") ?? err("settings.targeting.countries")}
          />
          <TextField
            id={`${p}-languages`}
            label="Languages"
            placeholder="All languages"
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            hint="2-letter codes (en, fr…). Empty: all languages."
            error={err("settings.targeting.languages.0")}
          />
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium">Ages</p>
          <div className="flex flex-wrap gap-3" role="group" aria-label="Ages">
            {AGE_GROUPS.map((a) => (
              <Check
                key={a}
                id={`${p}-age-${a}`}
                label={AGE_GROUP_LABELS[a]}
                checked={s.targeting.ageGroups.includes(a)}
                onChange={(on) =>
                  set("targeting", { ageGroups: toggle(s.targeting.ageGroups, a, on) })
                }
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">None ticked: all ages.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id={`${p}-gender`}
            label="Gender"
            value={s.targeting.gender}
            onChange={(e) =>
              set("targeting", { gender: e.target.value as "all" | "male" | "female" })
            }
            options={[
              { value: "all", label: "All" },
              { value: "female", label: "Women" },
              { value: "male", label: "Men" },
            ]}
          />
          <div className="grid gap-2">
            <p className="text-sm font-medium">Devices</p>
            <div className="flex gap-4" role="group" aria-label="Devices">
              {OPERATING_SYSTEMS.map((os) => (
                <Check
                  key={os}
                  id={`${p}-os-${os}`}
                  label={os === "IOS" ? "iOS" : "Android"}
                  checked={s.targeting.operatingSystems.includes(os)}
                  onChange={(on) =>
                    set("targeting", {
                      operatingSystems: toggle(s.targeting.operatingSystems, os, on),
                    })
                  }
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">None ticked: all devices.</p>
          </div>
        </div>
      </Fieldset>

      <Fieldset legend="Placements and extras">
        <p className="text-xs text-muted-foreground">
          Trendcart always places ads on TikTok only: never Pangle or the Global App Bundle, which
          TikTok turns on by default.
        </p>
        <Check
          id={`${p}-search`}
          label="Also show in TikTok search results"
          hint="Off by default: it widens delivery beyond the feed."
          checked={s.placements.searchResults}
          onChange={(v) => set("placements", { searchResults: v })}
        />
        <Check
          id={`${p}-comments`}
          label="Turn off comments"
          checked={s.placements.commentsDisabled}
          onChange={(v) => set("placements", { commentsDisabled: v })}
        />
        <Check
          id={`${p}-download`}
          label="Turn off video downloads"
          checked={s.placements.videoDownloadDisabled}
          onChange={(v) => set("placements", { videoDownloadDisabled: v })}
        />
        <Check
          id={`${p}-share`}
          label="Turn off sharing"
          checked={s.placements.shareDisabled}
          onChange={(v) => set("placements", { shareDisabled: v })}
        />
      </Fieldset>

      <Fieldset legend="Objective and structure">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id={`${p}-objective`}
            label="Objective"
            value={s.objective}
            onChange={(e) =>
              setS((cur) => ({
                ...cur,
                objective: e.target.value as "TRAFFIC" | "WEB_CONVERSIONS",
              }))
            }
            options={[
              { value: "TRAFFIC", label: "Traffic (clicks to the page)" },
              { value: "WEB_CONVERSIONS", label: "Website conversions (pixel)" },
            ]}
          />
          <SelectField
            id={`${p}-structure`}
            label="Ad groups"
            value={s.structure.adGroups}
            onChange={(e) =>
              set("structure", { adGroups: e.target.value as "single" | "per_video" })
            }
            options={[
              { value: "single", label: "One ad group with every video" },
              { value: "per_video", label: "One ad group per video" },
            ]}
            hint="One per video gives each video its own budget (ABO test)."
          />
        </div>
        {s.objective === "WEB_CONVERSIONS" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id={`${p}-pixel`}
              label="TikTok pixel ID"
              value={s.pixelId ?? ""}
              onChange={(e) => setS((cur) => ({ ...cur, pixelId: e.target.value }))}
              error={err("settings.pixelId")}
            />
            <TextField
              id={`${p}-event`}
              label="Optimization event"
              placeholder="e.g. SHOPPING"
              value={s.optimizationEvent ?? ""}
              onChange={(e) => setS((cur) => ({ ...cur, optimizationEvent: e.target.value }))}
              hint="The event code as shown in TikTok Events Manager."
              error={err("settings.optimizationEvent")}
            />
          </div>
        ) : null}
      </Fieldset>

      <FormError message={result && !result.ok ? result.error : null} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
