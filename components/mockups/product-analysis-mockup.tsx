"use client";

import { Check, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { demoProduct, demoTiktokUrl } from "./data";
import { MockupFrame } from "./mockup-frame";
import { FakeButton, PanelLabel, ProductPhoto } from "./primitives";
import { StatusBadge } from "./status";
import { useEntrance } from "./use-mockup-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

export type ProductAnalysisMockupProps = { className?: string };

/** AI analysis card: detected product, selling points, confidence. */
export function ProductAnalysisMockup({ className }: ProductAnalysisMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { shown, animate } = useEntrance(ref);
  const run = shown && animate;

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title="Identify"
        label={`Product analysis: ${demoProduct.name} detected from a TikTok video with ${demoProduct.confidence}% confidence, with its key selling points, waiting for you to confirm.`}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <PanelLabel className="flex items-center gap-1.5">
              <Sparkles className="size-3 text-brand-text" /> AI analysis
            </PanelLabel>
            <StatusBadge tone="warning">Needs review</StatusBadge>
          </div>

          <div className="flex gap-3">
            <ProductPhoto alt="" sizes="96px" className="size-20 shrink-0 sm:size-24" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold sm:text-base">{demoProduct.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{demoProduct.category}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                src: {demoTiktokUrl}
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Confidence</span>
              <span className="font-mono font-medium">{demoProduct.confidence}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={false}
                animate={{ width: shown ? `${demoProduct.confidence}%` : "0%" }}
                transition={run ? { duration: 1, delay: 0.2, ease: EASE } : { duration: 0 }}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-2/50 p-2.5">
              <PanelLabel>Selling points</PanelLabel>
              <ul className="mt-2 space-y-1.5">
                {demoProduct.sellingPoints.map((point, i) => (
                  <motion.li
                    key={point}
                    initial={false}
                    animate={{ opacity: shown ? 1 : 0, x: shown ? 0 : -6 }}
                    transition={
                      run ? { duration: 0.35, delay: 0.35 + i * 0.12, ease: EASE } : { duration: 0 }
                    }
                    className="flex items-start gap-2 text-[11px] sm:text-xs"
                  >
                    <Check className="mt-px size-3.5 shrink-0 text-success" />
                    <span className="min-w-0">{point}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-surface-2/50 p-2.5">
              <PanelLabel>Detected attributes</PanelLabel>
              <dl className="mt-2 space-y-1.5 text-[11px] sm:text-xs">
                {demoProduct.attributes.map((a) => (
                  <div key={a.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{a.label}</dt>
                    <dd className="min-w-0 truncate text-right">{a.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <FakeButton>Edit</FakeButton>
            <FakeButton variant="primary">
              <Check className="size-3" /> Confirm product
            </FakeButton>
          </div>
        </div>
      </MockupFrame>
    </div>
  );
}
