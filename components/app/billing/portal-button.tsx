"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useState, useTransition } from "react";

import type { ActionResult } from "@/components/app/action-result";
import { Button } from "@/components/ui/button";

/** Opens the Stripe customer portal (card, invoices, plan, cancellation). */
export function PortalButton({ onOpen }: { onOpen: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid justify-items-end gap-1">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await onOpen();
            if (!result.ok) setError(result.error);
          })
        }
      >
        <ExternalLinkIcon aria-hidden="true" />
        {pending ? "Opening…" : "Manage billing"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
