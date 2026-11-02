import { ArrowRight } from "lucide-react";
import type { ComponentType } from "react";

import { Reveal, Section, SectionHeading, SpotlightCard } from "@/components/marketing/shared";
import {
  AdsBuilderMockup,
  ProductAnalysisMockup,
  ShopifyPageMockup,
  SupplierMarginMockup,
  TiktokPostingMockup,
  VideoComplianceMockup,
} from "@/components/mockups";
import { landing } from "@/content/landing";
import type { FeatureId, FeaturesContent } from "@/content/types";
import { cn } from "@/lib/utils";

const featureMockups: Record<FeatureId, ComponentType<{ className?: string }>> = {
  "product-identification": ProductAnalysisMockup,
  "supplier-margin": SupplierMarginMockup,
  "shopify-page": ShopifyPageMockup,
  "video-compliance": VideoComplianceMockup,
  "ads-builder": AdsBuilderMockup,
  "tiktok-posting": TiktokPostingMockup,
};

export function Features() {
  // Widen to the schema type (`landing` is declared with `satisfies`).
  const features: FeaturesContent = landing.features;

  return (
    <Section id="features" aria-labelledby="features-title">
      <Reveal>
        <SectionHeading
          id="features-title"
          eyebrow={features.eyebrow}
          title={features.title}
          description={features.description}
        />
      </Reveal>

      <div className="mt-16 flex flex-col gap-20 md:mt-20 md:gap-28">
        {features.items.map((item, i) => {
          const Mockup = featureMockups[item.id];
          const flipped = i % 2 === 1;
          const titleId = `feature-${item.id}-title`;

          return (
            <article
              key={item.id}
              aria-labelledby={titleId}
              className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
            >
              <Reveal className={cn("min-w-0", flipped && "lg:order-last")}>
                <p className="font-mono text-xs font-medium tracking-[0.18em] text-brand-text uppercase">
                  {item.eyebrow}
                </p>
                <h3
                  id={titleId}
                  className="mt-3 text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl"
                >
                  <span className="block">{item.title[0]}</span>
                  <span className="block text-muted-foreground">{item.title[1]}</span>
                </h3>
                <p className="mt-4 max-w-lg text-base leading-relaxed text-pretty text-muted-foreground">
                  {item.description}
                </p>
                <a
                  href={item.link.href}
                  aria-label={item.link.ariaLabel}
                  className="group/link mt-6 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {item.link.label}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none"
                  />
                </a>
              </Reveal>

              <Reveal delay={0.1} className="w-full min-w-0">
                <SpotlightCard className="w-full min-w-0 bg-surface-2/40 p-2 sm:p-4 lg:p-5">
                  <Mockup />
                </SpotlightCard>
              </Reveal>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
