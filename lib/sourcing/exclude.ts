/**
 * Listing exclusion for "None of these" at GATE 2 (pure).
 *
 * Rejected listing URLs are compared by a loose key so that the same product
 * page comes back excluded whatever the tracking parameters, fragment,
 * trailing slash, scheme or host case: host (lowercased, without "www.") +
 * path (without trailing slashes). The path keeps its case (ids can be
 * case-sensitive). Unparseable inputs are ignored.
 */

/** The comparison key of a listing URL, or null when it is not an http(s) URL. */
export function listingExclusionKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}`;
}

/** A predicate that is true for listing URLs matching any of `excludeUrls`. */
export function createExclusionFilter(excludeUrls: readonly string[] | undefined) {
  const keys = new Set(
    (excludeUrls ?? []).map(listingExclusionKey).filter((k): k is string => k !== null),
  );
  return (url: string): boolean => {
    if (keys.size === 0) return false;
    const k = listingExclusionKey(url);
    return k !== null && keys.has(k);
  };
}
