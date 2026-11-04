/**
 * Generated product templates (pure).
 *
 * A generated template = the base template's main product section (gallery,
 * title, price, variant picker, buy buttons: kept, so the theme's buy box and
 * checkout keep working) with the CRO blocks Claude adds to it, followed by
 * the sections Claude planned, built only from the live theme's own sections
 * (sections/*.liquid {% schema %}), so the page keeps the theme's look.
 *
 * Every planned value is checked against the schema before it is written:
 * unknown sections, blocks and settings are dropped, select values must be one
 * of the options, numbers are clamped, text is plain (rich text is rebuilt
 * from plain paragraphs), links only point to this product or the catalogue,
 * colour schemes must exist in the theme, images only reference this product's
 * photos (and only when allowed). Text settings Claude leaves out are set to ""
 * so no theme placeholder label ("Image with text", "Button label") remains.
 */
import type {
  TemplatePlan,
  ThemeColorScheme,
  ThemeSectionSpec,
  ThemeSettingSpec,
} from "@/lib/domain/contracts";

import { plainText } from "./product-input";

/** Generated templates are product.tc-<id>.json: Trendcart never writes any other. */
export const GENERATED_TEMPLATE_PREFIX = "tc-";

export function generatedTemplateSuffix(productId: string): string {
  const id = productId
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(-40);
  return `${GENERATED_TEMPLATE_PREFIX}${id || "page"}`;
}

export const isGeneratedTemplateSuffix = (suffix: string) =>
  suffix.startsWith(GENERATED_TEMPLATE_PREFIX) && /^[a-z0-9_-]{4,100}$/.test(suffix);

/* ----------------------------- Section schemas ----------------------------- */

const SCHEMA_TAG = /{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/;
const FILLABLE = new Set<ThemeSettingSpec["type"]>([
  "text",
  "textarea",
  "richtext",
  "inline_richtext",
  "select",
  "radio",
  "checkbox",
  "range",
  "number",
  "url",
  "color_scheme",
  "image_picker",
]);
const MEDIA = new Set([
  "image_picker",
  "video",
  "video_url",
  "product",
  "product_list",
  "collection",
]);
/** Text settings: blanked when not written, so no theme placeholder stays visible. */
const TEXT_TYPES = new Set<ThemeSettingSpec["type"]>([
  "text",
  "textarea",
  "richtext",
  "inline_richtext",
]);
/** Buy box blocks never added: raw code, apps, or blocks that need other resources. */
const UNSAFE_MAIN_BLOCKS =
  /^(@|custom_liquid|liquid|html|app|complementary|related|rating|reviews?|share|popup|sku|inventory|quantity_selector|variant_picker|buy_buttons|price|title|vendor)$/;

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** "t:sections.rich_text.name" is a translation key: show a readable fallback. */
function label(value: unknown, fallback: string): string {
  const s = str(value).trim();
  if (s && !s.startsWith("t:")) return s.slice(0, 120);
  return fallback.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function settingSpecs(raw: unknown): { settings: ThemeSettingSpec[]; media: boolean } {
  const settings: ThemeSettingSpec[] = [];
  let media = false;
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!isObject(s)) continue;
    const type = str(s.type);
    if (MEDIA.has(type)) media = true;
    const id = str(s.id);
    if (!id || !FILLABLE.has(type as ThemeSettingSpec["type"])) continue;
    const options = Array.isArray(s.options)
      ? s.options.flatMap((o) => (isObject(o) && typeof o.value === "string" ? [o.value] : []))
      : undefined;
    settings.push({
      id,
      type: type as ThemeSettingSpec["type"],
      label: label(s.label, id),
      ...(options?.length ? { options } : {}),
      ...(num(s.min) !== undefined ? { min: num(s.min) } : {}),
      ...(num(s.max) !== undefined ? { max: num(s.max) } : {}),
      ...(num(s.step) !== undefined ? { step: num(s.step) } : {}),
    });
  }
  return { settings, media };
}

