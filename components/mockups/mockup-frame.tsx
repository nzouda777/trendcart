import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { LogoIcon } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { DEMO_STORE } from "./data";

export type MockupFrameProps = {
  children: ReactNode;
  className?: string;
  /** Classes for the content area (below the top bar). */
  contentClassName?: string;
  /** Screen name shown in the top bar, e.g. "Import". */
  title?: string;
  /** Extra element on the right side of the top bar. */
  actions?: ReactNode;
  /**
   * Accessible description of the mockup. When set, the window (top bar +
   * content) is exposed as a single `role="img"` with this label.
   */
  label?: string;
  /** Rendered below the window, outside the `role="img"` region (e.g. controls). */
  footer?: ReactNode;
};

/** App-window chrome: Trendcart icon + "Demo Store" switcher in the top bar. */
export function MockupFrame({
  children,
  className,
  contentClassName,
  title,
  actions,
  label,
  footer,
}: MockupFrameProps) {
  return (
    <div
      className={cn(
        "relative w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-[0_24px_80px_-32px_rgba(0,0,0,0.45)] select-none",
        className,
      )}
    >
      <div role={label ? "img" : undefined} aria-label={label}>
        <div
          aria-hidden={label ? true : undefined}
          className="flex h-10 items-center gap-2 border-b border-border bg-surface-2/60 px-3"
        >
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="size-2.5 rounded-full bg-foreground/10" />
            <span className="size-2.5 rounded-full bg-foreground/10" />
            <span className="size-2.5 rounded-full bg-foreground/10" />
          </div>
          <LogoIcon className="size-4 sm:ml-2" />
          <span className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium">
            <span className="truncate">{DEMO_STORE}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </span>
          {title ? (
            <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">
              / {title}
            </span>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
            <span className="grid size-5 place-items-center rounded-full bg-foreground text-[9px] font-semibold text-background">
              AD
            </span>
          </div>
        </div>
        <div
          aria-hidden={label ? true : undefined}
          className={cn("relative p-3 sm:p-4", contentClassName)}
        >
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}
