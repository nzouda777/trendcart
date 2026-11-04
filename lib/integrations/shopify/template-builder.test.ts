import { describe, expect, it } from "vitest";

import type { TemplatePlan } from "@/lib/domain/contracts";

import {
  buildGeneratedTemplate,
  generatedTemplateSuffix,
  isGeneratedTemplateSuffix,
  parseMainSectionSchema,
  parseSectionSchema,
  settingValue,
} from "./template-builder";

const liquid = (schema: unknown) =>
  `<div></div>{%- schema -%}${JSON.stringify(schema)}{%- endschema -%}`;

const MULTI = parseSectionSchema(
  "sections/multicolumn.liquid",
  liquid({
    name: "t:sections.multicolumn.name",
    max_blocks: 2,
    settings: [
      { type: "inline_richtext", id: "title", label: "Heading" },
      {
        type: "select",
        id: "align",
        label: "Align",
        options: [{ value: "left" }, { value: "center" }],
      },
      { type: "range", id: "columns", label: "Columns", min: 1, max: 4, step: 1 },
      { type: "color", id: "bg", label: "Background" },
    ],
    blocks: [
      {
        type: "column",
        name: "Column",
        settings: [
          { type: "image_picker", id: "image", label: "Image" },
          { type: "richtext", id: "text", label: "Text" },
        ],
      },
      { type: "@app" },
    ],
    presets: [{ name: "Multicolumn" }],
  }),
)!;

const BASE = {
  sections: {
    main: { type: "main-product", blocks: { buy: { type: "buy_buttons" } }, block_order: ["buy"] },
    old: { type: "rich-text", settings: {} },
  },
  order: ["main", "old"],
  layout: "theme",
};

describe("theme section schemas", () => {
  it("keeps fillable settings and blocks, flags media, readable names", () => {
    expect(MULTI).toMatchObject({
      type: "multicolumn",
      name: "Multicolumn",
      maxBlocks: 2,
      hasMediaSettings: true,
      settings: [
        { id: "title", type: "inline_richtext" },
        { id: "align", type: "select", options: ["left", "center"] },
        { id: "columns", type: "range", min: 1, max: 4 },
      ],
      blocks: [
        {
          type: "column",
          settings: [
            { id: "image", type: "image_picker" },
            { id: "text", type: "richtext" },
          ],
        },
      ],
    });
  });

  it("skips main sections, sections without preset, header groups and other templates", () => {
    const base = { settings: [{ type: "text", id: "t", label: "T" }], presets: [{ name: "x" }] };
    const parse = (schema: unknown, file = "sections/a.liquid") =>
      parseSectionSchema(file, liquid(schema));
    expect(parse(base, "sections/main-product.liquid")).toBeNull();
    expect(parse({ ...base, presets: [] })).toBeNull();
    expect(parse({ ...base, enabled_on: { groups: ["header"] } })).toBeNull();
    expect(parse({ ...base, enabled_on: { templates: ["index"] } })).toBeNull();
    expect(parse({ ...base, disabled_on: { templates: ["product"] } })).toBeNull();
    expect(parse(base)).not.toBeNull();
    expect(
      parseSectionSchema("sections/a.liquid", "{% schema %}not json{% endschema %}"),
    ).toBeNull();
  });
});

