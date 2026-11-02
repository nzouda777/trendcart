import type { ReactNode } from "react";

import { Reveal, Section, SectionHeading } from "@/components/marketing/shared";
import {
  BrandSwitcherMockup,
  ConnectionsMockup,
  ProxySettingMockup,
  StatusDot,
  TeamMockup,
  type StatusTone,
} from "@/components/mockups";
import { landing } from "@/content/landing";
import type { MultiStoreCardId } from "@/content/types";
import { cn } from "@/lib/utils";

const mockups: Record<MultiStoreCardId, ReactNode> = {
  brands: <BrandSwitcherMockup />,
  connections: <ConnectionsMockup />,
  proxy: <ProxySettingMockup />,
  team: <TeamMockup />,
};

/** Bento placement on large screens (12-col grid). Below lg: 1 col, then 2 cols. */
const layout: Record<MultiStoreCardId, string> = {
  brands: "lg:col-span-5",
  connections: "lg:col-span-7",
  proxy: "lg:col-span-7",
  team: "lg:col-span-5",
};

const legendTones = [
  ["connected", "success"],
  ["attention", "warning"],
  ["error", "danger"],
] as const satisfies readonly (readonly [
  keyof typeof landing.multiStore.statusLegend,
  StatusTone,
])[];

function StatusLegend() {
  const { statusLegend } = landing.multiStore;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {legendTones.map(([key, tone]) => (
        <li key={key} className="flex items-center gap-1.5">
          <StatusDot tone={tone} />
          {statusLegend[key]}
        </li>
      ))}
    </ul>
  );
}

export function MultiStore() {
  const { multiStore } = landing;

  return (
    <Section aria-labelledby="multi-store-title">
      <SectionHeading
        id="multi-store-title"
        eyebrow={multiStore.eyebrow}
        title={multiStore.title}
        description={multiStore.description}
      />

      <ul className="mt-12 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-2 md:gap-5 lg:grid-cols-12">
        {multiStore.cards.map((card, index) => (
          <li key={card.id} className={cn("min-w-0", layout[card.id])}>
            <Reveal delay={0.05 * index} className="h-full">
              <article className="flex h-full flex-col gap-6 overflow-hidden rounded-2xl border bg-surface p-5 sm:p-6">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold tracking-tight">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                    {card.description}
                  </p>
                  {card.id === "connections" ? (
                    <div className="pt-1">
                      <StatusLegend />
                    </div>
                  ) : null}
                </div>
                <div className="mt-auto w-full min-w-0">{mockups[card.id]}</div>
              </article>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
