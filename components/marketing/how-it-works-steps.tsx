"use client";

import { useEffect, useRef, useState } from "react";

import { HowItWorksMockup, type HowItWorksStep } from "@/components/mockups";
import type { HowItWorksContent } from "@/content/types";
import { cn } from "@/lib/utils";

import { HowItWorksApprovalBadge } from "./how-it-works-approval-badge";

/** Tailwind `lg` breakpoint: sticky layout from here up. */
const DESKTOP_QUERY = "(min-width: 64rem)";

type HowItWorksStepsProps = {
  steps: HowItWorksContent["steps"];
  approvalBadgeLabel: string;
};

/**
 * Desktop (lg+): step list on the left, sticky `HowItWorksMockup` on the right.
 * The active step is the one crossing a thin band at the viewport center
 * (IntersectionObserver, no scroll listeners).
 * Mobile/tablet: vertical stepper with the mockup under each step, no sticky.
 * Reduced motion: the mockup swaps instantly (handled by `HowItWorksMockup`),
 * highlight transitions are disabled.
 */
export function HowItWorksSteps({ steps, approvalBadgeLabel }: HowItWorksStepsProps) {
  const [active, setActive] = useState<HowItWorksStep>(0);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    let observer: IntersectionObserver | null = null;

    const connect = () => {
      observer?.disconnect();
      observer = null;
      if (!mq.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const index = Number((entry.target as HTMLElement).dataset.step);
            if (index >= 0 && index <= 5) setActive(index as HowItWorksStep);
          }
        },
        { rootMargin: "-48% 0px -48% 0px" },
      );
      for (const el of itemRefs.current) if (el) observer.observe(el);
    };

    connect();
    mq.addEventListener("change", connect);
    return () => {
      mq.removeEventListener("change", connect);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="mt-12 lg:mt-8 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <ol className="relative">
        {/* Rail behind the step markers. */}
        <span
          aria-hidden="true"
          className="absolute top-4 bottom-4 left-4 w-px -translate-x-1/2 bg-border"
        />
        {steps.map((step, i) => {
          const isActive = i === active;
          return (
            <li
              key={step.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              data-step={i}
              data-active={isActive || undefined}
              aria-current={isActive ? "step" : undefined}
              className="group/step relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 pb-12 last:pb-0 sm:gap-x-6 lg:min-h-[58svh] lg:content-center lg:pb-0"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 grid size-8 place-items-center rounded-full border font-mono text-xs font-semibold transition-colors duration-300 motion-reduce:transition-none",
                  "border-brand-border bg-surface text-foreground",
                  "lg:border-border lg:text-muted-foreground",
                  // Tint painted as an inset shadow over the opaque surface, so the rail stays hidden.
                  isActive &&
                    "lg:border-brand-border lg:text-brand-text lg:shadow-[inset_0_0_0_2rem_var(--brand-soft)]",
                )}
              >
                {i + 1}
              </span>

              <div className="min-w-0 pt-0.5">
                <h3
                  className={cn(
                    "text-xl font-semibold tracking-tight transition-colors duration-300 motion-reduce:transition-none sm:text-2xl",
                    !isActive && "lg:text-muted-foreground",
                  )}
                >
                  {step.title}
                </h3>

                {step.approval ? (
                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <HowItWorksApprovalBadge label={approvalBadgeLabel} />
                    <span className="sr-only">:</span>
                    <span className="text-sm font-medium text-foreground/80">{step.approval}</span>
                  </p>
                ) : null}

                <p className="mt-3 max-w-md text-base leading-relaxed text-pretty text-muted-foreground">
                  {step.description}
                </p>

                <div className="mt-6 w-full max-w-xl min-w-0 lg:hidden">
                  <HowItWorksMockup step={i as HowItWorksStep} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="hidden min-w-0 lg:block">
        <div className="sticky top-[max(6rem,calc(50svh_-_13rem))]">
          <HowItWorksMockup step={active} />
        </div>
      </div>
    </div>
  );
}
