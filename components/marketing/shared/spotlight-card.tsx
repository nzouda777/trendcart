import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SpotlightCardProps = ComponentProps<"div">;

/**
 * Surface card that picks up a subtle green highlight on hover: the border
 * turns `brand-border` and a faint `brand-soft` wash fades in. Pure CSS (no
 * pointer tracking); the fade is instant under reduced motion.
 * Name kept from the original spotlight version so sections don't change.
 */
export function SpotlightCard({ className, children, ...props }: SpotlightCardProps) {
  return (
    <div
      className={cn(
        "group/spotlight relative isolate overflow-hidden rounded-2xl border bg-surface p-6 transition-colors duration-300 hover:border-brand-border motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-brand-soft opacity-0 transition-opacity duration-300 group-hover/spotlight:opacity-60 motion-reduce:transition-none"
      />
      {children}
    </div>
  );
}
