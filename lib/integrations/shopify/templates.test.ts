import { describe, expect, it } from "vitest";

import { parseTemplateSuffixes, templateSuffixFromFilename } from "./templates";

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
