"use client";

import { UnplugIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ActionResult } from "../action-result";
import { ConfirmDialog } from "../confirm-dialog";

export function DisconnectButton({
  label,
  consequence,
  onDisconnect,
}: {
  /** What is disconnected ("acme.myshopify.com"). */
  label: string;
  consequence: string;
  onDisconnect: () => Promise<ActionResult>;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-danger hover:text-danger">
          <UnplugIcon aria-hidden="true" />
          Disconnect
          <span className="sr-only"> {label}</span>
        </Button>
      }
      title={`Disconnect ${label}?`}
      description={
        <>
          <p>Trendcart deletes the stored access token right away. {consequence}</p>
          <p className="mt-2">You can reconnect the same account later.</p>
        </>
      }
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting…"
      destructive
      onConfirm={onDisconnect}
    />
  );
}
