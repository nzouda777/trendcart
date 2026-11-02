/**
 * Pure mapping from Trendcart inputs to Admin API `productSet` variables
 * (2026-10). No network; the live adapter sends what this returns.
 *
 * Idempotency (see createDraftProduct in ./live):
 * - `idempotencyKey` is written to the `trendcart.product_id` custom ID
 *   metafield and used as the productSet identifier, so a re-run upserts.
 * - On update, existing variants are matched by their option values and keep
 *   their ids; existing Trendcart images are matched by a deterministic
 *   filename (`tc-<sha256(url)[0..16]>.<ext>`) and kept by id, so Shopify does
 *   not download them again; any media we did not create (merchant uploads,
 *   M3 videos) is kept untouched.
 *
 * Safety (QA M2 S1, N6): `sanitizeDraftInput` runs on every input, whoever the
 * caller is. The description goes through the shared `sanitizeDescriptionHtml`;
 * every other text field (title, SEO, option names/values, metafield text,
 * tags, vendor, SKU) is plain text: no tags, no angle brackets, no control
 * characters, capped to Shopify's limits.
 */
import { createHash } from "node:crypto";

import { sanitizeDescriptionHtml } from "@/lib/ai";
import {
  shopifyDraftProductInputSchema,
  type PageCopy,
  type ShopifyDraftProductInput,
} from "@/lib/domain/contracts";

import { SHOPIFY_PRODUCT_ID_METAFIELD } from "./config";
import { shopifyError } from "./errors";

type ParsedDraft = ReturnType<typeof shopifyDraftProductInputSchema.parse>;

/** Option Shopify uses for products without real options. */
export const DEFAULT_OPTION = { name: "Title", value: "Default Title" } as const;

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 320;

/* ------------------------------ Existing state ----------------------------- */

/** What createDraftProduct reads back before updating an existing product. */
export type ExistingProduct = {
  id: string;
  variants: { id: string; selectedOptions: { name: string; value: string }[] }[];
  media: {
    id: string;
    mediaContentType: string;
    status: string;
    /** Final or preview image URL; null while Shopify is still processing. */
    url: string | null;
  }[];
};

/* --------------------------------- Images --------------------------------- */

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"]);
const MARKER = /(?:^|\/)tc-([0-9a-f]{16})[^/]*$/;

export function imageMarker(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** Deterministic filename for a source image, keeping the source's extension. */
export function imageFilename(url: string): string {
  let ext = "jpg";
  try {
    const match = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname);
    const candidate = match?.[1]?.toLowerCase();
    if (candidate && IMAGE_EXTENSIONS.has(candidate))
      ext = candidate === "jpeg" ? "jpg" : candidate;
  } catch {
    // Validated as a URL by the schema; keep the default.
  }
  return `tc-${imageMarker(url)}.${ext}`;
}