const listIncludes = (v: unknown, x: string) => Array.isArray(v) && v.includes(x);

function parseSchema(liquid: string): JsonObject | null {
  const body = SCHEMA_TAG.exec(liquid)?.[1];
  if (!body) return null;
  try {
    const schema: unknown = JSON.parse(body);
    return isObject(schema) ? schema : null;
  } catch {
    return null;
  }
}

function blockSpecs(schema: JsonObject, exclude?: RegExp) {
  let media = false;
  const blocks: ThemeSectionSpec["blocks"] = [];
  for (const b of Array.isArray(schema.blocks) ? schema.blocks : []) {
    if (!isObject(b)) continue;
    const blockType = str(b.type);
    if (!blockType || blockType.startsWith("@") || exclude?.test(blockType)) continue;
    const parsed = settingSpecs(b.settings);
    media ||= parsed.media;
    const limit = num(b.limit);
    blocks.push({
      type: blockType,
      name: label(b.name, blockType),
      settings: parsed.settings,
      ...(limit && limit > 0 ? { limit: Math.floor(limit) } : {}),
    });
  }
  return { blocks, media };
}

/**
 * The section spec of one sections/<type>.liquid file, or null when it cannot
 * go into a product template: no schema, no preset (not meant to be added),
 * restricted to other templates or to header/footer groups, a main section
 * (the base template's main section is kept instead), or nothing to fill.
 */
export function parseSectionSchema(filename: string, liquid: string): ThemeSectionSpec | null {
  const type = /^sections\/([A-Za-z0-9_-]+)\.liquid$/.exec(filename)?.[1];
  if (!type || type.startsWith("main-")) return null;
  const schema = parseSchema(liquid);
  if (!schema || !Array.isArray(schema.presets) || schema.presets.length === 0) return null;
  const enabled = isObject(schema.enabled_on) ? schema.enabled_on : null;
  const disabled = isObject(schema.disabled_on) ? schema.disabled_on : null;
  if (enabled?.groups && !enabled.templates) return null;
  if (
    enabled?.templates &&
    !listIncludes(enabled.templates, "product") &&
    !listIncludes(enabled.templates, "*")
  ) {
    return null;
  }
  if (listIncludes(disabled?.templates, "product") || listIncludes(disabled?.templates, "*")) {
    return null;
  }

  const own = settingSpecs(schema.settings);
  const { blocks, media } = blockSpecs(schema);
  if (own.settings.length === 0 && !blocks.some((b) => b.settings.length > 0)) return null;
  const maxBlocks = num(schema.max_blocks);
  return {
    type,
    name: label(schema.name, type),
    settings: own.settings,
    blocks,
    ...(maxBlocks && maxBlocks > 0 ? { maxBlocks: Math.floor(maxBlocks) } : {}),
    hasMediaSettings: own.media || media,
  };
}

/**
 * The blocks Trendcart may add to the theme's main product section (text,
 * collapsible tabs, icons with text...): never raw code, apps, or the buy box
 * essentials that are already there.
 */
export function parseMainSectionSchema(filename: string, liquid: string): ThemeSectionSpec | null {
  const type = /^sections\/([A-Za-z0-9_-]+)\.liquid$/.exec(filename)?.[1];
  if (!type || !isMainProductSection(type)) return null;
  const schema = parseSchema(liquid);
  if (!schema) return null;
  const { blocks, media } = blockSpecs(schema, UNSAFE_MAIN_BLOCKS);
  const usable = blocks.filter((b) => b.settings.some((s) => TEXT_TYPES.has(s.type)));
  if (usable.length === 0) return null;
  return {
    type,
    name: label(schema.name, type),
    settings: [],
    blocks: usable,
    hasMediaSettings: media,
  };
}

