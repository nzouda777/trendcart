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
      url: `${siteConfig.url}${siteConfig.links.home}`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteConfig.url}${siteConfig.links.privacy}`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteConfig.url}${siteConfig.links.terms}`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
