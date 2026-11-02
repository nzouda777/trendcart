/**
 * Content schema for the marketing landing (`content/landing.ts`).
 * Owned by tc-foundation. Wave-3 agents may make ADDITIVE edits to their own
 * section block only (see docs/agents/PLAN.md).
 *
 * Rules: no brand name / tagline literals in content — import `siteConfig`.
 */
import type { icons } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Shared                                                                     */
/* -------------------------------------------------------------------------- */

/** Any lucide icon name in PascalCase, e.g. "ShieldCheck". Sections map names to imported icons. */
export type LucideIconName = keyof typeof icons;

/** Two-line headline with a deliberate break: [first line, second line]. */
export type TwoLineTitle = readonly [string, string];

/** Internal route ("/sign-up"), in-page anchor ("#pricing") or absolute URL. */
export type Href = string;

export type Link = {
  label: string;
  href: Href;
  /** Optional accessible label when `label` alone is ambiguous. */
  ariaLabel?: string;
};

export type Cta = Link;

/** Eyebrow + two-line title (+ description) — maps 1:1 to `SectionHeading` props. */
export type SectionIntro = {
  eyebrow: string;
  title: TwoLineTitle;
  description?: string;
};

/** Six items, matching `HowItWorksMockup` `step` 0–5. */
export type Six<T> = readonly [T, T, T, T, T, T];

/* -------------------------------------------------------------------------- */
/*  1. Announcement bar                                                        */
/* -------------------------------------------------------------------------- */

export type AnnouncementContent = {
  /** Bump to re-show the bar after a user dismissed a previous message (localStorage key suffix). */
  id: string;
  message: string;
  link?: Link;
  dismissLabel: string;
};

/* -------------------------------------------------------------------------- */
/*  2. Navbar                                                                  */
/* -------------------------------------------------------------------------- */

export type NavContent = {
  /** `aria-label` of the main `<nav>`. */
  ariaLabel: string;
  /** Product, How it works, Features, Pricing, FAQ → anchors `#product`, `#how-it-works`, … */
  links: readonly Link[];
  signIn: Cta;
  getStarted: Cta;
  skipToContentLabel: string;
  openMenuLabel: string;
  closeMenuLabel: string;
  /** Accessible name of the dark/light theme toggle. */
  themeToggleLabel: string;
};

/* -------------------------------------------------------------------------- */
/*  3. Hero                                                                    */
/* -------------------------------------------------------------------------- */

export type PipelineStateId = "import" | "identify" | "source" | "page" | "campaign";

export type PipelineState = {
  id: PipelineStateId;
  /** Short label for the progress indicator, e.g. "Paste link". */
  label: string;
  /** Optional one-line description (sr-only / caption). */
  description?: string;
};

export type HeroContent = {
  eyebrow: string;
  /** H1, two lines. */
  title: TwoLineTitle;
  subline: string;
  primaryCta: Cta;
  /** "See how it works →" → `#how-it-works`. */
  secondaryCta: Cta;
  trustBullets: readonly { icon: LucideIconName; label: string }[];
  pipeline: {
    /** Accessible description of the hero mockup. */
    ariaLabel: string;
    pauseLabel: string;
    playLabel: string;
    /** Exactly the 5 states, in order. */
    states: readonly [PipelineState, PipelineState, PipelineState, PipelineState, PipelineState];
  };
};

/* -------------------------------------------------------------------------- */
/*  4. Integrations marquee                                                    */
/* -------------------------------------------------------------------------- */

export type IntegrationId =
  "shopify" | "tiktok" | "tiktok-ads" | "claude" | "chatgpt" | "gemini" | "perplexity";

export type IntegrationsContent = {
  /** "Works with". */
  label: string;
  items: readonly { id: IntegrationId; name: string }[];
  /** Optional small print, e.g. trademarks belong to their owners. */
  disclaimer?: string;
  /** Accessible labels of the marquee pause/play toggle (WCAG 2.2.2). */
  pauseLabel: string;
  playLabel: string;
};

/* -------------------------------------------------------------------------- */
/*  5. Why                                                                     */
/* -------------------------------------------------------------------------- */

export type Pillar = {
  icon: LucideIconName;
  title: string;
  description: string;
};

export type WhyContent = SectionIntro & {
  /** Accessible description of the `FlowDiagram`. */
  flowAriaLabel: string;
  /** Exactly 3 pillars. */
  pillars: readonly [Pillar, Pillar, Pillar];
};

/* -------------------------------------------------------------------------- */
/*  6. How it works                                                            */
/* -------------------------------------------------------------------------- */

export type HowItWorksStepId =
  "import" | "identify" | "source" | "build-page" | "prepare-videos" | "create-campaign";

export type HowItWorksStep = {
  id: HowItWorksStepId;
  title: string;
  /** 1–2 sentences. */
  description: string;
  /** Human approval checkpoint label (e.g. "Product confirmed"), or null when none. 4 steps have one. */
  approval: string | null;
};

export type HowItWorksContent = SectionIntro & {
  /** Import, Identify, Source, Build the page, Prepare videos, Create the campaign. */
  steps: Six<HowItWorksStep>;
  /** Badge text shown on approval steps, e.g. "Your approval". */
  approvalBadgeLabel: string;
  /** Legend explaining the badge. */
  approvalLegend: string;
};

/* -------------------------------------------------------------------------- */
/*  7. Feature deep-dives                                                      */
/* -------------------------------------------------------------------------- */

