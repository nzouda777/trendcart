"use client";

import { useId, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Wraps a disabled control so the reason it is disabled (role, state) is
 * reachable: a focusable wrapper shows it in a tooltip on hover and focus,
 * and screen readers get it through aria-describedby (the text is also in
 * the DOM, visually hidden). Render the control itself with `disabled`.
 */
export function DisabledReason({ reason, children }: { reason: string; children: ReactNode }) {
  const id = useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-describedby={id}
          className="inline-flex w-fit rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>*]:pointer-events-none"
        >
          {children}
          <span id={id} className="sr-only">
            {reason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