/** Marker from a Shopify CDN URL created by imageFilename (Shopify may append _<uuid>). */
export function markerFromShopifyUrl(url: string): string | null {
  try {
    return MARKER.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/* ---------------------------------- SEO ----------------------------------- */

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

export function seoFor(title: string, descriptionHtml: string) {
  return {
    title: truncateAtWord(plainText(title, Infinity), SEO_TITLE_MAX),
    description: truncateAtWord(plainText(descriptionHtml, Infinity), SEO_DESCRIPTION_MAX),
  };
}

/* ------------------------------- Plain text -------------------------------- */

/** Shopify limits (Admin API 2026-10) for the plain-text fields we send. */
export const TEXT_LIMITS = {
  title: 255,
  optionName: 255,
  optionValue: 255,
  sku: 255,
  tag: 255,
  vendor: 255,
  productType: 255,
  /** Items of the list.single_line_text_field `custom.highlights`. */
  highlight: 255,
  faqQuestion: 255,
  faqAnswer: 2000,
  guarantee: 5000,
} as const;

// C0/C1 controls (except \t and \n), zero-width and bidi override characters.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

/**
 * Plain text for a Shopify text field: tags removed (script/style bodies
 * included), common entities decoded, then any remaining `<` or `>` dropped so
 * no markup survives, control characters removed, whitespace collapsed
 * (single newlines kept when `multiline`), trimmed and capped at `max` code
 * points.
 */
export function plainText(value: string, max: number, multiline = false): string {
  const text = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?[a-z!][^>]*>?/gi, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/[<>]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "");
  const collapsed = multiline
    ? text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : text.replace(/\s+/g, " ");
  return Array.from(collapsed.trim()).slice(0, max).join("").trim();
}

const dedupe = (values: string[]) => [...new Set(values)];

/**
 * Makes any draft input safe to send: sanitized description HTML, plain text
 * everywhere else. Options (often scraped from supplier listings) are cleaned,
 * empty and duplicate values dropped, options left without values or with a
 * duplicate name dropped; variants pointing at a dropped value are dropped and
 * duplicates collapsed (first wins). Idempotent on its own output.
 */
export function sanitizeDraftInput(input: ShopifyDraftProductInput): ShopifyDraftProductInput {
  const kept: { index: number; name: string; values: string[]; map: Map<string, string> }[] = [];
  const names = new Set<string>();
  (input.options ?? []).forEach((o, index) => {
    const name = plainText(o.name ?? "", TEXT_LIMITS.optionName);
    if (!name || names.has(name.toLowerCase())) return;
    const map = new Map<string, string>();
    for (const raw of o.values ?? []) {
      const clean = plainText(raw ?? "", TEXT_LIMITS.optionValue);
      if (clean) map.set(raw, clean);
    }
    const values = dedupe([...map.values()]);
    if (values.length === 0) return;
    names.add(name.toLowerCase());
    kept.push({ index, name, values, map });
  });

  // Variants: only what cleaning itself broke is dropped (a value emptied by
  // cleaning, a duplicate created by cleaning). Caller mistakes (wrong value
  // count, unknown value, a literal duplicate) pass through so parseDraftInput
  // still rejects them with a clear error.
  const optionCount = (input.options ?? []).length;
  const seen = new Map<string, string>();
  const variants: ShopifyDraftProductInput["variants"] = [];
  for (const v of input.variants ?? []) {
    const rawValues = v.optionValues ?? [];
    let optionValues: string[];
    if (rawValues.length !== optionCount) {
      optionValues = rawValues.map((raw) => plainText(raw ?? "", TEXT_LIMITS.optionValue));
    } else {
      optionValues = [];
      let emptied = false;
      for (const o of kept) {
        const raw = rawValues[o.index]!;
        const clean = o.map.get(raw) ?? plainText(raw, TEXT_LIMITS.optionValue);
        if (!clean && (input.options?.[o.index]?.values ?? []).includes(raw)) emptied = true;
        optionValues.push(clean);
      }
      if (emptied) continue;
    }
    const combo = JSON.stringify(optionValues);
    const rawCombo = JSON.stringify(rawValues);
    if (seen.has(combo) && seen.get(combo) !== rawCombo) continue;
    seen.set(combo, rawCombo);
    const { sku: rawSku, ...rest } = v;
    const sku = rawSku === undefined ? "" : plainText(rawSku, TEXT_LIMITS.sku);
    variants.push({ ...rest, optionValues, ...(sku ? { sku } : {}) });
  }

  let seo: ShopifyDraftProductInput["seo"];
  if (input.seo) {
    const title = truncateAtWord(plainText(input.seo.title ?? "", Infinity), SEO_TITLE_MAX);
    const description = truncateAtWord(
      plainText(input.seo.description ?? "", Infinity),
      SEO_DESCRIPTION_MAX,
    );
    // An SEO block emptied by cleaning falls back to the derived one.
    seo = title && description ? { title, description } : undefined;
  }

  const optional = (value: string | undefined, max: number) =>
    value === undefined ? undefined : plainText(value, max) || undefined;

  const metafields = input.metafields ?? { highlights: [], faq: [], guarantee: "" };
  const vendor = optional(input.vendor, TEXT_LIMITS.vendor);
  const productType = optional(input.productType, TEXT_LIMITS.productType);
  const out: ShopifyDraftProductInput = {
    ...input,
    title: plainText(input.title ?? "", TEXT_LIMITS.title),
    descriptionHtml: sanitizeDescriptionHtml(input.descriptionHtml ?? ""),
    seo,
    vendor,
    productType,
    ...(input.tags
      ? { tags: dedupe(input.tags.map((t) => plainText(t, TEXT_LIMITS.tag)).filter(Boolean)) }
      : {}),
    options: kept.map((o) => ({ name: o.name, values: o.values })),
    variants,
    metafields: {
      highlights: (metafields.highlights ?? [])
        .map((h) => plainText(h, TEXT_LIMITS.highlight))
        .filter(Boolean),
      faq: (metafields.faq ?? [])
        .map((f) => ({
          question: plainText(f.question ?? "", TEXT_LIMITS.faqQuestion),
          answer: plainText(f.answer ?? "", TEXT_LIMITS.faqAnswer, true),
        }))
        .filter((f) => f.question && f.answer),
      guarantee: plainText(metafields.guarantee ?? "", TEXT_LIMITS.guarantee, true),
    },
  };
  // Keep optional keys absent rather than undefined.
  if (!out.seo) delete out.seo;
  if (!out.vendor) delete out.vendor;
  if (!out.productType) delete out.productType;
  return out;
}

/* ------------------------------- Validation -------------------------------- */

export function parseDraftInput(input: ShopifyDraftProductInput): ParsedDraft {
  const parsed = shopifyDraftProductInputSchema.safeParse(sanitizeDraftInput(input));
  if (!parsed.success) {
    throw shopifyError("invalid_input", `Invalid product input: ${parsed.error.message}`, {
      retryable: false,
    });
  }
  const p = parsed.data;
  const seen = new Set<string>();
  for (const v of p.variants) {
    if (v.optionValues.length !== p.options.length) {
      throw shopifyError("invalid_input", "Each variant needs one value per option.", {
        retryable: false,
      });
    }
    v.optionValues.forEach((value, i) => {
      if (!p.options[i]!.values.includes(value)) {
        throw shopifyError(
          "invalid_input",
          `Variant value "${value}" is not a value of option "${p.options[i]!.name}".`,
          { retryable: false },
        );
      }
    });
    const combo = JSON.stringify(v.optionValues);
    if (seen.has(combo)) {
      throw shopifyError("invalid_input", `Duplicate variant ${v.optionValues.join(" / ")}.`, {
        retryable: false,
      });
    }
    seen.add(combo);
  }
  if (p.options.length === 0 && p.variants.length > 1) {
    throw shopifyError("invalid_input", "A product without options has exactly one variant.", {
      retryable: false,
    });
  }
  return p;
}

/* ----------------------------- productSet input ---------------------------- */

const money = (value: number) => value.toFixed(2);
const singleLine = (value: string) => value.replace(/\s*\n+\s*/g, " ").trim();

function variantKey(pairs: { name: string; value: string }[]): string {
  return JSON.stringify(pairs.map((p) => [p.name, p.value]));
}

export type ProductSetVariables = {
  identifier?: { id: string } | { customId: { namespace: string; key: string; value: string } };
  input: Record<string, unknown>;
  synchronous: true;
};

/**
 * Variables for `productSet`. With `existing`, the call updates that product
 * (status untouched, handle untouched); without, it creates a DRAFT, upserting
 * on the custom ID when `idempotencyKey` is set.
 */
export function buildProductSetVariables(
  input: ShopifyDraftProductInput,
  existing: ExistingProduct | null = null,
): ProductSetVariables {
  const p = parseDraftInput(input);

  const options =
    p.options.length > 0
      ? p.options
      : [{ name: DEFAULT_OPTION.name, values: [DEFAULT_OPTION.value] }];

  const existingVariantIds = new Map(
    (existing?.variants ?? []).map((v) => [variantKey(v.selectedOptions), v.id]),
  );

  const variants = p.variants.map((v) => {
    const pairs =
      p.options.length > 0
        ? v.optionValues.map((value, i) => ({ name: p.options[i]!.name, value }))
        : [{ name: DEFAULT_OPTION.name, value: DEFAULT_OPTION.value }];
    const id = existingVariantIds.get(variantKey(pairs));
    return {
      ...(id ? { id } : {}),
      optionValues: pairs.map((pair) => ({ optionName: pair.name, name: pair.value })),
      price: money(v.price),
      compareAtPrice:
        v.compareAtPrice !== null && v.compareAtPrice > v.price ? money(v.compareAtPrice) : null,
      // Dropshipping: no stock is held, so the variant stays purchasable.
      inventoryItem: { tracked: false, ...(v.sku ? { sku: v.sku } : {}) },
    };
  });

  // Media: keep foreign media, reuse our images by marker, add the new ones.
  const ours = new Map<string, string>();
  const keep: { id: string }[] = [];
  for (const m of existing?.media ?? []) {
    const marker = m.url ? markerFromShopifyUrl(m.url) : null;
    if (marker) ours.set(marker, m.id);
    // An image still processing (no URL yet) is most likely ours from a run
    // that just timed out: drop it, it is sent again below.
    else if (m.mediaContentType === "IMAGE" && !m.url) continue;
    else keep.push({ id: m.id });
  }
  const urls = [...new Set(p.imageUrls)];
  const files = [
    ...urls.map((url) => {
      const id = ours.get(imageMarker(url));
      if (id) return { id };
      return {
        originalSource: url,
        filename: imageFilename(url),
        contentType: "IMAGE",
        alt: p.title,
      };
    }),
    ...keep,
  ];

  const metafields: { namespace: string; key: string; type: string; value: string }[] = [];
  const highlights = p.metafields.highlights.map(singleLine).filter(Boolean);
  if (highlights.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "highlights",
      type: "list.single_line_text_field",
      value: JSON.stringify(highlights),
    });
  }
  if (p.metafields.faq.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "faq",
      type: "json",
      value: JSON.stringify(p.metafields.faq),
    });
  }
  if (p.metafields.guarantee.trim()) {
    metafields.push({
      namespace: "custom",
      key: "guarantee",
      type: "multi_line_text_field",
      value: p.metafields.guarantee.trim(),
    });
  }
  // productSet replaces the metafield list: always resend the custom ID.
  if (p.idempotencyKey) {
    metafields.push({
      namespace: SHOPIFY_PRODUCT_ID_METAFIELD.namespace,
      key: SHOPIFY_PRODUCT_ID_METAFIELD.key,
      type: SHOPIFY_PRODUCT_ID_METAFIELD.type,
      value: p.idempotencyKey,
    });
  }

  const productInput: Record<string, unknown> = {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    seo: p.seo ?? seoFor(p.title, p.descriptionHtml),
    templateSuffix: p.templateSuffix,
    tags: p.tags,
    ...(p.vendor ? { vendor: p.vendor } : {}),
    ...(p.productType ? { productType: p.productType } : {}),
    productOptions: options.map((o, i) => ({
      name: o.name,
      position: i + 1,
      values: o.values.map((name) => ({ name })),
    })),
    variants,
    files,
    metafields,
    // Only on creation: never demote a product the merchant already published.
    ...(existing ? {} : { status: "DRAFT" }),
  };

  const identifier: ProductSetVariables["identifier"] = existing
    ? { id: existing.id }
    : p.idempotencyKey
      ? {
          customId: {
            namespace: SHOPIFY_PRODUCT_ID_METAFIELD.namespace,
            key: SHOPIFY_PRODUCT_ID_METAFIELD.key,
            value: p.idempotencyKey,
          },
        }
      : undefined;

  return { ...(identifier ? { identifier } : {}), input: productInput, synchronous: true };
}