/** Usable sections of a theme from its section files, sorted by type. */
export function sectionCatalog(
  files: readonly { filename: string; content: string }[],
): ThemeSectionSpec[] {
  return files
    .map((f) => parseSectionSchema(f.filename, f.content))
    .filter((s): s is ThemeSectionSpec => s !== null)
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Color schemes from config/settings_data.json (current.color_schemes). */
export function colorSchemesFromSettings(settingsData: JsonObject | null): ThemeColorScheme[] {
  const current = settingsData && isObject(settingsData.current) ? settingsData.current : null;
  const schemes = current && isObject(current.color_schemes) ? current.color_schemes : null;
  if (!schemes) return [];
  return Object.entries(schemes)
    .slice(0, 20)
    .map(([id, scheme]) => {
      const s = isObject(scheme) && isObject(scheme.settings) ? scheme.settings : {};
      const color = (key: string) => (typeof s[key] === "string" ? (s[key] as string) : null);
      return { id, background: color("background"), text: color("text"), button: color("button") };
    });
}

/* ------------------------------ Template JSON ------------------------------ */

/** The theme's main product section (Dawn "main-product", Horizon "product-information"...). */
export function isMainProductSection(type: string): boolean {
  return /^main-product|^product-information$|^main-product-/.test(type);
}

const MAX_SECTIONS = 12;
const MAX_BLOCKS = 16;
const MAX_MAIN_BLOCKS = 8;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rich text from plain paragraphs; lines starting with "- " become a list. */
function richText(value: string): string {
  const parts: string[] = [];
  for (const para of value.split(/\n\s*\n/)) {
    const lines = para
      .split("\n")
      .map((l) => plainText(l, 600))
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^[-•*]\s+/.test(l))) {
      parts.push(
        `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^[-•*]\s+/, ""))}</li>`).join("")}</ul>`,
      );
    } else {
      parts.push(`<p>${escapeHtml(lines.join(" "))}</p>`);
    }
  }
  return parts.join("");
}

/** What values may point to: this product, its photos, the theme's color schemes. */
export type BuildContext = {
  /** Product handle once the draft exists (links to "product"). */
  productHandle: string | null;
  colorSchemes: readonly string[];
  /** shopify://shop_images/<filename> of the product photos; null = images not allowed. */
  images: readonly string[] | null;
};

const NO_CONTEXT: BuildContext = { productHandle: null, colorSchemes: [], images: null };

/** A planned value checked against its setting spec, or undefined to drop it. */
export function settingValue(
  spec: ThemeSettingSpec,
  raw: string,
  ctx: BuildContext = NO_CONTEXT,
): string | number | boolean | undefined {
  const value = raw.trim();
  switch (spec.type) {
    case "text":
      return plainText(value.replace(/\s*\n\s*/g, " "), 250) || undefined;
    case "inline_richtext":
      return escapeHtml(plainText(value.replace(/\s*\n\s*/g, " "), 400)) || undefined;
    case "textarea":
      return plainText(value, 1500, true) || undefined;
    case "richtext":
      return richText(value) || undefined;
    case "select":
    case "radio":
      return spec.options?.includes(value) ? value : undefined;
    case "checkbox":
      return value === "true" ? true : value === "false" ? false : undefined;
    case "range":
    case "number": {
      const n = Number(value.replace(",", "."));
      if (!Number.isFinite(n)) return undefined;
      let v = n;
      if (spec.min !== undefined) v = Math.max(spec.min, v);
      if (spec.max !== undefined) v = Math.min(spec.max, v);
      if (spec.type === "range" && spec.step && spec.min !== undefined) {
        v = spec.min + Math.round((v - spec.min) / spec.step) * spec.step;
      }
      return Math.round(v * 1000) / 1000;
    }
    case "url":
      if (value === "product" && ctx.productHandle) {
        return `shopify://products/${ctx.productHandle}`;
      }
      if (value === "all_products") return "shopify://collections/all";
      return undefined;
    case "color_scheme":
      return ctx.colorSchemes.includes(value) ? value : undefined;
    case "image_picker": {
      const index = /^image:(\d+)$/.exec(value)?.[1];
      if (!ctx.images || index === undefined) return undefined;
      return ctx.images[Number(index)];
    }
  }
}

