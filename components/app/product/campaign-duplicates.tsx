"use client";

import { CopyIcon, PauseIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { ActionResult } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DisabledReason } from "@/components/app/disabled-reason";
import { SelectField, TextAreaField } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";
import type { CampaignDuplicateDTO } from "@/lib/services/campaign-duplicates";

import { ChangeBudgetButton } from "./campaign-controls";

export type DuplicatesPanelProps = {
  /** Campaign the copy is made from (the launched GATE 4 campaign). */
  sourceCampaignId: string;
  sourceLaunched: boolean;
  duplicates: CampaignDuplicateDTO[];
  presets: { id: string; name: string; isDefault: boolean }[];
  canDuplicate: boolean;
  canLaunch: boolean;
  canPause: boolean;
  canBudget: boolean;
  onDuplicate: (campaignId: string, input: { presetId?: string }) => Promise<ActionResult>;
  onLaunch: (campaignId: string, input: { note?: string }) => Promise<ActionResult>;
  onPause: (campaignId: string) => Promise<ActionResult>;
  onBudget: (campaignId: string, input: { amount: number }) => Promise<ActionResult>;
};

const STATUS: Record<CampaignDuplicateDTO["status"], { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-2 text-muted-foreground" },
  creating: { label: "Creating on TikTok", className: "bg-surface-2 text-muted-foreground" },
  paused: { label: "Paused", className: "bg-warning/10 text-warning" },
  active: { label: "Active", className: "bg-brand-soft text-brand-text" },
  failed: { label: "Failed", className: "bg-danger/10 text-danger" },
};

function money(amount: number, currency: string | null) {
  return `${amount}${currency ? ` ${currency}` : ""}`;
}

export function DuplicatesPanel(props: DuplicatesPanelProps) {
  const [presetId, setPresetId] = useState(props.presets.find((p) => p.isDefault)?.id ?? "");
  const preset = props.presets.find((p) => p.id === presetId) ?? null;
  const blocker = !props.canDuplicate
    ? "Only a Media buyer or the Owner can duplicate a campaign."
    : !props.sourceLaunched
      ? "Launch the campaign first: only a launched campaign can be duplicated."
      : null;
  const trigger = (
    <Button variant="outline" disabled={blocker !== null}>
      <CopyIcon aria-hidden="true" />
      Duplicate campaign
    </Button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          id="duplicate-preset"
          label="Duplicate with"
          value={presetId}
          disabled={blocker !== null}
          onChange={(e) => setPresetId(e.currentTarget.value)}
          className="w-full max-w-sm"
          options={[
            ...props.presets.map((p) => ({
              value: p.id,
              label: `${p.name}${p.isDefault ? " (default)" : ""}`,
            })),
            { value: "", label: "Built-in settings (same budget)" },
          ]}
          hint={
            <>
              Saved in{" "}
              <Link href="/app/brands" className="text-brand-text underline underline-offset-4">
                Brands, Campaign settings
              </Link>
              .
            </>
          }
        />
        {blocker ? (
          <DisabledReason reason={blocker}>{trigger}</DisabledReason>
        ) : (
          <ConfirmDialog
            trigger={trigger}
            title="Duplicate this campaign?"
            description={
              <>
                Trendcart creates a new campaign with the same videos, ad texts and landing page,
                using{" "}
                <strong className="text-foreground">
                  {preset?.name ?? "the built-in settings"}
                </strong>
                . It is created <strong className="text-foreground">paused</strong>: nothing spends
                until you launch it.
              </>
            }
            confirmLabel="Create paused copy"
            pendingLabel="Creating on TikTok…"
            onConfirm={() =>
              props.onDuplicate(props.sourceCampaignId, presetId ? { presetId } : {})
            }
          />
        )}
      </div>

      {props.duplicates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No duplicates yet.</p>
      ) : (
        <ul className="grid gap-2">
          {props.duplicates.map((d) => (
            <DuplicateRow key={d.id} d={d} {...props} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DuplicateRow({ d, ...props }: DuplicatesPanelProps & { d: CampaignDuplicateDTO }) {
  const [note, setNote] = useState("");
  const status = STATUS[d.status];
  const b = d.budget;
  const canRun = d.status === "paused";
  return (
    <li className="grid gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="truncate">{d.name}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}
            >
              {status.label}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {d.presetName ?? "Built-in settings"} · {money(b.amount, d.currency)}{" "}
            {b.mode === "daily" ? "per day" : "in total"},{" "}
            {b.level === "campaign" ? "campaign budget" : "each ad group"} · {d.adGroupCount} ad
            group
            {d.adGroupCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRun ? (
            props.canLaunch ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm">
                    <PlayIcon aria-hidden="true" />
                    {d.launchedAt ? "Resume" : "Launch"}
                  </Button>
                }
                title={d.launchedAt ? "Resume this copy?" : "Launch this copy and start spending?"}
                description={
                  <>
                    It starts spending up to{" "}
                    <strong className="text-foreground">
                      {money(b.amount, d.currency)} {b.mode === "daily" ? "per day" : "in total"}
                    </strong>
                    {b.level === "ad_group" && d.adGroupCount > 1
                      ? ` on each of its ${d.adGroupCount} ad groups`
                      : ""}
                    . You can pause it at any time. Your approval is recorded.
                  </>
                }
                confirmLabel={
                  d.launchedAt ? "Resume and start spending" : "Launch and start spending"
                }
                pendingLabel="Launching on TikTok…"
                onConfirm={() => props.onLaunch(d.id, { note })}
              >
                <TextAreaField
                  id={`dup-note-${d.id}`}
                  label="Note (optional)"
                  value={note}
                  maxLength={2000}
                  rows={2}
                  onChange={(e) => setNote(e.currentTarget.value)}
                />
              </ConfirmDialog>
            ) : (
              <DisabledReason reason="Only a Media buyer or the Owner can launch.">
                <Button size="sm" disabled>
                  <PlayIcon aria-hidden="true" />
                  Launch
                </Button>
              </DisabledReason>
            )
          ) : null}
          {d.status === "active" && props.canPause ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline">
                  <PauseIcon aria-hidden="true" />
                  Pause
                </Button>
              }
              title="Pause this copy?"
              description="Every ad group and ad of this copy is disabled on TikTok and spending stops."
              confirmLabel="Pause"
              pendingLabel="Pausing…"
              onConfirm={() => props.onPause(d.id)}
            />
          ) : null}
          {(d.status === "paused" || d.status === "active") && b.mode === "daily" ? (
            <ChangeBudgetButton
              amount={b.amount}
              currency={d.currency ?? ""}
              min={d.minBudget}
              max={d.maxBudget}
              levelLabel={`per day, ${b.level === "ad_group" ? "to each ad group" : "to the campaign"}`}
              canChange={props.canBudget}
              onChange={(input) => props.onBudget(d.id, input)}
            />
          ) : null}
        </div>
      </div>
      {d.launchedAt ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ["Spend", money(d.totals.spend, d.currency)],
            ["Impressions", d.totals.impressions.toLocaleString("en")],
            ["Clicks", d.totals.clicks.toLocaleString("en")],
            ["Conversions", d.totals.conversions.toLocaleString("en")],
            ["ROAS", d.totals.roas === null ? "–" : String(d.totals.roas)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
