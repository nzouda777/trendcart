/**
 * Single source of truth for the brand. Never hardcode the name, tagline,
 * URLs or socials elsewhere — import `siteConfig` instead.
 */

/** Public production URL. Used in legal texts, which must never show a dev or preview host. */
const CANONICAL_URL = "https://usetrendcart.com";
const FALLBACK_URL = CANONICAL_URL;

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
  /** Logo wordmark, rendered "TREND CART" with the second word in brand green. */
  wordmark: { lead: "Trend", accent: "Cart" },
  tagline: "From trend to cart.",
  /**
   * Absolute URL of the current deployment (NEXT_PUBLIC_SITE_URL), without a
   * trailing slash. Can be localhost or a preview host: use it for auth and
   * metadata, not in user-facing text.
   */
  url: resolveSiteUrl(),
  /** Public production URL, always https://usetrendcart.com. Use it in user-facing text. */
  canonicalUrl: CANONICAL_URL,
  links: {
    home: "/",
    signIn: "/sign-in",
    signUp: "/sign-up",
    privacy: "/privacy",
    terms: "/terms",
    cookies: "/cookies",
  },
  /**
   * Who operates the service, shown on /privacy, /terms and /cookies (required by
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
    /** Shown at the top of the three legal pages; update when their content changes. */
    lastUpdated: "November 9, 2026",
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
