import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Human approval checkpoint badge. Same icon as the `HowItWorksMockup` footer
 * badge, so the step list, legend and mockup read as one system.
 * Green dose: tint + border, green icon, label in `text-foreground`.
 */
export function HowItWorksApprovalBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-brand-text" />
      {label}
    </span>
  );
}
