import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SectionProps = ComponentProps<"section"> & {
  /** Anchor id (e.g. "pricing"). Anchor offset for the sticky navbar is global. */
  id?: string;
  /** Classes for the inner max-width container. */
  containerClassName?: string;
  /** Drop the default vertical padding (e.g. for full-bleed bands). */
  flush?: boolean;
};

/** Landing section: `<section>` + centered container (max-w 1200px) + vertical rhythm. */
export function Section({
  id,
  className,
  containerClassName,
  flush = false,
  children,
  ...props
}: SectionProps) {
  return (
    <section id={id} className={cn("relative", !flush && "py-20 md:py-28", className)} {...props}>
      <div className={cn("mx-auto w-full max-w-content px-5 sm:px-6 lg:px-8", containerClassName)}>
        {children}
      </div>
    </section>
  );
}
