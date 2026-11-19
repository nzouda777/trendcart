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
   * Who operates the service, shown in the footer of every page and on
   * /privacy, /terms and /cookies (required by TikTok and Shopify app review).
   * Must match the ABN register exactly (abr.business.gov.au) and the TikTok
   * Developer Profile. Empty values are left out of the pages rather than invented.
   */
  legal: {
    /** Registered business name, spelled as on the ABN register. */
    businessName: "Trend Cart",
    /** Legal name of the sole trader who holds the ABN. */
    operator: "Christian Paternotte",
    /** Legal form of the operator. */
    entityType: "sole trader",
    /** Australian Business Number of the operator. */
    abn: "72 650 233 199",
    /** Postal address of the operator. Intentionally left out. */
    address: "",
    /** Inbox for privacy and legal requests. Same address as the TikTok Developer Profile. */
    contactEmail: "business@usetrendcart.com",
    /** Jurisdiction whose law governs the terms. */
    governingLaw: "the State of Victoria, Australia",
    /** Shown at the top of the three legal pages; update when their content changes. */
    lastUpdated: "November 19, 2026",
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

/**
 * Who operates the service, in one sentence, e.g. "Trend Cart is a registered
 * business name operated by Jane Doe, sole trader, ABN 12 345 678 901."
 * Shown in the footer of every page and in the Contact section of legal pages.
 */
export function getOperatorNotice(): string {
  const { businessName, operator, entityType, abn } = siteConfig.legal as Record<string, string>;
  const brand = businessName || siteConfig.name;
  if (!operator) return `${brand} is operated by ${siteConfig.name}.`;
  const details = [operator, entityType, abn ? `ABN ${abn}` : ""].filter(Boolean).join(", ");
  return `${brand} is a registered business name operated by ${details}.`;
}

/** The operator as a party name in legal texts, e.g. "Jane Doe trading as Trend Cart (ABN …)". */
export function getOperatorParty(): string {
  const { businessName, operator, abn } = siteConfig.legal as Record<string, string>;
  if (!operator) return businessName || siteConfig.name;
  const trading = businessName ? ` trading as ${businessName}` : "";
  return `${operator}${trading}${abn ? ` (ABN ${abn})` : ""}`;
}
