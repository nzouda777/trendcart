import { Reveal, Section, SectionHeading } from "@/components/marketing/shared";
import { landing } from "@/content/landing";

import { HowItWorksApprovalBadge } from "./how-it-works-approval-badge";
import { HowItWorksSteps } from "./how-it-works-steps";

export function HowItWorks() {
  const { howItWorks } = landing;

  return (
    <Section id="how-it-works" aria-labelledby="how-it-works-title">
      <Reveal>
        <SectionHeading
          id="how-it-works-title"
          eyebrow={howItWorks.eyebrow}
          title={howItWorks.title}
          description={howItWorks.description}
        />
        <p className="mt-6 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <HowItWorksApprovalBadge label={howItWorks.approvalBadgeLabel} />
          <span>{howItWorks.approvalLegend}</span>
        </p>
      </Reveal>

      <HowItWorksSteps
        steps={howItWorks.steps}
        approvalBadgeLabel={howItWorks.approvalBadgeLabel}
      />
    </Section>
  );
}