/** Each id maps to one mockup (ProductAnalysisMockup, SupplierMarginMockup, …). */
export type FeatureId =
  | "product-identification"
  | "supplier-margin"
  | "shopify-page"
  | "video-compliance"
  | "ads-builder"
  | "tiktok-posting";

export type FeatureItem = {
  id: FeatureId;
  eyebrow: string;
  title: TwoLineTitle;
  /** 2–3 sentences. */
  description: string;
  link: Link;
};

export type FeaturesContent = SectionIntro & {
  items: Six<FeatureItem>;
};

/* -------------------------------------------------------------------------- */
/*  8. Multi-store & teams                                                     */
/* -------------------------------------------------------------------------- */

export type MultiStoreCardId = "brands" | "connections" | "proxy" | "team";

export type MultiStoreContent = SectionIntro & {
  /** One card per mockup: BrandSwitcher, Connections, ProxySetting, Team. */
  cards: readonly { id: MultiStoreCardId; title: string; description: string }[];
  /** Text legend for status dots (never color alone). */
  statusLegend: { connected: string; attention: string; error: string };
};

/* -------------------------------------------------------------------------- */
/*  9. Control & security                                                      */
/* -------------------------------------------------------------------------- */

export type SecurityCardId =
  | "approval"
  | "no-video-storage"
  | "encrypted-tokens"
  | "isolated-workspaces"
  | "roles-2fa"
  | "activity-pace";

export type SecurityCard = {
  id: SecurityCardId;
  icon: LucideIconName;
  title: string;
  description: string;
};

export type SecurityContent = SectionIntro & {
  cards: Six<SecurityCard>;
};

/* -------------------------------------------------------------------------- */
/*  10. Pricing                                                                */
/* -------------------------------------------------------------------------- */

export type BillingPeriod = "monthly" | "yearly";

export type PlanId = "starter" | "growth" | "scale";

export type PlanLimit = {
  id: "stores" | "seats" | "products";
  /** e.g. "Brands / stores". */
  label: string;
  /** e.g. "3" or "Unlimited". */
  value: string;
};

export type PricingPlan = {
  id: PlanId;
  name: string;
  description: string;
  price: {
    /** Price per month when billed monthly, in `pricing.currency`. */
    monthly: number;
    /** Total price per year when billed yearly (10 × monthly = "2 months free"). */
    yearly: number;
  };
  /** Brands/stores, team seats, products per month. */
  limits: readonly PlanLimit[];
  features: readonly string[];
  cta: Cta;
  highlighted: boolean;
  /** e.g. "Most popular" on the highlighted plan. */
  badge?: string;
};

export type PricingContent = SectionIntro & {
  currency: "USD";
  currencySymbol: string;
  billing: {
    toggleLabel: string;
    monthlyLabel: string;
    yearlyLabel: string;
    /** "2 months free". */
    yearlyBadge: string;
    /** Suffix after the price, e.g. "/month". */
    perMonthSuffix: string;
    /** sr-only period text, e.g. "per month". */
    perMonthSrLabel: string;
    /** Note under the price when yearly is selected, e.g. "billed yearly". */
    billedYearlyNote: string;
  };
  plans: readonly [PricingPlan, PricingPlan, PricingPlan];
  enterprise: {
    title: string;
    description: string;
    cta: Cta;
  };
  footnote?: string;
};

/* -------------------------------------------------------------------------- */
/*  11. FAQ                                                                    */
/* -------------------------------------------------------------------------- */

export type FaqItem = {
  id: string;
  question: string;
  /** Plain text (also used for FAQPage JSON-LD). */
  answer: string;
};

export type FaqContent = SectionIntro & {
  items: readonly FaqItem[];
};

/* -------------------------------------------------------------------------- */
/*  12. Final CTA                                                              */
/* -------------------------------------------------------------------------- */

export type FinalCtaContent = {
  eyebrow?: string;
  title: TwoLineTitle;
  description?: string;
  primaryCta: Cta;
  secondaryCta: Cta;
};

/* -------------------------------------------------------------------------- */
/*  13. Footer                                                                 */
/* -------------------------------------------------------------------------- */

export type FooterColumn = {
  /** Product, Resources, Company, Legal. */
  title: string;
  links: readonly Link[];
};

export type FooterContent = {
  /** The signature itself comes from `siteConfig.tagline`. */
  columns: readonly [FooterColumn, FooterColumn, FooterColumn, FooterColumn];
  newsletter: {
    title: string;
    description?: string;
    /** Visible or sr-only label of the email input. */
    inputLabel: string;
    placeholder: string;
    submitLabel: string;
    successMessage: string;
  };
  socialsLabel: string;
  /** Text after "© {year} {siteConfig.name}", e.g. "All rights reserved." */
  legalNote: string;
};

/* -------------------------------------------------------------------------- */
/*  Landing                                                                    */
/* -------------------------------------------------------------------------- */

export type LandingContent = {
  announcement: AnnouncementContent;
  nav: NavContent;
  hero: HeroContent;
  integrations: IntegrationsContent;
  why: WhyContent;
  howItWorks: HowItWorksContent;
  features: FeaturesContent;
  multiStore: MultiStoreContent;
  security: SecurityContent;
  pricing: PricingContent;
  faq: FaqContent;
  finalCta: FinalCtaContent;
  footer: FooterContent;
};
