import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";

/**
 * Only indexable pages. `/sign-in` and `/sign-up` are `noindex` placeholders
 * and intentionally left out. No `lastModified`: reading the clock during
 * prerender is not allowed with `cacheComponents`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteConfig.canonicalUrl}${siteConfig.links.home}`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteConfig.canonicalUrl}${siteConfig.links.privacy}`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteConfig.canonicalUrl}${siteConfig.links.terms}`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteConfig.canonicalUrl}${siteConfig.links.cookies}`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
