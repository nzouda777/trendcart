import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { termsOfService } from "@/content/legal";

export const metadata: Metadata = {
  title: termsOfService.title,
  description: termsOfService.description,
  alternates: { canonical: siteConfig.links.terms },
};

/** Governing law is shown only once siteConfig.legal.governingLaw is filled in. */
function GoverningLaw() {
  const law: string = siteConfig.legal.governingLaw;
  if (!law) return null;
  return (
    <section aria-labelledby="governing-law" className="scroll-mt-24">
      <h2 id="governing-law" className="text-xl font-semibold tracking-tight">
        Governing law
      </h2>
      <p className="mt-3 text-muted-foreground">
        These terms are governed by the laws of {law}, without regard to conflict of law rules.
      </p>
    </section>
  );
}

export default function TermsPage() {
  return <LegalPage document={termsOfService} extra={<GoverningLaw />} />;
}
