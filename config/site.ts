/**
 * Single source of truth for the brand. Never hardcode the name, tagline,
 * URLs or socials elsewhere — import `siteConfig` instead.
 */

const FALLBACK_URL = "https://trendcart.app";

function resolveSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_URL;
  return raw.replace(/\/+$/, "");
}

export type SocialLink = {
  /** Stable key, also used to pick an icon. */
  id: "x" | "tiktok" | "instagram" | "youtube";
  label: string;
  href: string;
};

export const siteConfig = {
  name: "Trendcart",
  tagline: "From trend to cart.",
  /** Absolute site URL without a trailing slash. */
  url: resolveSiteUrl(),
  links: {
    home: "/",
    signIn: "/sign-in",
    signUp: "/sign-up",
    privacy: "/privacy",
    terms: "/terms",
  },
  /**
   * Who operates the service, shown on /privacy and /terms (required by
   * TikTok and Shopify app review).
   * TODO: fill in the legal entity, contact email and country before
   * submitting the TikTok or Shopify apps. Empty values are left out of the
   * pages rather than invented.
   */
  legal: {
    /** Legal name of the company that operates Trendcart, e.g. "Acme SAS". */
    operator: "",
    /** Postal address of that company. */
    address: "",
    /** Inbox for privacy and legal requests, e.g. "privacy@yourdomain.com". */
    contactEmail: "",
    /** Country whose law governs the terms, e.g. "France". */
    governingLaw: "",
    /** Shown at the top of both pages; update when their content changes. */
    lastUpdated: "November 5, 2026",
  },
  // TODO: replace with the real handles once the accounts exist.
  socials: [
    { id: "x", label: "Trendcart on X", href: "https://x.com/trendcart" },
    { id: "tiktok", label: "Trendcart on TikTok", href: "https://www.tiktok.com/@trendcart" },
    {
      id: "instagram",
      label: "Trendcart on Instagram",
      href: "https://www.instagram.com/trendcart",
    },
    { id: "youtube", label: "Trendcart on YouTube", href: "https://www.youtube.com/@trendcart" },
  ] satisfies SocialLink[],
} as const;

export type SiteConfig = typeof siteConfig;
