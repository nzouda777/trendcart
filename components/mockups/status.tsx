import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "paused" | "neutral";

const badgeTone: Record<StatusTone, string> = {
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
  // Neutral grey: "Paused" is a resting state, not an alert or an accent.
  paused: "border-border-strong bg-foreground/[0.06] text-foreground/80",
  neutral: "border-border bg-surface-2 text-muted-foreground",
};

const dotTone: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  paused: "bg-muted-foreground",
  neutral: "bg-muted-foreground",
};

const ringTone: Record<StatusTone, string> = {
  success: "ring-success/20",
  warning: "ring-warning/20",
  danger: "ring-danger/20",
  paused: "ring-muted-foreground/20",
  neutral: "ring-muted-foreground/20",
};

export type StatusDotProps = {
  tone: StatusTone;
  /** Soft halo ring (static, no animation). */
  ring?: boolean;
  className?: string;
};

/** Small colored status dot (green = connected, orange = attention, red = error). */
export function StatusDot({ tone, ring = false, className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        dotTone[tone],
        ring && "ring-[3px]",
        ring && ringTone[tone],
        className,
      )}
    />
  );
}

export type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
  /** Show a leading dot. Defaults to true. */
  dot?: boolean;
  className?: string;
};

/**
 * Status pill used across mockups:
 * success = Approved / Connected, warning = Needs review, danger = Error,
 * paused = Paused (neutral grey), neutral = Draft / misc.
 */
export function StatusBadge({ tone, children, dot = true, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] leading-4 font-medium whitespace-nowrap sm:text-[11px]",
        badgeTone[tone],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", dotTone[tone])} />
      ) : null}
      {children}
    </span>
  );
}
