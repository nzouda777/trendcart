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
