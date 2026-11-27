"use client";

import { CopyIcon, PauseIcon, PlayIcon, RocketIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import type { ActionResult } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DisabledReason } from "@/components/app/disabled-reason";
import { SelectField, TextAreaField } from "@/components/app/form-controls";
import { ChangeBudgetButton } from "@/components/app/product/campaign-controls";
import { Button } from "@/components/ui/button";

/*
 * Controls of one row of the Campaigns screen. Same rules as the product
 * page: a GATE 4 campaign is launched from its product (the approval needs
 * the full review), duplicates are launched here; nothing spends without an
 * explicit confirmation. Every action is a bound server action that
 * re-checks the role and the state.
 */

type Budget = { amount: number; mode: "daily" | "total"; level: "campaign" | "ad_group" };

export type CampaignRowActionsProps = {
  kind: "main" | "duplicate";
  productId: string;
  status: "draft" | "creating" | "paused" | "active" | "failed";
  launched: boolean;
  spendingUnknown: boolean;
  readyToLaunch: boolean;
  canDuplicateSource: boolean;
  advertiser: string;
  currency: string | null;
  budget: Budget;
  adGroupCount: number;
  minBudget: number | null;
  maxBudget: number;
  budgetUpdatable: boolean;
  presets: { id: string; name: string; isDefault: boolean }[];
  can: { launch: boolean; pause: boolean; budget: boolean; duplicate: boolean };
  onPause: () => Promise<ActionResult>;
  onResume: (input: { note?: string }) => Promise<ActionResult>;
  onBudget: (input: { amount: number }) => Promise<ActionResult>;
  onDuplicate: (input: { presetId?: string }) => Promise<ActionResult>;
};

const NOT_ALLOWED = "Only a Media buyer or the Owner can do this.";

function money(amount: number, currency: string | null) {
  return `${amount}${currency ? ` ${currency}` : ""}`;
}

export function CampaignRowActions(p: CampaignRowActionsProps) {
  const uid = useId();
  const [note, setNote] = useState("");
  const [presetId, setPresetId] = useState(p.presets.find((x) => x.isDefault)?.id ?? "");
  const preset = p.presets.find((x) => x.id === presetId) ?? null;
  const b = p.budget;
  const spend = `${money(b.amount, p.currency)} ${b.mode === "daily" ? "per day" : "in total"}${
    b.level === "ad_group" && p.adGroupCount > 1
      ? ` on each of its ${p.adGroupCount} ad groups`
      : ""
  }`;

  const actions: React.ReactNode[] = [];

  // GATE 4 is approved on the product page (full review of what launches).
  if (p.kind === "main" && p.readyToLaunch && !p.launched) {
    actions.push(
      <Button key="gate" asChild size="sm">
        <Link href={`/app/products/${p.productId}`}>
          <RocketIcon aria-hidden="true" />
          Review and launch
        </Link>
      </Button>,
    );
  }

  // Launch / resume: duplicates (any paused copy) and launched GATE 4 campaigns.
  const canRun = p.status === "paused" && (p.kind === "duplicate" || p.launched);
  if (canRun) {
    const label = p.launched ? "Resume" : "Launch";
    const trigger = (
      <Button size="sm" disabled={!p.can.launch}>
        <PlayIcon aria-hidden="true" />
        {label}
      </Button>
    );
    actions.push(
      p.can.launch ? (
        <ConfirmDialog
          key="run"
          trigger={trigger}
          title={p.launched ? "Resume this campaign?" : "Launch this copy and start spending?"}
          description={
            <>
              It is enabled on <strong className="text-foreground">{p.advertiser}</strong> and
              starts spending up to <strong className="text-foreground">{spend}</strong>. You can
              pause it at any time. Your approval is recorded.
            </>
          }
          confirmLabel={p.launched ? "Resume and start spending" : "Launch and start spending"}
          pendingLabel="Working on TikTok…"
          onConfirm={() => p.onResume({ note })}
        >
          {p.kind === "duplicate" ? (
            <TextAreaField
              id={`${uid}-note`}
              label="Note (optional)"
              value={note}
              maxLength={2000}
              rows={2}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          ) : null}
        </ConfirmDialog>
      ) : (
        <DisabledReason key="run" reason={NOT_ALLOWED}>
          {trigger}
        </DisabledReason>
      ),
    );
  }

  // Pause: active campaigns, and a failed launch that may be spending (GATE 4 only).
  if (p.status === "active" || (p.kind === "main" && p.spendingUnknown)) {
    const trigger = (
      <Button size="sm" variant="outline" disabled={!p.can.pause}>
        <PauseIcon aria-hidden="true" />
        Pause
      </Button>
    );
    actions.push(
      p.can.pause ? (
        <ConfirmDialog
          key="pause"
          trigger={trigger}
          title="Pause this campaign?"
          description="Every ad group and ad is disabled on TikTok and spending stops. You can resume it later."
          confirmLabel="Pause"
          pendingLabel="Pausing…"
          onConfirm={p.onPause}
        />
      ) : (
        <DisabledReason key="pause" reason={NOT_ALLOWED}>
          {trigger}
        </DisabledReason>
      ),
    );
  }

  if (p.budgetUpdatable && b.mode === "daily") {
    actions.push(
      <ChangeBudgetButton
        key="budget"
        amount={b.amount}
        currency={p.currency ?? ""}
        min={p.minBudget}
        max={p.maxBudget}
        levelLabel={`per day, ${b.level === "ad_group" ? "to each ad group" : "to the campaign"}`}
        canChange={p.can.budget}
        onChange={p.onBudget}
      />,
    );
  }

  if (p.canDuplicateSource) {
    const trigger = (
      <Button size="sm" variant="outline" disabled={!p.can.duplicate}>
        <CopyIcon aria-hidden="true" />
        Duplicate
      </Button>
    );
    actions.push(
      p.can.duplicate ? (
        <ConfirmDialog
          key="dup"
          trigger={trigger}
          title="Duplicate this campaign?"
          description={
            <>
              Trendcart creates a new campaign with the same videos, ad texts and landing page,
              using{" "}
              <strong className="text-foreground">{preset?.name ?? "the built-in settings"}</strong>
              . It is created <strong className="text-foreground">paused</strong>: nothing spends
              until you launch it.
            </>
          }
          confirmLabel="Create paused copy"
          pendingLabel="Creating on TikTok…"
          onConfirm={() => p.onDuplicate(presetId ? { presetId } : {})}
        >
          <SelectField
            id={`${uid}-preset`}
            label="Duplicate with"
            value={presetId}
            onChange={(e) => setPresetId(e.currentTarget.value)}
            options={[
              ...p.presets.map((x) => ({
                value: x.id,
                label: `${x.name}${x.isDefault ? " (default)" : ""}`,
              })),
              { value: "", label: "Built-in settings (same budget)" },
            ]}
          />
        </ConfirmDialog>
      ) : (
        <DisabledReason key="dup" reason={NOT_ALLOWED}>
          {trigger}
        </DisabledReason>
      ),
    );
  }

  if (actions.length === 0) return null;
  return <div className="flex flex-wrap gap-2">{actions}</div>;
}
