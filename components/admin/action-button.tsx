"use client";

import { useState, type ReactNode } from "react";

import type { ActionResult } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { TextField } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";

/**
 * An admin action behind a confirmation dialog, with an optional text input
 * (reason, days, amount, password, typed name).
 */
export function ActionButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  variant = "outline",
  icon,
  input,
}: {
  label: string;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: (value: string) => Promise<ActionResult<unknown>>;
  destructive?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive";
  icon?: ReactNode;
  input?: {
    label: string;
    type?: "text" | "number" | "password";
    placeholder?: string;
    hint?: string;
    required?: boolean;
  };
}) {
  const [value, setValue] = useState("");
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant={variant}>
          {icon}
          {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={confirmLabel ?? label}
      destructive={destructive}
      confirmDisabled={!!input?.required && value.trim() === ""}
      onConfirm={() => onConfirm(value)}
      onSuccess={() => setValue("")}
    >
      {input ? (
        <TextField
          id={`action-${label.replace(/\W+/g, "-").toLowerCase()}`}
          label={input.label}
          type={input.type ?? "text"}
          placeholder={input.placeholder}
          hint={input.hint}
          value={value}
          autoComplete={input.type === "password" ? "new-password" : "off"}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : null}
    </ConfirmDialog>
  );
}
