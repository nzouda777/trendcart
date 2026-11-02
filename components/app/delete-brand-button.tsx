"use client";

import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ActionResult } from "./action-result";
import { ConfirmDialog } from "./confirm-dialog";

export function DeleteBrandButton({
  brandName,
  onDelete,
}: {
  brandName: string;
  onDelete: () => Promise<ActionResult>;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" size="lg">
          <Trash2Icon aria-hidden="true" />
          Delete brand
        </Button>
      }
      title={`Delete ${brandName}?`}
      description="Its store and TikTok connections, proxy and products are removed from Trendcart. This cannot be undone."
      confirmLabel="Delete brand"
      pendingLabel="Deleting…"
      destructive
      onConfirm={onDelete}
    />
  );
}
