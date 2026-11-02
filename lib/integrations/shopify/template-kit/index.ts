/**
 * Trendcart Shopify template kit (repo files only; Trendcart never writes
 * themes in v1, the merchant installs the kit, see ./README.md).
 *
 *   theme/sections/trendcart-product-details.liquid  any Online Store 2.0 theme
 *   theme/templates/product.trendcart.json           Dawn-family themes
 *
 * The template suffix is "trendcart": products created with
 * templateSuffix "trendcart" render with templates/product.trendcart.json.
 */

export const TRENDCART_TEMPLATE_SUFFIX = "trendcart";

/** Theme-relative paths of the kit files, as the merchant uploads them. */
export const TEMPLATE_KIT_FILES = [
  "sections/trendcart-product-details.liquid",
  "templates/product.trendcart.json",
] as const;

/** Whether the theme already has the kit's template (from listProductTemplates()). */
export function hasTrendcartTemplate(suffixes: readonly (string | null)[]): boolean {
  return suffixes.includes(TRENDCART_TEMPLATE_SUFFIX);
}
