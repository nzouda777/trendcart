/**
 * Pure helpers turning a supplier listing and the GATE 2 prices into the
 * options, variants and images of the Shopify draft (createDraftProduct).
 */
import { findUnsafeClaims } from "@/lib/ai/copy-safety";
import type { ShopifyDraftProductInput, SupplierListing } from "@/lib/domain/contracts";
import { fullSizeImageUrl, isPageImage } from "@/lib/sourcing/images";

/** Shopify allows 3 options; we keep the variant matrix small for a test product. */
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;
export const MAX_IMAGES = 10;

type Options = ShopifyDraftProductInput["options"];
type Variants = ShopifyDraftProductInput["variants"];

const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 255);

/**
 * Options from the listing's variant groups (deduplicated, at most 3), with
 * values trimmed so the full matrix stays within MAX_VARIANTS, and one
 * variant per combination at the confirmed price. No usable group: a single
 * default variant.
 */
export function variantsFromListing(
  groups: SupplierListing["variants"],
  price: number,
  compareAtPrice: number | null,
): { options: Options; variants: Variants } {
  const options: { name: string; values: string[] }[] = [];
  const names = new Set<string>();
  for (const group of groups) {
    const name = clean(group.name);
    const key = name.toLowerCase();
    if (!name || names.has(key)) continue;
    const values = [...new Set(group.values.map(clean).filter(Boolean))];
    if (values.length === 0) continue;
    names.add(key);
    options.push({ name, values });
    if (options.length === MAX_OPTIONS) break;
  }

  // Trim from the last option until the matrix fits.
  const size = () => options.reduce((n, o) => n * o.values.length, 1);
  for (let i = options.length - 1; i >= 0 && size() > MAX_VARIANTS; i--) {
    const others = size() / options[i]!.values.length;
    options[i]!.values = options[i]!.values.slice(
      0,
      Math.max(1, Math.floor(MAX_VARIANTS / others)),
    );
  }

  if (options.length === 0) {
    return { options: [], variants: [{ optionValues: [], price, compareAtPrice }] };
  }
  let combos: string[][] = [[]];
  for (const option of options) {
    combos = combos.flatMap((combo) => option.values.map((value) => [...combo, value]));
  }
  return {
    options,
    variants: combos.map((optionValues) => ({ optionValues, price, compareAtPrice })),
  };
}

/** True when the copy-safety guard flags this text (fake proof, health claims, urgency...). */
export function isUnsafeText(text: string): boolean {
  return (
    findUnsafeClaims({
      title: text,
      descriptionHtml: "",
      highlights: [],
      faq: [],
      guarantee: "",
      adTexts: [],
    }).length > 0
  );
}

/**
 * Variant groups scraped from a supplier listing, without the option names
 * and values the copy-safety guard flags (QA N6): a flagged name drops the
 * whole group, a flagged value drops that value, a group left without values
 * is dropped. These strings reach the storefront without human edits.
 */
export function safeVariantGroups(
  groups: SupplierListing["variants"],
): SupplierListing["variants"] {
  return groups
    .filter((g) => !isUnsafeText(g.name))
    .map((g) => ({ ...g, values: g.values.filter((v) => !isUnsafeText(v)) }))
    .filter((g) => g.values.length > 0);
}

/** Below this many photos from the chosen supplier, the gallery is topped up. */
export const MIN_PAGE_IMAGES = 6;
/** Other listings lend photos only when they very likely show the same product. */
export const LENDER_MIN_MATCH = 0.6;

/**
 * Gallery of the Shopify draft: every photo of the chosen supplier first (at
 * original size); when that leaves fewer than MIN_PAGE_IMAGES, the reference
 * image of the analysis, then photos of the other listings of the same
 * product (best match first, match ≥ LENDER_MIN_MATCH). Search thumbnails are
 * never used. Deterministic for the same rows, so re-syncs keep the media.
 */
export function pageImageUrls(input: {
  selected: readonly string[];
  referenceImageUrl?: string | null;
  others: readonly { images: readonly string[]; matchScore: number }[];
}): string[] {
  const usable = (urls: readonly (string | null | undefined)[]) =>
    urls
      .filter((u): u is string => !!u)
      .map(fullSizeImageUrl)
      .filter(isPageImage);
  const gallery = draftImageUrls(usable(input.selected));
  if (gallery.length >= MIN_PAGE_IMAGES) return gallery;
  const lenders = [...input.others]
    .filter((o) => o.matchScore >= LENDER_MIN_MATCH)
    .sort((a, b) => b.matchScore - a.matchScore);
  const extra: string[] = [];
  for (const url of [
    ...usable([input.referenceImageUrl]),
    ...lenders.flatMap((o) => usable(o.images)),
  ]) {
    if (gallery.length + extra.length >= MIN_PAGE_IMAGES) break;
    if (!gallery.includes(url) && !extra.includes(url)) extra.push(url);
  }
  return draftImageUrls(gallery, extra);
}

/** Public https image URLs, deduplicated, at most MAX_IMAGES. */
export function draftImageUrls(...lists: (readonly (string | null | undefined)[])[]): string[] {
  const out: string[] = [];
  for (const url of lists.flat()) {
    if (!url || out.includes(url)) continue;
    try {
      if (new URL(url).protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push(url);
    if (out.length === MAX_IMAGES) break;
  }
  return out;
}
