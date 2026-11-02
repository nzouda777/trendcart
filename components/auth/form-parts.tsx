import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Labelled input with optional hint; the hint is wired via aria-describedby. */
export function Field({
  id,
  label,
  hint,
  className,
  ...input
}: ComponentProps<typeof Input> & { id: string; label: string; hint?: ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} aria-describedby={hintId} className="h-10" {...input} />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Announced error message for a form. Renders nothing when empty. */
export function FormError({ message }: { message: string | null }) {
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

/** Announced success / info message. */
export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-brand-border bg-brand-soft px-3 py-2 text-sm text-foreground"
    >
      {children}
    </div>
  );
}
