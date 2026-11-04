"use client";

import { ClockIcon, PauseIcon, PlayIcon, RocketIcon, WalletIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ServiceFailure } from "@/lib/services/errors";

import type { ActionResult } from "../action-result";
import { ConfirmDialog } from "../confirm-dialog";
import { DisabledReason } from "../disabled-reason";
import { TextAreaField, TextField } from "../form-controls";
import { BUDGET_UNSUPPORTED } from "./action-markers";

const NOT_ALLOWED = "Only a Media buyer or the Owner can do this.";

/**
 * GATE 4: "Approve and launch". The dialog states that the campaign starts
 * spending on the advertiser account, and the launch button stays disabled
 * until the reviewer ticks that they understand it.
 */
export function LaunchCampaignButton({
  advertiser,
  budget,
  ceiling,
  countries,
  adGroups,
  ads,
  retry = false,
  canLaunch,
  approverLabel,
  onLaunch,
}: {
  advertiser: string;
  budget: string;
  ceiling: string;
  countries: string;
  adGroups: number;
  ads: number;
  /** A previous launch did not finish (stale claim): this approves it again. */
  retry?: boolean;
  canLaunch: boolean;
  approverLabel: string;
  onLaunch: (input: { note?: string }) => Promise<ActionResult>;
}) {
  const uid = useId();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const trigger = (
    <Button size="xl" disabled={!canLaunch}>
      <RocketIcon aria-hidden="true" />
      {retry ? "Retry launch" : "Approve & launch"}
    </Button>
  );
  if (!canLaunch) {
    return (
      <DisabledReason reason={`Waiting for: ${approverLabel}. Your role can view but not launch.`}>
        {trigger}
      </DisabledReason>
    );
  }
  return (
    <ConfirmDialog
      trigger={trigger}
      title="Launch this campaign and start spending?"
      description={
        <div className="grid gap-2">
          <p>
            This enables the campaign, its {adGroups} ad group{adGroups === 1 ? "" : "s"} and {ads}{" "}
            ad{ads === 1 ? "" : "s"} on the TikTok Ads account{" "}
            <strong className="text-foreground">{advertiser}</strong>.{" "}
            <strong className="text-foreground">
              It starts spending on this advertiser account right away.
            </strong>
          </p>
          <ul className="grid list-disc gap-0.5 pl-4">
            <li>Budget: {budget}</li>
            <li>Up to {ceiling} across the campaign</li>
            <li>Countries: {countries}</li>
          </ul>
          <p>You can pause it at any time from this screen. Your approval is recorded.</p>
        </div>
      }
      confirmLabel="Launch and start spending"
      pendingLabel="Launching on TikTok…"
      confirmDisabled={!ack}
      onConfirm={() => onLaunch({ note: note.trim() || undefined })}
      onSuccess={() => {
        setAck(false);
        setNote("");
      }}
    >
      <div className="grid gap-3">
        <label htmlFor={`${uid}-ack`} className="flex items-start gap-2 text-sm">
          <input
            id={`${uid}-ack`}
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.currentTarget.checked)}
            className="mt-1 accent-brand"
          />
          <span>I understand this starts spending on {advertiser}.</span>
        </label>
        <TextAreaField
          id={`${uid}-note`}
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          maxLength={2000}
          rows={2}
        />
      </div>
    </ConfirmDialog>
  );
}

/** Pause (stops spending) or resume (starts spending again) a launched campaign. */
export function PauseResumeButton({
  status,
  advertiser,
  canPause,
  canResume,
  onPause,
  onResume,
}: {
  status: "active" | "paused";
  advertiser: string;
  canPause: boolean;
  canResume: boolean;
  onPause: () => Promise<ActionResult>;
  onResume: () => Promise<ActionResult>;
}) {
  if (status === "active") {
    const trigger = (
      <Button variant="outline" size="lg" disabled={!canPause}>
        <PauseIcon aria-hidden="true" />
        Pause campaign
      </Button>
    );
    if (!canPause) return <DisabledReason reason={NOT_ALLOWED}>{trigger}</DisabledReason>;
    return (
      <ConfirmDialog
        trigger={trigger}
        title="Pause this campaign?"
        description="Every ad group and ad is disabled on TikTok and spending stops. You can resume it later."
        confirmLabel="Pause campaign"
        pendingLabel="Pausing…"
        onConfirm={onPause}
      />
    );
  }
  const trigger = (
    <Button size="lg" disabled={!canResume}>
      <PlayIcon aria-hidden="true" />
      Resume campaign
    </Button>
  );
  if (!canResume) return <DisabledReason reason={NOT_ALLOWED}>{trigger}</DisabledReason>;
  return (
    <ConfirmDialog
      trigger={trigger}
      title="Resume this campaign and start spending again?"
      description={
        <>
          The campaign, its ad groups and ads are enabled again on{" "}
          <strong className="text-foreground">{advertiser}</strong> and{" "}
          <strong className="text-foreground">start spending again</strong> with the current budget.
        </>
      }
      confirmLabel="Resume and start spending"
      pendingLabel="Resuming…"
      onConfirm={onResume}
    />
  );
}

function budgetUnavailable(failure: ServiceFailure) {
  if (failure.fieldErrors?.amount?.[0] !== BUDGET_UNSUPPORTED) return null;
  return (
    <Button size="lg" variant="outline" disabled>
      <ClockIcon aria-hidden="true" />
      Not available yet
    </Button>
  );
}

/** Changes the budget amount (same mode and level). Never enables anything. */
export function ChangeBudgetButton({
  amount,
  currency,
  levelLabel,
  canChange,
  onChange,
}: {
  amount: number;
  currency: string;
  /** "per day per ad group". */
  levelLabel: string;
  canChange: boolean;
  onChange: (input: { amount: number }) => Promise<ActionResult>;
}) {
  const uid = useId();
  const [value, setValue] = useState(String(amount));
  const parsed = Number.parseFloat(value.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0;
  const trigger = (
    <Button variant="outline" size="lg" disabled={!canChange}>
      <WalletIcon aria-hidden="true" />
      Change budget
    </Button>
  );
  if (!canChange) return <DisabledReason reason={NOT_ALLOWED}>{trigger}</DisabledReason>;
  return (
    <ConfirmDialog
      trigger={trigger}
      title="Change the budget"
      description={`The new amount applies ${levelLabel}. It does not enable or pause anything. The change is recorded in the audit log.`}
      confirmLabel="Save budget"
      pendingLabel="Saving…"
      confirmDisabled={!valid || parsed === amount}
      errorAction={budgetUnavailable}
      onConfirm={() => onChange({ amount: parsed })}
    >
      <TextField
        id={`${uid}-amount`}
        label="Budget"
        type="number"
        inputMode="decimal"
        min={1}
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        suffix={currency}
        error={value !== "" && !valid ? "Enter a budget above zero." : undefined}
      />
    </ConfirmDialog>
  );
}