describe("generated template", () => {
  it("keeps the base buy box, validates every planned value and drops the unknown", () => {
    const plan: TemplatePlan = {
      mainBlocks: [],
      sections: [
        { type: "unknown-section", purpose: "x", settings: [{ id: "a", value: "b" }], blocks: [] },
        {
          type: "multicolumn",
          purpose: "Key benefits",
          settings: [
            { id: "title", value: "Why <b>you</b> will love it" },
            { id: "align", value: "right" }, // not an option
            { id: "columns", value: "9" }, // clamped to max
            { id: "bg", value: "#000" }, // not fillable
          ],
          blocks: [
            { type: "column", settings: [{ id: "text", value: "Warm light\n\n- Easy\n- Quiet" }] },
            {
              type: "column",
              settings: [{ id: "text", value: "Best seller, loved by thousands" }],
            },
            { type: "column", settings: [{ id: "text", value: "Fits any room" }] },
            { type: "column", settings: [{ id: "text", value: "Too many" }] },
          ],
        },
      ],
    };
    const unsafe = (t: string) => /best seller/i.test(t);
    const { template, sections } = buildGeneratedTemplate(BASE, plan, [MULTI], unsafe);
    expect(template.order).toEqual(["main", "tc_2_multicolumn"]);
    expect(template.layout).toBe("theme");
    const multi = (template.sections as Record<string, Record<string, unknown>>).tc_2_multicolumn!;
    expect(multi.settings).toEqual({ title: "Why you will love it", columns: 4 });
    // The unsafe column is dropped and max_blocks (2) is respected.
    expect(multi.block_order).toEqual(["column_1", "column_2"]);
    const blocks = multi.blocks as Record<string, { settings: { text: string } }>;
    expect(blocks.column_1!.settings.text).toBe(
      "<p>Warm light</p><ul><li>Easy</li><li>Quiet</li></ul>",
    );
    expect(blocks.column_2!.settings.text).toBe("<p>Fits any room</p>");
    expect(sections).toEqual([
      { type: "multicolumn", name: "Multicolumn", purpose: "Key benefits" },
    ]);
  });

  it("blanks unwritten labels, links buttons to the product, adds buy box blocks, uses photos only when allowed", () => {
    const section = parseSectionSchema(
      "sections/image-with-text.liquid",
      liquid({
        name: "Image with text",
        settings: [
          { type: "image_picker", id: "image", label: "Image" },
          { type: "text", id: "subheading", label: "Subheading", default: "Subheading" },
          { type: "text", id: "button_label", label: "Button label", default: "Button label" },
          { type: "url", id: "button_link", label: "Link" },
          { type: "color_scheme", id: "color_scheme", label: "Scheme" },
        ],
        presets: [{ name: "Image with text" }],
      }),
    )!;
    const main = parseMainSectionSchema(
      "sections/main-product.liquid",
      liquid({
        name: "Product",
        blocks: [
          { type: "price", name: "Price" },
          { type: "buy_buttons", name: "Buy buttons" },
          {
            type: "custom_liquid",
            name: "Liquid",
            settings: [{ type: "liquid", id: "l", label: "L" }],
          },
          {
            type: "text",
            name: "Text",
            settings: [{ type: "inline_richtext", id: "text", label: "Text" }],
          },
        ],
      }),
    )!;
    expect(main.blocks.map((b) => b.type)).toEqual(["text"]);

    const base = {
      sections: {
        main: {
          type: "main-product",
          blocks: { p: { type: "price" }, b: { type: "buy_buttons" } },
          block_order: ["p", "b"],
        },
      },
      order: ["main"],
    };
    const plan: TemplatePlan = {
      mainBlocks: [
        {
          type: "text",
          position: "after_price",
          settings: [{ id: "text", value: "Glow all night" }],
        },
        { type: "custom_liquid", position: "end", settings: [{ id: "l", value: "{{ x }}" }] },
      ],
      sections: [
        {
          type: "image-with-text",
          purpose: "Hero",
          settings: [
            { id: "button_label", value: "Shop now" },
            { id: "button_link", value: "product" },
            { id: "color_scheme", value: "scheme-9" }, // not in the theme
            { id: "image", value: "image:1" },
          ],
          blocks: [],
        },
      ],
    };
    const context = {
      productHandle: "sunset-lamp",
      colorSchemes: ["scheme-1"],
      images: null as string[] | null,
    };
    const noImages = buildGeneratedTemplate(base, plan, [section], () => false, {
      mainSection: main,
      context,
    }).template as { sections: Record<string, Record<string, unknown>> };
    expect(noImages.sections.main!.block_order).toEqual(["p", "tc_text_1", "b"]);
    expect(noImages.sections.tc_1_image_with_text!.settings).toEqual({
      button_label: "Shop now",
      button_link: "shopify://products/sunset-lamp",
      subheading: "",
    });

    const images = ["shopify://shop_images/a.jpg", "shopify://shop_images/b.jpg"];
    const withImages = buildGeneratedTemplate(base, plan, [section], () => false, {
      mainSection: main,
      context: { ...context, images },
    }).template as { sections: Record<string, Record<string, Record<string, unknown>>> };
    expect(withImages.sections.tc_1_image_with_text!.settings!.image).toBe(images[1]);
  });

  it("refuses a base without main product section, or a plan with nothing usable", () => {
    const plan: TemplatePlan = {
      mainBlocks: [],
      sections: [
        { type: "multicolumn", purpose: "", settings: [{ id: "title", value: "Hi" }], blocks: [] },
      ],
    };
    expect(() => buildGeneratedTemplate({ sections: {}, order: [] }, plan, [MULTI])).toThrow(
      /main product/,
    );
    expect(() => buildGeneratedTemplate(BASE, { mainBlocks: [], sections: [] }, [MULTI])).toThrow(
      /No planned section/,
    );
  });

  it("escapes text and never targets anything but product.tc-*", () => {
    expect(
      settingValue({ id: "t", type: "inline_richtext", label: "" }, "a <script>x</script> & b"),
    ).toBe("a &amp; b");
    expect(settingValue({ id: "c", type: "checkbox", label: "" }, "yes")).toBeUndefined();
    const suffix = generatedTemplateSuffix("prod_01JABC");
    expect(suffix).toBe("tc-prod_01jabc");
    expect(isGeneratedTemplateSuffix(suffix)).toBe(true);
    expect(isGeneratedTemplateSuffix("trendcart")).toBe(false);
  });
});
