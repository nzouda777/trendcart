"use client";

import { AlertDialog } from "radix-ui";
import { useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ServiceFailure } from "@/lib/services/errors";

import type { ActionResult } from "./action-result";
import { FormError } from "./form-controls";

/**
 * Confirmation dialog for sensitive actions (approve, disconnect, remove).
 * Radix AlertDialog: focus trap, Escape to cancel, focus returns to the trigger.
 * `onConfirm` returns an ActionResult; the dialog stays open and shows the
 * error on failure, closes on success.
 *
 * `errorAction` lets a failure offer something other than a retry (e.g.
 * "Reload" when the data changed): when it returns a node, that node
 * replaces the confirm button until the dialog is closed.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  destructive = false,
  onConfirm,
  onSuccess,
  errorAction,
  confirmDisabled = false,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<ActionResult<unknown>>;
  onSuccess?: () => void;
  errorAction?: (failure: ServiceFailure, close: () => void) => ReactNode;
  /** Keeps the confirm button disabled (e.g. until a required choice is made). */
  confirmDisabled?: boolean;
  /** Extra content (inputs) between the description and the buttons. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ServiceFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setFailure(null);
  }

  function confirm() {
    setFailure(null);
    startTransition(async () => {
      const result = await onConfirm();
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setOpen(false);
      onSuccess?.();
    });
  }

  const replacement = failure && errorAction ? errorAction(failure, close) : null;

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setFailure(null);
      }}
    >
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
          <div className="grid gap-1.5">
            <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="text-sm text-pretty text-muted-foreground">{description}</div>
            </AlertDialog.Description>
          </div>
          {children}
          <FormError message={failure?.error ?? null} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" size="lg" disabled={pending}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            {replacement ?? (
              <Button
                variant={destructive ? "destructive" : "default"}
                size="lg"
                onClick={confirm}
                disabled={pending || confirmDisabled}
                aria-busy={pending}
              >
                {pending ? pendingLabel : confirmLabel}
              </Button>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
