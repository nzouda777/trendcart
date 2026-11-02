"use client";

import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { demoBrands } from "./data";
import { MockupFrame } from "./mockup-frame";
import { PanelLabel } from "./primitives";
import { useCycle, useMockupMotion } from "./use-mockup-motion";

export type BrandSwitcherMockupProps = { className?: string };

/** Workspace brand switcher: each brand groups its own stores and accounts. */
export function BrandSwitcherMockup({ className }: BrandSwitcherMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduced } = useMockupMotion(ref);
  const [cycled] = useCycle(demoBrands.length, 2600, active);
  const current = reduced ? 0 : cycled;
  const brand = demoBrands[current];

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title="Brands"
        label={`Brand switcher listing ${demoBrands.length} sample brands in one workspace, each with its own Shopify stores and TikTok accounts.`}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-2.5 py-2">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold transition-colors",
                brand.color,
              )}
            >
              {brand.initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{brand.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </div>

          <div className="rounded-lg border border-border bg-surface p-1.5 shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-1.5 pb-1.5 text-[11px] text-muted-foreground">
              <Search className="size-3.5" /> Find a brand
            </div>
            <PanelLabel className="px-1.5 pt-2 pb-1">Brands</PanelLabel>
            <ul className="space-y-0.5">
              {demoBrands.map((b, i) => (
                <li
                  key={b.id}
                  className="relative flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] sm:text-xs"
                >
                  {i === current ? (
                    <motion.span
                      layoutId={active ? "brand-highlight" : undefined}
                      className="absolute inset-0 rounded-md border border-brand-border bg-brand-soft"
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative grid size-5 shrink-0 place-items-center rounded text-[9px] font-semibold",
                      b.color,
                    )}
                  >
                    {b.initials}
                  </span>
                  <span className="relative min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="relative font-mono text-[10px] text-muted-foreground">
                    {b.stores} {b.stores === 1 ? "store" : "stores"}
                  </span>
                  <Check
                    className={cn(
                      "relative size-3.5 shrink-0 text-brand-text",
                      i === current ? "opacity-100" : "opacity-0",
                    )}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center gap-2 border-t border-border px-1.5 pt-1.5 text-[11px] text-muted-foreground">
              <Plus className="size-3.5" /> New brand
            </div>
          </div>
        </div>
      </MockupFrame>
    </div>
  );
}
