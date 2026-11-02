import {
  ArrowRightIcon,
  CircleCheckIcon,
  CloudOffIcon,
  ShieldCheckIcon,
  StoreIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/marketing/shared";
import { PipelineMockup } from "@/components/mockups";
import { Button } from "@/components/ui/button";
import { landing } from "@/content/landing";
import type { LucideIconName } from "@/content/types";

/** Icons used by `hero.trustBullets`; unknown names fall back to a check. */
const trustIcons: Partial<Record<LucideIconName, LucideIcon>> = {
  ShieldCheck: ShieldCheckIcon,
  Store: StoreIcon,
  CloudOff: CloudOffIcon,
};

/**
 * Hero. The H1 is plain server-rendered text with no entrance animation, so it
 * paints immediately (LCP). Background = plain page color + a faint CSS grid
 * that fades out towards the edges (alpha mask only, no color).
 */
export function Hero() {
  const { hero } = landing;

  return (
    <Section
      aria-labelledby="hero-title"
      flush
      className="isolate overflow-hidden pt-12 pb-20 sm:pt-16 md:pt-20 md:pb-28 lg:pt-24"
    >
      {/* Background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-grid [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black_30%,transparent_100%)] [--grid-size:44px]"
      />

      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10 xl:gap-16">
        {/* Copy */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-soft px-3 py-1 font-mono text-[11px] font-medium tracking-[0.16em] text-brand-text uppercase sm:text-xs">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
            {hero.eyebrow}
          </p>

          <h1
            id="hero-title"
            className="mt-6 text-[2.5rem] leading-[1.04] font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl lg:text-[3.5rem] xl:text-[4rem]"
          >
            <span className="block">{hero.title[0]}</span>
            <span className="block text-brand-text">{hero.title[1]}</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            {hero.subline}
          </p>

          <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Button asChild size="xl">
              <Link href={hero.primaryCta.href}>
                {hero.primaryCta.label}
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl" className="bg-background/60">
              <a href={hero.secondaryCta.href}>{hero.secondaryCta.label}</a>
            </Button>
          </div>

          <ul className="mt-10 flex flex-col items-start gap-3 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-6 lg:justify-start">
            {hero.trustBullets.map((bullet) => {
              const Icon = trustIcons[bullet.icon] ?? CircleCheckIcon;
              return (
                <li key={bullet.label} className="flex items-center gap-2">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-brand-text" />
                  {bullet.label}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Mockup */}
        <div className="relative mx-auto w-full max-w-xl min-w-0 lg:max-w-none">
          <PipelineMockup
            ariaLabel={hero.pipeline.ariaLabel}
            pauseLabel={hero.pipeline.pauseLabel}
            playLabel={hero.pipeline.playLabel}
          />
        </div>
      </div>
    </Section>
  );
}
