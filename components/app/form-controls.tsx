import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
 * Labelled form controls. Hints and errors are wired with aria-describedby;
 * errors also set aria-invalid. Server-safe (no hooks).
 */

function describedBy(id: string, hint?: ReactNode, error?: string) {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined
  );
}

function FieldMeta({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function TextField({
  id,
  label,
  hint,
  error,
  className,
  suffix,
  ...input
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Short unit shown after the input ("%", "USD"). */
  suffix?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-describedby={describedBy(id, hint, error)}
          aria-invalid={error ? true : undefined}
          className="h-10"
          {...input}
        />
        {suffix ? (
          <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </div>
      <FieldMeta id={id} hint={hint} error={error} />
    </div>
  );
}

export const selectClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30";

export type SelectOption = { value: string; label: string };

export function SelectField({
  id,
  label,
  hint,
  error,
  options,
  className,
  ...select
}: ComponentProps<"select"> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  options: SelectOption[];
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className={selectClass}
        {...select}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldMeta id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  error,
  className,
  ...textarea
}: ComponentProps<"textarea"> & { id: string; label: string; hint?: ReactNode; error?: string }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className={cn(selectClass, "h-auto min-h-20 py-2")}
        {...textarea}
      />
      <FieldMeta id={id} hint={hint} error={error} />
    </div>
  );
}

/** Announced form-level error. Renders nothing when empty. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}

/** Announced inline success message. */
export function FormSuccess({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="status" className="text-sm text-brand-text">
      {message}
    </p>
  );
}