function buildSettings(
  specs: readonly ThemeSettingSpec[],
  planned: readonly { id: string; value: string }[],
  isUnsafe: (text: string) => boolean,
  ctx: BuildContext,
  nextImage: () => string | undefined,
): JsonObject {
  const out: JsonObject = {};
  for (const p of planned) {
    const spec = specs.find((s) => s.id === p.id);
    if (!spec || p.id in out) continue;
    const value = settingValue(spec, p.value, ctx);
    if (value === undefined) continue;
    if (typeof value === "string" && TEXT_TYPES.has(spec.type)) {
      if (isUnsafe(value.replace(/<[^>]*>/g, " "))) continue;
    }
    out[p.id] = value;
  }
  for (const spec of specs) {
    if (spec.id in out) continue;
    // No theme placeholder text ("Image with text", "Button label") on the page.
    if (TEXT_TYPES.has(spec.type)) out[spec.id] = "";
    // Images allowed: an image setting left out gets the next product photo.
    else if (spec.type === "image_picker" && ctx.images) {
      const image = nextImage();
      if (image) out[spec.id] = image;
    }
  }
  return out;
}

export type GeneratedTemplate = {
  template: JsonObject;
  sections: { type: string; name: string; purpose: string }[];
};

const POSITION_ANCHOR: Record<string, RegExp> = {
  after_title: /title/,
  after_price: /price/,
  before_buy_buttons: /buy_buttons|buy-buttons|add_to_cart|buy-button/,
  after_buy_buttons: /buy_buttons|buy-buttons|add_to_cart|buy-button/,
};

/** The base main section with the planned buy box blocks inserted at their positions. */
function withMainBlocks(
  section: JsonObject,
  plan: TemplatePlan,
  mainSpec: ThemeSectionSpec | null,
  isUnsafe: (text: string) => boolean,
  ctx: BuildContext,
  nextImage: () => string | undefined,
): JsonObject {
  if (!mainSpec || plan.mainBlocks.length === 0) return section;
  const blocks: JsonObject = isObject(section.blocks) ? { ...section.blocks } : {};
  const order = Array.isArray(section.block_order)
    ? section.block_order.filter((x): x is string => typeof x === "string")
    : Object.keys(blocks);
  const typeOf = (id: string) => {
    const b = blocks[id];
    return isObject(b) ? str(b.type) : "";
  };
  const counts = new Map<string, number>();
  for (const id of order) counts.set(typeOf(id), (counts.get(typeOf(id)) ?? 0) + 1);

  let added = 0;
  for (const pb of plan.mainBlocks) {
    if (added >= MAX_MAIN_BLOCKS) break;
    const spec = mainSpec.blocks.find((b) => b.type === pb.type);
    if (!spec) continue;
    const count = counts.get(pb.type) ?? 0;
    if (spec.limit !== undefined && count >= spec.limit) continue;
    const settings = buildSettings(spec.settings, pb.settings, isUnsafe, ctx, nextImage);
    const hasText = spec.settings.some((s) => TEXT_TYPES.has(s.type) && settings[s.id] !== "");
    if (!hasText) continue;
    const id = `tc_${pb.type.replace(/[^A-Za-z0-9_]/g, "_")}_${added + 1}`;
    blocks[id] = { type: pb.type, settings };
    const anchor = POSITION_ANCHOR[pb.position];
    const at = anchor ? order.findIndex((b) => anchor.test(typeOf(b))) : -1;
    if (at === -1) order.push(id);
    else order.splice(pb.position === "before_buy_buttons" ? at : at + 1, 0, id);
    counts.set(pb.type, count + 1);
    added++;
  }
  return { ...section, blocks, block_order: order };
}

