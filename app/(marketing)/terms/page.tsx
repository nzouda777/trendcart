import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { termsOfService } from "@/content/legal";

export const metadata: Metadata = {
  title: termsOfService.title,
  description: termsOfService.description,
  alternates: { canonical: siteConfig.links.terms },
};

export default function TermsPage() {
  return <LegalPage document={termsOfService} />;
}
