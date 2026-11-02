"use client";

import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FocusEvent } from "react";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

import { MockupFrame } from "./mockup-frame";
import { StatusBadge } from "./status";
import { useMockupMotion } from "./use-mockup-motion";
import {
  CampaignView,
  IdentifyView,
  ImportView,
  PageView,
  SourceView,
  StaticMotionContext,
} from "./views";

const STEP_MS = 3600;

const steps = [
  { label: "Link", title: "Import" },
  { label: "Product", title: "Identify" },
  { label: "Supplier", title: "Source" },
  { label: "Page", title: "Shopify draft" },
  { label: "Campaign", title: "Campaign" },
] as const;

const LAST = steps.length - 1;

function StepView({ index }: { index: number }) {
  switch (index) {
    case 0:
      return <ImportView typing preload />;
    case 1:
      return <IdentifyView />;
    case 2:
      return <SourceView />;
    case 3:
      return <PageView />;
    default:
      return <CampaignView />;
  }
}

export type PipelineMockupProps = {
  className?: string;
  /** Accessible description + pause/play labels (landing passes `hero.pipeline.*`). */
  ariaLabel?: string;
  pauseLabel?: string;
  playLabel?: string;
};

/**
 * Hero mockup. Auto-cycles: TikTok link → product → supplier & margin →
 * Shopify draft → paused campaign. Pauses on hover, focus-within, off-screen,
 * or with the pause button. Static final state under reduced motion.
 */
export function PipelineMockup({
  className,
  ariaLabel = `${siteConfig.name} pipeline demo: a TikTok link is imported, the product is identified, a supplier is matched with its margin, a Shopify draft page is built, and the campaign is created paused, waiting for approval.`,
  pauseLabel = "Pause pipeline animation",
  playLabel = "Play pipeline animation",
}: PipelineMockupProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { reduced, active } = useMockupMotion(rootRef);
  const [step, setStep] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  const running = active && !hovered && !focused && !userPaused;
  const current = reduced ? LAST : step;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % steps.length), STEP_MS);
    return () => window.clearTimeout(id);
  }, [running, step]);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }

  const footer = (
    <div className="flex items-center gap-3 border-t border-border bg-surface-2/40 px-3 py-2.5">
      <ol aria-hidden="true" className="flex min-w-0 flex-1 items-start gap-1.5">
        {steps.map((s, i) => (
          <li key={s.label} className="min-w-0 flex-1">
            <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
              {i < current ? (
                <div className="h-full w-full rounded-full bg-brand/60" />
              ) : i === current ? (
                // scaleX (compositor-only), not width: avoids a layout per frame.
                <motion.div
                  key={`${current}-${running ? "run" : "hold"}`}
                  className="h-full w-full origin-left rounded-full bg-brand"
                  initial={running ? { scaleX: 0 } : false}
                  animate={{ scaleX: 1 }}
                  transition={
                    running ? { duration: STEP_MS / 1000, ease: "linear" } : { duration: 0 }
                  }
                />
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1.5 hidden truncate font-mono text-[10px] sm:block",
                i === current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {i + 1}. {s.label}
            </p>
          </li>
        ))}
      </ol>
      {reduced ? null : (
        <button
          type="button"
          onClick={() => setUserPaused((p) => !p)}
          aria-label={userPaused ? playLabel : pauseLabel}
          title={userPaused ? playLabel : pauseLabel}
          aria-pressed={userPaused}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {userPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn("w-full min-w-0", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    >
      <MockupFrame
        title={steps[current].title}
        label={ariaLabel}
        actions={
          <span className="hidden sm:inline-flex">
            <StatusBadge tone={current === LAST ? "paused" : "neutral"}>
              {current === LAST ? "Awaiting approval" : `Step ${current + 1} of ${steps.length}`}
            </StatusBadge>
          </span>
        }
        contentClassName="grid h-[300px] overflow-hidden sm:h-[316px]"
        footer={footer}
      >
        <StaticMotionContext.Provider value={reduced}>
          <AnimatePresence initial={false}>
            <motion.div
              key={current}
              className="min-w-0 [grid-area:1/1]"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { opacity: 0, y: -8, transition: { duration: 0.2 } }
              }
              transition={{
                duration: reduced ? 0 : 0.35,
                delay: reduced ? 0 : 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <StepView index={current} />
            </motion.div>
          </AnimatePresence>
        </StaticMotionContext.Provider>
      </MockupFrame>
    </div>
  );
}