/* ------------------------------ From PageCopy ------------------------------ */

/**
 * Builds the createDraftProduct input from the Copywriter's PageCopy and the
 * priced variants. Used by the workflow's "build page" step. The result is
 * already sanitized (see sanitizeDraftInput), so whatever the caller records
 * or stores from it is the safe version too.
 */
export function draftProductInputFromPageCopy(input: {
  /** Trendcart product id: makes re-runs update the same Shopify product. */
  productId: string;
  copy: PageCopy;
  templateSuffix: string | null;
  options: ShopifyDraftProductInput["options"];
  variants: ShopifyDraftProductInput["variants"];
  imageUrls: string[];
  vendor?: string;
  productType?: string;
  tags?: string[];
}): ShopifyDraftProductInput {
  return sanitizeDraftInput({
    idempotencyKey: input.productId,
    title: input.copy.title,
    descriptionHtml: input.copy.descriptionHtml,
    seo: input.copy.seo,
    templateSuffix: input.templateSuffix,
    vendor: input.vendor,
    productType: input.productType,
    tags: input.tags ?? ["trendcart"],
    options: input.options,
    variants: input.variants,
    imageUrls: input.imageUrls,
    metafields: {
      highlights: input.copy.highlights,
      faq: input.copy.faq,
      guarantee: input.copy.guarantee,
    },
  });
}
