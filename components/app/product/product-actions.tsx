"use client";

import { Trash2Icon, Undo2Icon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";

import type { ActionResult } from "../action-result";
import { ConfirmDialog } from "../confirm-dialog";
import { TextAreaField } from "../form-controls";

/** Back to the previous gate (no AI call); what is reset depends on the target. */
export function StepBackButton({
  label,
  description,
  onStepBack,
}: {
  label: string;
  description: string;
  onStepBack: (input: { note?: string }) => Promise<ActionResult>;
}) {
  const [note, setNote] = useState("");
  const noteId = useId();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="lg">
          <Undo2Icon aria-hidden="true" />
          {label}
        </Button>
      }
      title={`${label}?`}
      description={description}
      confirmLabel={label}
      pendingLabel="Going back…"
      onConfirm={() => onStepBack({ note })}
    >
      <TextAreaField
        id={noteId}
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
      />
    </ConfirmDialog>
  );
}

export function DeleteProductButton({
  productName,
  hasShopifyDraft,
  onDelete,
}: {
  productName: string;
  hasShopifyDraft: boolean;
  onDelete: () => Promise<ActionResult>;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" size="lg">
          <Trash2Icon aria-hidden="true" />
          Delete
        </Button>
      }
      title={`Delete ${productName}?`}
      description={
        hasShopifyDraft
          ? "The product, its listings, video links and history are removed from Trendcart. Its draft on Shopify stays on your store: delete it there if you no longer need it. This cannot be undone."
          : "The product, its listings, video links and history are removed from Trendcart. This cannot be undone."
      }
      confirmLabel="Delete product"
      pendingLabel="Deleting…"
      destructive
      onConfirm={onDelete}
    />
  );
}
