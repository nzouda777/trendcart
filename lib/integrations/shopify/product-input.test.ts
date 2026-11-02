import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pageCopySchema, shopifyDraftProductInputSchema } from "@/lib/domain/contracts";

import { SHOPIFY_METAFIELD_DEFINITIONS } from "./config";
import {
  buildProductSetVariables,
  draftProductInputFromPageCopy,
  htmlToText,
  imageMarker,
  markerFromShopifyUrl,
  plainText,
  sanitizeDraftInput,
  seoFor,
  TEXT_LIMITS,
} from "./product-input";
import {
  hasTrendcartTemplate,
  TEMPLATE_KIT_FILES,
  TRENDCART_TEMPLATE_SUFFIX,
} from "./template-kit";

const copy = pageCopySchema.parse({
  title: "LED Sunset Lamp",
  descriptionHtml: "<p>Golden hour.</p>",
  highlights: ["16 colors", "USB powered", "360° rotation"],
  faq: [
    { question: "Shipping?", answer: "7-12 days." },
    { question: "Warranty?", answer: "1 year." },
    { question: "Returns?", answer: "30 days." },
  ],
  guarantee: "30-day money back.",
  adTexts: ["Golden hour, every hour."],
  seo: { title: "LED Sunset Lamp | Demo", description: "A lamp that paints sunsets." },
});

describe("draftProductInputFromPageCopy", () => {
  it("maps PageCopy, pricing and images to a valid draft input keyed by the product id", () => {
    const input = draftProductInputFromPageCopy({
      productId: "prod_1",
      copy,
      templateSuffix: "trendcart",
      options: [],
      variants: [{ optionValues: [], price: 29.99, compareAtPrice: 49.99 }],
      imageUrls: ["https://x.example/a.jpg"],
    });
    const parsed = shopifyDraftProductInputSchema.parse(input);
    expect(parsed).toMatchObject({
      idempotencyKey: "prod_1",
      title: "LED Sunset Lamp",
      seo: copy.seo,
      templateSuffix: "trendcart",
      tags: ["trendcart"],
      metafields: { highlights: copy.highlights, faq: copy.faq, guarantee: copy.guarantee },
    });
  });
});

describe("sanitizing (QA M2 S1, N6)", () => {
  const hostileCopy = {
    ...copy,
    title: "Lamp <img src=x onerror=alert(1)>\u0000‮<b>Pro</b>",
    descriptionHtml:
      '<p onclick="x()">Nice</p><script>fetch("//evil.example")</script><img src=x onerror=alert(1)><a href="javascript:1">link</a>',
    highlights: ["<script>alert(1)</script>Bright", "  16 colors\n  ", "<b></b>"],
    faq: [
      { question: "Ship<iframe src=//x>?", answer: "Line 1\n<script>x</script>Line 2" },
      { question: "<br>", answer: "dropped" },
      { question: "Returns?", answer: "30 days." },
    ],
    guarantee: "<style>*{}</style>30 days &lt;script&gt;",
    seo: { title: "<svg onload=alert(1)>Lamp", description: "Desc <b>bold</b>" },
  };

  it("sends sanitized description HTML and plain text everywhere else", () => {
    const input = draftProductInputFromPageCopy({
      productId: "prod_1",
      copy: hostileCopy,
      templateSuffix: null,
      options: [],
      variants: [{ optionValues: [], price: 10, compareAtPrice: null, sku: "<b>SKU-1</b>" }],
      imageUrls: [],
      vendor: "<i>Acme</i>",
      tags: ["trendcart", "<x>trendcart</x>", "<b></b>"],
    });
    const all = JSON.stringify(input);
    expect(all).not.toMatch(/<script|onerror|onclick|onload|<iframe|<img|<svg|<style|javascript:/i);
    expect(input.descriptionHtml).toContain("<p>Nice</p>");
    expect(input.title).toBe("Lamp Pro");
    expect(input.seo).toEqual({ title: "Lamp", description: "Desc bold" });
    expect(input.vendor).toBe("Acme");
    expect(input.tags).toEqual(["trendcart"]);
    expect(input.variants[0]!.sku).toBe("SKU-1");
    expect(input.metafields.highlights).toEqual(["Bright", "16 colors"]);
    expect(input.metafields.faq).toEqual([
      { question: "Ship ?", answer: "Line 1\nLine 2" },
      { question: "Returns?", answer: "30 days." },
    ]);
    // Entities are decoded, then the brackets dropped: no markup can come back.
    expect(input.metafields.guarantee).toBe("30 days script");
  });

  it("is safe whatever the caller passes to buildProductSetVariables", () => {
    const vars = buildProductSetVariables({
      title: "Lamp <script>alert(1)</script>",
      descriptionHtml: "<p>x</p><img src=x onerror=alert(1)>",
      templateSuffix: null,
      options: [],
      variants: [{ optionValues: [], price: 10, compareAtPrice: null }],
      imageUrls: [],
      metafields: { highlights: [], faq: [], guarantee: "" },
    });
    expect(JSON.stringify(vars.input)).not.toMatch(/<script|onerror/i);
    expect(vars.input.descriptionHtml).toContain("<p>x</p>");
  });

  it("an all-markup title is rejected rather than sent empty", () => {
    expect(() =>
      buildProductSetVariables({
        title: "<script>alert(1)</script>",
        descriptionHtml: "",
        templateSuffix: null,
        options: [],
        variants: [{ optionValues: [], price: 10, compareAtPrice: null }],
        imageUrls: [],
        metafields: { highlights: [], faq: [], guarantee: "" },
      }),
    ).toThrow(/Invalid product input/);
  });

  it("caps plain text at Shopify limits", () => {
    expect(plainText("é".repeat(300), TEXT_LIMITS.title)).toHaveLength(255);
    expect(plainText("a\u0007b​c‮d", 10)).toBe("abcd");
    expect(plainText("a\n\n\n\nb", 10, true)).toBe("a\n\nb");
    expect(plainText("a\nb", 10)).toBe("a b");
  });

  it("cleans scraped option names and values, drops empty ones and dedupes", () => {
    const input = sanitizeDraftInput({
      title: "Lamp",
      descriptionHtml: "",
      templateSuffix: null,
      options: [
        {
          name: " <b>Color</b> ",
          values: ["Red<script>x</script>", "<i>Red</i>", " Blue\u0000", "<br>"],
        },
        { name: "<img src=x onerror=alert(1)>", values: ["A"] },
        { name: "Size", values: ["X".repeat(400)] },
        { name: "color", values: ["Green"] },
      ],
      variants: [
        {
          optionValues: ["Red<script>x</script>", "A", "X".repeat(400), "Green"],
          price: 10,
          compareAtPrice: null,
        },
        {
          optionValues: ["<i>Red</i>", "A", "X".repeat(400), "Green"],
          price: 11,
          compareAtPrice: null,
        },
        {
          optionValues: [" Blue\u0000", "A", "X".repeat(400), "Green"],
          price: 12,
          compareAtPrice: null,
        },
        { optionValues: ["<br>", "A", "X".repeat(400), "Green"], price: 13, compareAtPrice: null },
      ],
      imageUrls: [],
      metafields: { highlights: [], faq: [], guarantee: "" },
    });
    expect(input.options).toEqual([
      { name: "Color", values: ["Red", "Blue"] },
      { name: "Size", values: ["X".repeat(TEXT_LIMITS.optionValue)] },
    ]);
    expect(input.variants.map((v) => [v.optionValues, v.price])).toEqual([
      [["Red", "X".repeat(TEXT_LIMITS.optionValue)], 10],
      [["Blue", "X".repeat(TEXT_LIMITS.optionValue)], 12],
    ]);
    // The cleaned input is valid and stable.
    expect(sanitizeDraftInput(input)).toEqual(input);
    expect(() => buildProductSetVariables(input)).not.toThrow();
  });

  it("still rejects caller mistakes instead of hiding them", () => {
    const base = {
      title: "Lamp",
      descriptionHtml: "",
      templateSuffix: null,
      options: [{ name: "Color", values: ["Red"] }],
      imageUrls: [],
      metafields: { highlights: [], faq: [], guarantee: "" },
    };
    expect(() =>
      buildProductSetVariables({
        ...base,
        variants: [{ optionValues: ["Blue"], price: 10, compareAtPrice: null }],
      }),
    ).toThrow(/not a value of option/);
    expect(() =>
      buildProductSetVariables({
        ...base,
        variants: [
          { optionValues: ["Red"], price: 10, compareAtPrice: null },
          { optionValues: ["Red"], price: 10, compareAtPrice: null },
        ],
      }),
    ).toThrow(/Duplicate variant/);
  });
});

