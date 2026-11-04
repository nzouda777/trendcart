import { describe, expect, it } from "vitest";

import {
  buildTemplateStructure,
  parseTemplateJson,
  parseTemplateSuffixes,
  templateSuffixFromFilename,
  type MetafieldDefinitionInfo,
} from "./templates";

describe("product template discovery", () => {
  it("maps filenames to suffixes", () => {
    expect(templateSuffixFromFilename("templates/product.json")).toBeNull();
    expect(templateSuffixFromFilename("templates/product.trendcart.json")).toBe("trendcart");
    expect(templateSuffixFromFilename("templates/product.pre-order_v2.json")).toBe("pre-order_v2");
  });

  it("ignores non product JSON templates", () => {
    for (const name of [
      "templates/products-legacy.json",
      "templates/product.liquid",
      "templates/product.alt.liquid",
      "templates/collection.json",
      "templates/customers/product.json",
      "sections/product.json",
      "templates/product..json",
      "templates/product.a.b.json",
    ]) {
      expect(templateSuffixFromFilename(name)).toBeUndefined();
    }
  });

  it("dedupes, puts the default first and sorts the rest", () => {
    expect(
      parseTemplateSuffixes([
        "templates/product.trendcart.json",
        "templates/product.bundle.json",
        "templates/product.json",
        "templates/product.trendcart.json",
        "templates/index.json",
      ]),
    ).toEqual([null, "bundle", "trendcart"]);
  });

  it("returns only alternates when the default JSON template is missing", () => {
    expect(parseTemplateSuffixes(["templates/product.b.json", "templates/product.a.json"])).toEqual(
      ["a", "b"],
    );
    expect(parseTemplateSuffixes([])).toEqual([]);
  });
});

describe("product template content structure", () => {
  const defs: MetafieldDefinitionInfo[] = [
    {
      namespace: "custom",
      key: "tagline",
      name: "Tagline",
      description: null,
      type: "single_line_text_field",
    },
    {
      namespace: "custom",
      key: "usage",
      name: "Usage",
      description: "How to use it",
      type: "multi_line_text_field",
    },
    {
      namespace: "custom",
      key: "size_chart",
      name: "Size chart",
      description: null,
      type: "file_reference",
    },
    {
      namespace: "custom",
      key: "highlights",
      name: "Highlights",
      description: null,
      type: "list.single_line_text_field",
    },
  ];

  it("parses Shopify's commented JSON and finds dynamic sources in sections and nested blocks", () => {
    const json = parseTemplateJson(`/*
 * IMPORTANT: The contents of this file are auto-generated.
 */
{
  "sections": {
    "hidden": { "type": "rich-text", "disabled": true,
      "settings": { "text": "{{ product.metafields.custom.ghost }}" } },
    "story": {
      "type": "rich-text", "name": "Story",
      "settings": { "heading": "<p>Why it works</p>" },
      "blocks": {
        "b1": { "type": "group", "blocks": {
          "inner": { "type": "text", "settings": { "text": "{{ closest.product.metafields.custom.usage.value }}" } }
        } },
        "b2": { "type": "text", "settings": { "text": "{{ product.metafields.custom.tagline }}" } }
      },
      "block_order": ["b2", "b1"]
    },
    "extra": { "type": "image", "settings": {
      "image": "{{ product.metafields.custom.size_chart.value }}",
      "caption": "{{ product.metafields.custom.highlights.value }} {{ product.metafields.trendcart.product_id }}"
    } }
  },
  "order": ["story", "hidden", "extra"]
}`);
    expect(json).not.toBeNull();
    const s = buildTemplateStructure("landing", json!, defs);
    expect(s.slots.map((x) => x.key)).toEqual(["tagline", "usage"]); // block_order respected
    expect(s.slots[1]).toMatchObject({
      type: "multi_line_text_field",
      description: "How to use it",
      context: ["Why it works"],
      usedIn: ["Story (rich-text) › group › text › text"],
    });
    // Non-text types are skipped; our own keys and disabled sections are ignored.
    expect(s.skipped).toEqual([{ namespace: "custom", key: "size_chart", type: "file_reference" }]);
    expect(s.outline[0]).toBe("Story (rich-text): text, group");
  });

  it("returns null for a body that is not a JSON object", () => {
    expect(parseTemplateJson("{% layout none %}")).toBeNull();
    expect(parseTemplateJson("[1, 2]")).toBeNull();
  });
});
