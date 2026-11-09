import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { cookiePolicy } from "@/content/legal";

export const metadata: Metadata = {
  title: cookiePolicy.title,
  description: cookiePolicy.description,
  alternates: { canonical: siteConfig.links.cookies },
};

export default function CookiesPage() {
  return <LegalPage document={cookiePolicy} />;
}
