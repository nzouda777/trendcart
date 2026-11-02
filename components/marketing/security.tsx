import {
  Boxes,
  CloudOff,
  Gauge,
  KeyRound,
  ShieldCheck,
  UserCog,
  type LucideIcon,
} from "lucide-react";

import { Reveal, Section, SectionHeading, SpotlightCard } from "@/components/marketing/shared";
import { landing } from "@/content/landing";
import type { LucideIconName } from "@/content/types";

/** Explicit map keeps the bundle to the icons actually used by the content. */
const icons: Partial<Record<LucideIconName, LucideIcon>> = {
  ShieldCheck,
  CloudOff,
  KeyRound,
  Boxes,
  UserCog,
  Gauge,
};

export function Security() {
  const { security } = landing;

  return (
    <Section aria-labelledby="security-title">
      <SectionHeading id="security-title" eyebrow={security.eyebrow} title={security.title} />

      <ul className="mt-12 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {security.cards.map((card, index) => {
          const Icon = icons[card.icon] ?? ShieldCheck;
          return (
            <li key={card.id} className="min-w-0">
              <Reveal delay={0.05 * index} className="h-full">
                <SpotlightCard className="h-full">
                  <span className="grid size-10 place-items-center rounded-xl border bg-surface-2 text-brand-text">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold tracking-tight">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
                    {card.description}
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
