import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Primary action(s), e.g. a <Button asChild><Link/></Button>. */
  action?: ReactNode;
  className?: string;
  /** Heading level for the title (default h2). */
  as?: "h2" | "h3";
};

/** Centered placeholder for lists and pages with nothing to show yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  as: Heading = "h2",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 flex size-11 items-center justify-center rounded-xl border border-brand-border bg-brand-soft text-brand-text">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      ) : null}
      <Heading className="text-base font-semibold">{title}</Heading>
      {description ? (
        <div className="mt-1.5 max-w-md text-sm text-pretty text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
