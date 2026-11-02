import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Section, SectionHeading } from "@/components/marketing/shared";
import { Button } from "@/components/ui/button";
import { landing } from "@/content/landing";

import { PricingPlans } from "./pricing-plans";

export function Pricing() {
  const { pricing } = landing;

  return (
    <Section id="pricing" aria-labelledby="pricing-title">
      <SectionHeading
        id="pricing-title"
        eyebrow={pricing.eyebrow}
        title={pricing.title}
        description={pricing.description}
        align="center"
      />

      <PricingPlans />

      <div className="mt-8 flex flex-col gap-4 rounded-2xl border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{pricing.enterprise.title}</h3>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {pricing.enterprise.description}
          </p>
        </div>
        <Button asChild size="xl" variant="outline" className="sm:shrink-0">
          <Link href={pricing.enterprise.cta.href}>
            {pricing.enterprise.cta.label}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {pricing.footnote ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">{pricing.footnote}</p>
      ) : null}
    </Section>
  );
}
