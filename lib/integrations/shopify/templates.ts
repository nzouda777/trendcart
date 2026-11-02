/**
 * Product template discovery helpers (pure).
 *
 * Online Store 2.0 themes store product templates as JSON:
 *   templates/product.json          -> default template (suffix null)
 *   templates/product.trendcart.json -> suffix "trendcart"
 * Liquid templates (product.*.liquid, vintage themes) are not supported in v1.
 */

const PRODUCT_TEMPLATE = /^templates\/product(?:\.([A-Za-z0-9_-]+))?\.json$/;

/** Suffix for one theme filename, `undefined` when it is not a product JSON template. */
export function templateSuffixFromFilename(filename: string): string | null | undefined {
  const match = PRODUCT_TEMPLATE.exec(filename);
  if (!match) return undefined;
  return match[1] ?? null;
}

/**
 * Unique suffixes from theme filenames: default (null) first, then sorted.
 * Anything that is not templates/product[.suffix].json is ignored.
 */
export function parseTemplateSuffixes(filenames: readonly string[]): (string | null)[] {
  let hasDefault = false;
  const suffixes = new Set<string>();
  for (const name of filenames) {
    const suffix = templateSuffixFromFilename(name);
    if (suffix === undefined) continue;
    if (suffix === null) hasDefault = true;
    else suffixes.add(suffix);
  }
  const sorted = [...suffixes].sort((a, b) => a.localeCompare(b));
  return hasDefault ? [null, ...sorted] : sorted;
}
