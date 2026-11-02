import { AnnouncementBar } from "@/components/marketing/announcement-bar";
import { Faq } from "@/components/marketing/faq";
import { Features } from "@/components/marketing/features";
import { FinalCta } from "@/components/marketing/final-cta";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { IntegrationsMarquee } from "@/components/marketing/integrations-marquee";
import { MultiStore } from "@/components/marketing/multi-store";
import { Navbar } from "@/components/marketing/navbar";
import { Pricing } from "@/components/marketing/pricing";
import { Security } from "@/components/marketing/security";
import { Why } from "@/components/marketing/why";

/** Landing page: all 13 sections in order. `#main-content` is the skip-link target. */
export default function LandingPage() {
  return (
    <>
      <AnnouncementBar />
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Hero />
        <IntegrationsMarquee />
        <Why />
        <HowItWorks />
        <Features />
        <MultiStore />
        <Security />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
