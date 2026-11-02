import type { ProductStatus } from "@/lib/domain/contracts";
import type { ConnectionHealth } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import { PRODUCT_STATUS_META, type StatusTone } from "./product-status";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-border-strong text-muted-foreground",
  running: "border-border-strong text-foreground",
  action: "border-warning/40 bg-warning/10 text-warning",
  success: "border-brand-border bg-brand-soft text-brand-text",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

const DOT_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  running: "bg-foreground motion-safe:animate-pulse",
  action: "bg-warning",
  success: "bg-brand",
  danger: "bg-danger",
};

export function Pill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} />
      {children}
    </span>
  );
}

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const meta = PRODUCT_STATUS_META[status];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

const HEALTH_TONE: Record<ConnectionHealth, StatusTone> = {
  green: "success",
  orange: "action",
  red: "danger",
};

const HEALTH_LABEL: Record<ConnectionHealth, string> = {
  green: "Healthy",
  orange: "Needs attention",
  red: "Not working",
};

/** Green / orange / red connection status, with the reason as visible text. */
export function HealthBadge({ health }: { health: ConnectionHealth }) {
  return <Pill tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Pill>;
}
