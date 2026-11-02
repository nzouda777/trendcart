"use client";

import { CheckCircle2Icon, RotateCwIcon, XCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import type { ActionResult } from "../action-result";
import { ConfirmDialog } from "../confirm-dialog";
import { FormError, TextAreaField, TextField } from "../form-controls";

/** GATE 1 approval with an optional name correction and note. */
export function ConfirmProductButton({
  suggestedName,
  onConfirm,
}: {
  suggestedName: string | null;
  onConfirm: (input: { name?: string; note?: string }) => Promise<ActionResult>;
}) {
  const [name, setName] = useState(suggestedName ?? "");
  const [note, setNote] = useState("");

  return (
    <ConfirmDialog
      trigger={
        <Button size="xl">
          <CheckCircle2Icon aria-hidden="true" />
          Confirm product
        </Button>
      }
      title="Confirm this product?"
      description="Trendcart then searches suppliers and prices for it. Your approval is recorded with your name."
      confirmLabel="Confirm and find suppliers"
      pendingLabel="Confirming…"
      onConfirm={() =>
        onConfirm({
          name: name.trim() && name.trim() !== suggestedName ? name.trim() : undefined,
          note: note.trim() || undefined,
        })
      }
    >
      <div className="grid gap-3">
        <TextField
          id="confirm-name"
          label="Product name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={255}
          hint="Correct the AI's name if needed. It is used for supplier search."
        />
        <TextAreaField
          id="confirm-note"
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

/** GATE 1 rejection with an optional note; the product is re-analyzed. */
export function RejectProductButton({
  onReject,
}: {
  onReject: (input: { note?: string }) => Promise<ActionResult>;
}) {
  const [note, setNote] = useState("");

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="xl">
          <XCircleIcon aria-hidden="true" />
          Reject
        </Button>
      }
      title="Reject this identification?"
      description="Trendcart analyzes the source again, using your note as a hint. This can take up to a minute."
      confirmLabel="Reject and re-analyze"
      pendingLabel="Re-analyzing…"
      destructive
      onConfirm={() => onReject({ note: note.trim() || undefined })}
      onSuccess={() => setNote("")}
    >
      <TextAreaField
        id="reject-note"
        label="What's wrong with this identification? (optional)"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        maxLength={2000}
        rows={3}
      />
    </ConfirmDialog>
  );
}

export function RetryButton({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid justify-items-start gap-2">
      <Button
        variant="outline"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await onRetry();
            if (!result.ok) setError(result.error);
          });
        }}
      >
        <RotateCwIcon
          aria-hidden="true"
          className={pending ? "motion-safe:animate-spin" : undefined}
        />
        {pending ? "Retrying…" : label}
      </Button>
      <FormError message={error} />
    </div>
  );
}
