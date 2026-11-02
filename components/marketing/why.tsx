import { Hand, LayoutGrid, Sparkles, Timer, type LucideIcon } from "lucide-react";

import { Reveal, Section, SectionHeading, SpotlightCard } from "@/components/marketing/shared";
import { FlowDiagram } from "@/components/mockups";
import { landing } from "@/content/landing";
import type { LucideIconName } from "@/content/types";

/** Explicit map (keeps the bundle small). Unknown names fall back to `Sparkles`. */
const pillarIcons: Partial<Record<LucideIconName, LucideIcon>> = {
  Timer,
  LayoutGrid,
  Hand,
};

export function Why() {
  const { why } = landing;

  return (
    <Section id="product" aria-labelledby="why-title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            id="why-title"
            eyebrow={why.eyebrow}
            title={why.title}
            description={why.description}
          />
        </Reveal>
        <Reveal delay={0.1} className="w-full min-w-0">
          <FlowDiagram ariaLabel={why.flowAriaLabel} />
        </Reveal>
      </div>

      <ul className="mt-14 grid gap-4 md:mt-20 md:grid-cols-3 md:gap-6">
        {why.pillars.map((pillar, i) => {
          const Icon = pillarIcons[pillar.icon] ?? Sparkles;
          return (
            <li key={pillar.title} className="flex">
              <Reveal delay={0.08 * i} className="flex w-full">
                <SpotlightCard className="flex w-full flex-col gap-4">
                  <span className="grid size-10 place-items-center rounded-xl border border-brand-border bg-brand-soft text-brand-text">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="text-lg font-semibold tracking-tight">{pillar.title}</h3>
                  <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                    {pillar.description}
                  </p>
                </SpotlightCard>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
