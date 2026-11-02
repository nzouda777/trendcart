import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Reveal, Section } from "@/components/marketing/shared";
import { Button } from "@/components/ui/button";
import { landing } from "@/content/landing";

/** Solid band: green tint + green border, second headline line in brand green. */
export function FinalCta() {
  const { finalCta } = landing;

  return (
    <Section aria-labelledby="final-cta-title">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-3xl border border-brand-border bg-brand-soft px-6 py-16 text-center sm:px-10 md:py-24">
          <h2
            id="final-cta-title"
            className="mx-auto max-w-3xl text-3xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-4xl md:text-5xl"
          >
            <span className="block">{finalCta.title[0]}</span>
            <span className="block text-brand-text">{finalCta.title[1]}</span>
          </h2>
          {finalCta.description ? (
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground md:text-lg">
              {finalCta.description}
            </p>
          ) : null}
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button asChild size="xl">
              <Link href={finalCta.primaryCta.href}>
                {finalCta.primaryCta.label}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link href={finalCta.secondaryCta.href}>{finalCta.secondaryCta.label}</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
