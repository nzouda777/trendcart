import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Bordered panel with an optional heading row. One `id` per section for aria-labelledby. */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
  as: Heading = "h2",
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={cn("rounded-2xl border border-border bg-surface p-4 sm:p-6", className)}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading id={`${id}-heading`} className="text-base font-semibold">
            {title}
          </Heading>
          {description ? (
            <div className="mt-1 text-sm text-pretty text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

type NoticeTone = "success" | "warning" | "danger" | "info";

const NOTICE_CLASS: Record<NoticeTone, string> = {
  success: "border-brand-border bg-brand-soft",
  warning: "border-warning/40 bg-warning/10",
  danger: "border-danger/40 bg-danger/10",
  info: "border-border-strong bg-surface-2",
};

/** Inline banner. Errors are announced assertively, the rest politely. */
export function Notice({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: NoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        NOTICE_CLASS[tone],
        className,
      )}
    >
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        {children ? (
          <div className="mt-0.5 text-pretty text-muted-foreground">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Key/value list (dl) for detail panels. */
export function DetailList({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-lg bg-surface-2 motion-safe:animate-pulse", className)}
    />
  );
}

/** Generic page skeleton: header + N panels. */
export function PageSkeleton({ panels = 2 }: { panels?: number }) {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {Array.from({ length: panels }, (_, i) => (
        <Skeleton key={i} className="h-48 rounded-2xl" />
      ))}
    </div>
  );
}

/** List skeleton: N rows. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
