/**
 * Current year for server components (e.g. the footer copyright).
 * `cacheComponents` is on, so reading the clock must happen inside a cached
 * scope; this keeps it prerender-safe and hydration-safe.
 */
export async function getCurrentYear(): Promise<number> {
  "use cache";
  return new Date().getFullYear();
}
