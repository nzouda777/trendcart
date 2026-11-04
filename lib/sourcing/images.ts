/**
 * Supplier image URLs for product pages (pure).
 *
 * Listings often link resized copies of their photos. Shopify downloads what
 * we give it, so we ask for the original size the marketplace CDN serves:
 *   AliExpress  …/kf/Sabc.jpg_640x640.jpg_.webp → …/kf/Sabc.jpg
 *   Amazon      …/images/I/71abc._AC_SL1500_.jpg → …/images/I/71abc.jpg
 *   CJ          …/abc.jpg?x-oss-process=image/resize,w_200 → …/abc.jpg
 * Search-engine thumbnails (Google, SerpApi proxies) are too small and
 * short-lived for a product page: they are dropped.
 */

const THUMBNAIL_HOSTS = /(^|\.)(gstatic\.com|googleusercontent\.com|serpapi\.com)$/i;

/** Original-size URL of a marketplace CDN image (unchanged for other hosts). */
export function fullSizeImageUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)alicdn\.com$/.test(host) || /(^|\.)aliexpress-media\.com$/.test(host)) {
    url.pathname = url.pathname.replace(/^(.*?\.(?:jpe?g|png|webp))_[^/]*$/i, "$1");
    url.search = "";
  } else if (/(^|\.)media-amazon\.com$/.test(host) || /(^|\.)ssl-images-amazon\.com$/.test(host)) {
    url.pathname = url.pathname.replace(
      /^(\/images\/I\/[^/.]+)\.[^/]*_\.(jpe?g|png|webp)$/i,
      "$1.$2",
    );
  } else if (/(^|\.)cjdropshipping\.com$/.test(host)) {
    url.search = "";
  }
  return url.href;
}

/** True for images good enough for a product page: https, not a search thumbnail. */
export function isPageImage(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !THUMBNAIL_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}
