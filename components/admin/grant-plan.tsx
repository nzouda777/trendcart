"use client";

import { GiftIcon } from "lucide-react";
import { useState } from "react";

import type { ActionResult } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SelectField, TextField } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";

/** Gives a workspace a plan without payment, for a number of days or with no end. */
export function GrantPlanButton({
  plans,
  onGrant,
}: {
  plans: { id: string; name: string; status: string }[];
  onGrant: (input: { planId: string; days: string; note?: string }) => Promise<ActionResult>;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="outline" disabled={plans.length === 0}>
          <GiftIcon aria-hidden="true" />
          Grant a plan
        </Button>
      }
      title="Grant a plan without payment?"
      description="The workspace gets the plan's limits and features at no cost. Its free trial (if any) is not used up."
      confirmLabel="Grant plan"
      confirmDisabled={!planId}
      onConfirm={() => onGrant({ planId, days, note })}
    >
      <div className="grid gap-3">
        <SelectField
          id="grant-plan"
          label="Plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          options={plans.map((p) => ({ value: p.id, label: `${p.name} (${p.status})` }))}
        />
        <TextField
          id="grant-days"
          label="For how many days"
          type="number"
          min={1}
          placeholder="No end"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          hint="Empty: until an admin ends it."
        />
        <TextField
          id="grant-note"
          label="Internal note (optional)"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}
