"use client";

import { CircleCheck, FolderOpen, Megaphone, Rocket } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { demoCampaign } from "./data";
import { MockupFrame } from "./mockup-frame";
import { AdThumb, FakeButton, PanelLabel, TreeRow } from "./primitives";
import { StatusBadge } from "./status";
import { useEntrance } from "./use-mockup-motion";

const adCount = demoCampaign.adGroups.reduce((n, g) => n + g.ads.length, 0);

export type AdsBuilderMockupProps = { className?: string };

/** TikTok Ads tree (campaign → ad groups → ads), all paused, plus pre-launch checklist. */
export function AdsBuilderMockup({ className }: AdsBuilderMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { shown, animate } = useEntrance(ref);
  const run = shown && animate;

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title="TikTok Ads"
        label={`TikTok Ads builder: campaign "${demoCampaign.name}" with ${demoCampaign.adGroups.length} ad groups and ${adCount} ads, all paused. The pre-launch checklist is complete and the campaign waits for "Approve & launch".`}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <PanelLabel>Structure</PanelLabel>
              <StatusBadge tone="paused">All paused</StatusBadge>
            </div>
            <div className="space-y-1 rounded-lg border border-border bg-surface-2/50 p-2 text-[11px] sm:text-xs">
              <TreeRow
                icon={<Megaphone className="size-3.5 shrink-0 text-foreground" />}
                label={demoCampaign.name}
              />
              {demoCampaign.adGroups.map((g) => (
                <div key={g.name} className="ml-2 space-y-1 border-l border-border pl-3">
                  <TreeRow
                    icon={<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />}
                    label={g.name}
                  />
                  {g.ads.map((ad) => (
                    <div key={ad} className="ml-2 border-l border-border pl-3">
                      <TreeRow icon={<AdThumb ad={ad} />} label={ad} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-border px-2 py-1.5">
                <dt className="text-[10px] text-muted-foreground">Objective</dt>
                <dd className="truncate">{demoCampaign.objective}</dd>
              </div>
              <div className="rounded-md border border-border px-2 py-1.5">
                <dt className="text-[10px] text-muted-foreground">Budget</dt>
                <dd className="font-mono">{demoCampaign.budget}</dd>
              </div>
            </dl>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <PanelLabel>Pre-launch checklist</PanelLabel>
            <ul className="space-y-1.5 rounded-lg border border-border bg-surface-2/50 p-2.5">
              {demoCampaign.checklist.map((item, i) => (
                <li key={item.label} className="flex items-center gap-2 text-[11px] sm:text-xs">
                  <motion.span
                    initial={false}
                    animate={{ scale: shown ? 1 : 0.4, opacity: shown ? 1 : 0 }}
                    transition={
                      run
                        ? { type: "spring", stiffness: 420, damping: 22, delay: 0.3 + i * 0.18 }
                        : { duration: 0 }
                    }
                    className="grid shrink-0 place-items-center"
                  >
                    <CircleCheck className="size-3.5 text-success" />
                  </motion.span>
                  <span className="min-w-0 truncate">{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Nothing goes live until you approve.
            </p>
            <FakeButton variant="primary" className="mt-auto w-full py-1.5">
              <Rocket className="size-3.5" /> Approve &amp; launch
            </FakeButton>
          </div>
        </div>
      </MockupFrame>
    </div>
  );
}
