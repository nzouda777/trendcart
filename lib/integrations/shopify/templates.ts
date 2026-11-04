/**
 * Product template discovery helpers (pure).
 *
 * Online Store 2.0 themes store product templates as JSON:
 *   templates/product.json          -> default template (suffix null)
 *   templates/product.trendcart.json -> suffix "trendcart"
 * Liquid templates (product.*.liquid, vintage themes) are not supported in v1.
 */
import {
  templateSlotTypeSchema,
  type ProductTemplateStructure,
  type TemplateSlot,
} from "@/lib/domain/contracts";

const PRODUCT_TEMPLATE = /^templates\/product(?:\.([A-Za-z0-9_-]+))?\.json$/;

/** Suffix for one theme filename, `undefined` when it is not a product JSON template. */
export function templateSuffixFromFilename(filename: string): string | null | undefined {
  const match = PRODUCT_TEMPLATE.exec(filename);
  if (!match) return undefined;
  return match[1] ?? null;
}

/** Theme filename of a product template suffix (null = default). */
export function templateFilename(suffix: string | null): string {
  return suffix === null ? "templates/product.json" : `templates/product.${suffix}.json`;
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

/* ------------------------- Template content structure ----------------------- */

/**
 * A product JSON template (Online Store 2.0):
 *   { "sections": { "<id>": { "type", "name"?, "disabled"?, "settings",
 *     "blocks": { "<id>": { "type", "settings", "blocks"? } }, "block_order" } },
 *     "order": [...] }
 * Shopify prepends an auto-generated `/* ... *\/` comment to edited templates.
 * Section and block settings bind product metafields with dynamic sources:
 * "{{ product.metafields.custom.care.value }}" (or closest.product... in
 * theme blocks). Those are the content slots Trendcart fills.
 */

/** Metafields Trendcart always fills or owns: never offered as template slots. */
const RESERVED_METAFIELDS = new Set(["custom.highlights", "custom.faq", "custom.guarantee"]);
const RESERVED_NAMESPACES = new Set(["trendcart"]);

const METAFIELD_REF = /product\.metafields\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g;
/** Setting ids whose static value says what a section is about. */
const CONTEXT_SETTING = /(heading|title|text|label|caption|subheading|content)/i;

const MAX_SLOTS = 30;
const MAX_OUTLINE = 60;
const MAX_CONTEXT = 6;

export type MetafieldDefinitionInfo = {
  namespace: string;
  key: string;
  name: string;
  description: string | null;
  type: string;
};

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses a template file body, tolerating Shopify's leading comment. Null when not JSON. */
export function parseTemplateJson(content: string): JsonObject | null {
  const body = content.replace(/^﻿/, "").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  try {
    const parsed: unknown = JSON.parse(body);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const plain = (s: string, max: number) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Entries of a sections / blocks map in their declared order (unknown ids last). */
function ordered(map: unknown, order: unknown): [string, JsonObject][] {
  if (!isObject(map)) return [];
  const ids = Array.isArray(order) ? order.filter((x): x is string => typeof x === "string") : [];
  const keys = [...new Set([...ids.filter((id) => id in map), ...Object.keys(map)])];
  return keys.flatMap((k) =>
    isObject(map[k]) ? [[k, map[k] as JsonObject] as [string, JsonObject]] : [],
  );
}

type Ref = { namespace: string; key: string; usedIn: string[]; sectionIndex: number };

/**
 * Pure: the content structure of a parsed product template, typed with the
 * store's product metafield definitions. Text metafields become slots (template
 * order); other types and refs without a definition are listed as skipped.
 * Disabled sections and blocks are ignored.
 */
export function buildTemplateStructure(
  suffix: string | null,
  template: JsonObject,
  definitions: readonly MetafieldDefinitionInfo[],
): ProductTemplateStructure {
  const refs = new Map<string, Ref>();
  const contextBySection: string[][] = [];
  const outline: string[] = [];

  const visitSettings = (
    settings: unknown,
    where: string,
    sectionIndex: number,
    context: string[],
  ) => {
    if (!isObject(settings)) return;
    for (const [id, value] of Object.entries(settings)) {
      if (typeof value !== "string") continue;
      let found = false;
      for (const m of value.matchAll(METAFIELD_REF)) {
        found = true;
        const ref = `${m[1]}.${m[2]}`;
        const entry = refs.get(ref) ?? {
          namespace: m[1]!,
          key: m[2]!,
          usedIn: [],
          sectionIndex,
        };
        const place = `${where} › ${id}`.slice(0, 300);
        if (!entry.usedIn.includes(place) && entry.usedIn.length < 10) entry.usedIn.push(place);
        refs.set(ref, entry);
      }
      if (!found && !value.includes("{{") && CONTEXT_SETTING.test(id)) {
        const text = plain(value, 200);
        if (text.length >= 3 && !/^(#|https?:|shopify:)/i.test(text) && !context.includes(text)) {
          context.push(text);
        }
      }
    }
  };

  const visitBlocks = (
    blocks: unknown,
    order: unknown,
    where: string,
    sectionIndex: number,
    context: string[],
    types: string[],
  ) => {
    for (const [, block] of ordered(blocks, order)) {
      if (block.disabled === true) continue;
      const type = typeof block.type === "string" ? block.type : "block";
      types.push(type);
      const label = `${where} › ${typeof block.name === "string" ? block.name : type}`;
      visitSettings(block.settings, label, sectionIndex, context);
      visitBlocks(block.blocks, block.block_order, label, sectionIndex, context, types);
    }
  };

  ordered(template.sections, template.order).forEach(([, section], sectionIndex) => {
    if (section.disabled === true) {
      contextBySection.push([]);
      return;
    }
    const type = typeof section.type === "string" ? section.type : "section";
    const label = typeof section.name === "string" ? `${section.name} (${type})` : type;
    const context: string[] = [];
    const types: string[] = [];
    visitSettings(section.settings, label, sectionIndex, context);
    visitBlocks(section.blocks, section.block_order, label, sectionIndex, context, types);
    contextBySection.push(context);
    if (outline.length < MAX_OUTLINE) {
      const blocks = [...new Set(types)].join(", ");
      outline.push((blocks ? `${label}: ${blocks}` : label).slice(0, 300));
    }
  });

  const byRef = new Map(definitions.map((d) => [`${d.namespace}.${d.key}`, d]));
  const slots: TemplateSlot[] = [];
  const skipped: ProductTemplateStructure["skipped"] = [];
  for (const [ref, r] of refs) {
    if (RESERVED_METAFIELDS.has(ref) || RESERVED_NAMESPACES.has(r.namespace)) continue;
    const def = byRef.get(ref);
    const type = templateSlotTypeSchema.safeParse(def?.type);
    if (!def || !type.success || slots.length >= MAX_SLOTS) {
      if (skipped.length < 50) {
        skipped.push({ namespace: r.namespace, key: r.key, type: def?.type ?? "undefined" });
      }
      continue;
    }
    slots.push({
      namespace: r.namespace,
      key: r.key,
      type: type.data,
      name: plain(def.name || r.key, 255) || r.key,
      description: def.description ? plain(def.description, 500) || null : null,
      usedIn: r.usedIn,
      context: (contextBySection[r.sectionIndex] ?? []).slice(0, MAX_CONTEXT),
    });
  }
  return { suffix, outline, slots, skipped };
}