describe("SEO and markers", () => {
  it("derives SEO from the title and plain-text description within Shopify's limits", () => {
    const long = `<p>${"word ".repeat(200)}</p><script>alert(1)</script>`;
    const seo = seoFor("T".repeat(90), long);
    expect(seo.title.length).toBeLessThanOrEqual(70);
    expect(seo.description.length).toBeLessThanOrEqual(320);
    expect(seo.description).not.toContain("alert");
    expect(htmlToText("<b>A</b>&nbsp;&amp;&lt;B&gt;")).toBe("A &<B>");
  });

  it("finds our marker in Shopify CDN URLs only", () => {
    const m = imageMarker("https://x.example/a.jpg");
    expect(markerFromShopifyUrl(`https://cdn.shopify.com/s/files/1/2/files/tc-${m}.jpg?v=1`)).toBe(
      m,
    );
    expect(markerFromShopifyUrl(`https://cdn.shopify.com/files/tc-${m}_0d9a.jpg`)).toBe(m);
    expect(markerFromShopifyUrl("https://cdn.shopify.com/files/IMG_1.jpg")).toBeNull();
    expect(markerFromShopifyUrl("not a url")).toBeNull();
  });
});

describe("template kit", () => {
  const root = path.join(import.meta.dirname, "template-kit", "theme");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("ships a JSON template bound to the Trendcart section", () => {
    expect(TEMPLATE_KIT_FILES).toContain(`templates/product.${TRENDCART_TEMPLATE_SUFFIX}.json`);
    const template = JSON.parse(read(`templates/product.${TRENDCART_TEMPLATE_SUFFIX}.json`)) as {
      sections: Record<string, { type: string }>;
      order: string[];
    };
    for (const key of template.order) expect(template.sections[key]).toBeDefined();
    expect(Object.values(template.sections).map((s) => s.type)).toContain(
      "trendcart-product-details",
    );
  });

  it("the section reads every custom.* metafield and has a valid schema", () => {
    const liquid = read("sections/trendcart-product-details.liquid");
    for (const d of SHOPIFY_METAFIELD_DEFINITIONS) {
      expect(liquid).toContain(`product.metafields.${d.namespace}.${d.key}`);
    }
    // Every metafield value is escaped before output.
    expect(liquid).not.toMatch(/\{\{\s*item\s*\}\}/);
    const schema = /\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(liquid)?.[1];
    const parsed = JSON.parse(schema ?? "") as { name: string; presets: unknown[] };
    expect(parsed.name).toBe("Trendcart details");
    expect(parsed.presets).toHaveLength(1);
  });

  it("detects whether the live theme already has the template", () => {
    expect(hasTrendcartTemplate([null, "trendcart"])).toBe(true);
    expect(hasTrendcartTemplate([null, "bundle"])).toBe(false);
  });
});