/**
 * The generated template: the base template's main product section(s) first
 * (with the planned buy box blocks), then the planned sections that exist in
 * the theme, with validated settings and blocks. Throws when the base template
 * has no main product section, or when nothing of the plan is usable.
 */
export function buildGeneratedTemplate(
  base: JsonObject,
  plan: TemplatePlan,
  catalog: readonly ThemeSectionSpec[],
  isUnsafe: (text: string) => boolean = () => false,
  options: { mainSection?: ThemeSectionSpec | null; context?: BuildContext } = {},
): GeneratedTemplate {
  const ctx = options.context ?? NO_CONTEXT;
  let imageIndex = 0;
  const nextImage = () =>
    ctx.images && ctx.images.length > 0 ? ctx.images[imageIndex++ % ctx.images.length] : undefined;

  const baseSections = isObject(base.sections) ? base.sections : {};
  const baseOrder = Array.isArray(base.order)
    ? base.order.filter((x): x is string => typeof x === "string")
    : Object.keys(baseSections);
  const mainIds = baseOrder.filter((id) => {
    const s = baseSections[id];
    return isObject(s) && typeof s.type === "string" && isMainProductSection(s.type);
  });
  if (mainIds.length === 0) {
    throw new Error("The base template has no main product section.");
  }

  const sections: JsonObject = {};
  const order: string[] = [];
  mainIds.forEach((id, i) => {
    const section = baseSections[id] as JsonObject;
    sections[id] =
      i === 0
        ? withMainBlocks(section, plan, options.mainSection ?? null, isUnsafe, ctx, nextImage)
        : section;
    order.push(id);
  });

  const summary: GeneratedTemplate["sections"] = [];
  plan.sections.slice(0, MAX_SECTIONS).forEach((planned, i) => {
    const spec = catalog.find((s) => s.type === planned.type);
    if (!spec) return;
    const settings = buildSettings(spec.settings, planned.settings, isUnsafe, ctx, nextImage);
    const blocks: JsonObject = {};
    const blockOrder: string[] = [];
    const perType = new Map<string, number>();
    const maxBlocks = Math.min(spec.maxBlocks ?? MAX_BLOCKS, MAX_BLOCKS);
    for (const pb of planned.blocks) {
      if (blockOrder.length >= maxBlocks) break;
      const blockSpec = spec.blocks.find((b) => b.type === pb.type);
      if (!blockSpec) continue;
      const count = perType.get(pb.type) ?? 0;
      if (blockSpec.limit !== undefined && count >= blockSpec.limit) continue;
      const blockSettings = buildSettings(
        blockSpec.settings,
        pb.settings,
        isUnsafe,
        ctx,
        nextImage,
      );
      const written = Object.values(blockSettings).some((v) => v !== "");
      if (!written && blockSpec.settings.length > 0) continue;
      perType.set(pb.type, count + 1);
      const id = `${pb.type.replace(/[^A-Za-z0-9_]/g, "_")}_${blockOrder.length + 1}`;
      blocks[id] = { type: pb.type, settings: blockSettings };
      blockOrder.push(id);
    }
    const written = Object.values(settings).some((v) => v !== "");
    if (!written && blockOrder.length === 0) return;
    const id = `tc_${i + 1}_${spec.type.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 60);
    sections[id] = {
      type: spec.type,
      settings,
      ...(blockOrder.length ? { blocks, block_order: blockOrder } : {}),
    };
    order.push(id);
    summary.push({
      type: spec.type,
      name: spec.name,
      purpose: plainText(planned.purpose, 300),
    });
  });
  if (summary.length === 0) throw new Error("No planned section exists in the theme.");

  const template: JsonObject = { sections, order };
  if (typeof base.layout === "string" || base.layout === false) template.layout = base.layout;
  if (typeof base.wrapper === "string") template.wrapper = base.wrapper;
  return { template, sections: summary };
}
