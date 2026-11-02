"use client";

import { Film, Link2 } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { demoVideos, type CheckState, type DemoVideo } from "./data";
import { MockupFrame } from "./mockup-frame";
import { CheckIcon, PanelLabel, VideoPoster } from "./primitives";
import { StatusBadge, type StatusTone } from "./status";
import { useEntrance } from "./use-mockup-motion";

const checkLabels: { key: keyof DemoVideo["checks"]; label: string }[] = [
  { key: "format", label: "Format 9:16" },
  { key: "length", label: "Length" },
  { key: "claims", label: "Claims" },
];

function overall(v: DemoVideo): { tone: StatusTone; label: string } {
  const states: CheckState[] = Object.values(v.checks);
  if (states.includes("fail")) return { tone: "danger", label: "Error" };
  if (states.includes("warn")) return { tone: "warning", label: "Needs review" };
  return { tone: "success", label: "Approved" };
}

export type VideoComplianceMockupProps = { className?: string };

/** Video library with TikTok ad-rule checks per video (format, length, claims). */
export function VideoComplianceMockup({ className }: VideoComplianceMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { shown, animate } = useEntrance(ref);
  const run = shown && animate;

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title="Videos"
        label="Video library: three candidate videos checked against TikTok ad rules. One passes all checks, one has a claim that needs review, one is longer than recommended. Videos are linked, not stored."
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <PanelLabel className="flex items-center gap-1.5">
              <Film className="size-3" /> Compliance check
            </PanelLabel>
            <span className="font-mono text-[10px] text-muted-foreground">
              {demoVideos.length} candidates
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {demoVideos.map((v, vi) => {
              const status = overall(v);
              return (
                <div
                  key={v.id}
                  className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-2/50"
                >
                  <VideoPoster
                    photo={v.poster}
                    duration={v.duration}
                    sizes="(min-width: 1024px) 144px, (min-width: 640px) 208px, 96px"
                    className="aspect-[9/13] w-full rounded-none"
                  >
                    <span className="absolute top-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1 text-[9px] text-white">
                      {v.handle}
                    </span>
                  </VideoPoster>
                  <ul className="space-y-1 p-1.5 sm:p-2">
                    {checkLabels.map((c, ci) => (
                      <motion.li
                        key={c.key}
                        initial={false}
                        animate={{ opacity: shown ? 1 : 0 }}
                        transition={
                          run
                            ? { duration: 0.25, delay: 0.25 + vi * 0.15 + ci * 0.12 }
                            : { duration: 0 }
                        }
                        className="flex items-center gap-1 text-[9px] sm:text-[11px]"
                      >
                        <CheckIcon
                          state={v.checks[c.key]}
                          className="size-3 shrink-0 sm:size-3.5"
                        />
                        <span className="truncate">{c.label}</span>
                      </motion.li>
                    ))}
                  </ul>
                  <div className="border-t border-border px-1.5 py-1.5 sm:px-2">
                    <StatusBadge
                      tone={status.tone}
                      className="max-w-full px-1.5 text-[9px] sm:text-[10px]"
                    >
                      <span className="truncate">{status.label}</span>
                    </StatusBadge>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5 rounded-lg border border-warning/25 bg-warning/5 p-2 text-[11px]">
            <p className="flex items-center gap-1.5 text-warning">
              <CheckIcon state="warn" className="size-3.5 shrink-0" />
              <span className="font-medium">Claims</span>
            </p>
            <p className="text-muted-foreground">{demoVideos[1].note}</p>
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Link2 className="size-3.5 shrink-0" />
            Candidates are linked by URL, never stored.
          </p>
        </div>
      </MockupFrame>
    </div>
  );
}
