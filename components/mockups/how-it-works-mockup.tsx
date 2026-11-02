"use client";

import { ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { MockupFrame } from "./mockup-frame";
import { useMockupMotion } from "./use-mockup-motion";
import {
  CampaignView,
  IdentifyView,
  ImportView,
  PageView,
  SourceView,
  StaticMotionContext,
  VideosView,
} from "./views";

export type HowItWorksStep = 0 | 1 | 2 | 3 | 4 | 5;

const views = [
  { title: "Import", label: "Importing a TikTok link; the video is linked, not stored." },
  {
    title: "Identify",
    label: "The AI identifies the product, its selling points and a confidence score.",
  },
  { title: "Source", label: "Supplier matches with cost, shipping and the computed margin." },
  {
    title: "Build the page",
    label: "A Shopify product page drafted from the store template, with variants and prices.",
  },
  {
    title: "Prepare videos",
    label: "Candidate videos checked against TikTok ad rules: format, length and claims.",
  },
  {
    title: "Create the campaign",
    label: "Campaign, ad groups and ads created in TikTok Ads, all paused.",
  },
] as const;

/**
 * Human approval checkpoints by step (4 in total). `null` = no checkpoint.
 * Exported so the section can mark the same steps.
 */
export const howItWorksCheckpoints: Record<HowItWorksStep, string | null> = {
  0: null,
  1: "You confirm the product",
  2: "You choose supplier & price",
  3: null,
  4: "You approve page & videos",
  5: "You approve the launch",
};

function StepView({ step }: { step: HowItWorksStep }) {
  switch (step) {
    case 0:
      return <ImportView />;
    case 1:
      return <IdentifyView />;
    case 2:
      return <SourceView />;
    case 3:
      return <PageView />;
    case 4:
      return <VideosView />;
    default:
      return <CampaignView compact />;
  }
}

function checkpointNumber(step: HowItWorksStep) {
  let n = 0;
  for (let i = 0; i <= step; i++) if (howItWorksCheckpoints[i as HowItWorksStep]) n++;
  return n;
}

export type HowItWorksMockupProps = { step: HowItWorksStep; className?: string };

/** Sticky "How it works" mockup. Crossfades between the 6 steps. */
export function HowItWorksMockup({ step, className }: HowItWorksMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMockupMotion(ref);
  const view = views[step];
  const checkpoint = howItWorksCheckpoints[step];

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title={view.title}
        label={`Step ${step + 1}, ${view.title}: ${view.label}${checkpoint ? ` Approval checkpoint: ${checkpoint.toLowerCase()}.` : ""}`}
        contentClassName="p-0 sm:p-0"
      >
        <div className="grid h-[318px] overflow-hidden p-3 sm:h-[330px] sm:p-4">
          <StaticMotionContext.Provider value={reduced}>
            <AnimatePresence initial={false}>
              <motion.div
                key={step}
                className="min-w-0 [grid-area:1/1]"
                initial={reduced ? false : { opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={
                  reduced
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, scale: 0.985 }
                }
                transition={{ duration: reduced ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <StepView step={step} />
              </motion.div>
            </AnimatePresence>
          </StaticMotionContext.Provider>
        </div>
        <div className="flex h-11 items-center justify-between gap-2 border-t border-border bg-surface-2/40 px-3 sm:px-4">
          <span className="shrink-0 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
            Step {step + 1}/{views.length}
          </span>
          {checkpoint ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand-text sm:text-[11px]">
              <ShieldCheck className="size-3.5 shrink-0" />
              <span className="truncate">
                Checkpoint {checkpointNumber(step)}/4 · {checkpoint}
              </span>
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground sm:text-[11px]">Automatic</span>
          )}
        </div>
      </MockupFrame>
    </div>
  );
}
