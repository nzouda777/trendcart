import { describe, expect, it } from "vitest";

import { canonicalJson, pageCopyVersion } from "./copy-version";
import { safeVariantGroups } from "./page-input";

describe("pageCopyVersion", () => {
  const copy = {
    title: "Stand",
    descriptionHtml: "<p>Hi</p>",
    highlights: ["A", "B", "C"],
    faq: [{ question: "Q?", answer: "A." }],
    guarantee: "Returns",
    adTexts: ["Ad"],
    seo: { title: "S", description: "D" },
  };

  it("is 16 hex chars, stable whatever the key order", () => {
    const v = pageCopyVersion(copy)!;
    expect(v).toMatch(/^[0-9a-f]{16}$/);
    const reordered = {
      seo: { description: "D", title: "S" },
      adTexts: ["Ad"],
      guarantee: "Returns",
      faq: [{ answer: "A.", question: "Q?" }],
      highlights: ["A", "B", "C"],
      descriptionHtml: "<p>Hi</p>",
      title: "Stand",
    };
    expect(pageCopyVersion(reordered)).toBe(v);
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it("changes with any edit, including array order; null without copy", () => {
    const v = pageCopyVersion(copy);
    expect(pageCopyVersion({ ...copy, title: "Stand 2" })).not.toBe(v);
    expect(pageCopyVersion({ ...copy, highlights: ["B", "A", "C"] })).not.toBe(v);
    expect(pageCopyVersion(null)).toBeNull();
  });
});

describe("safeVariantGroups (QA N6)", () => {
  it("drops flagged option names and values, and groups left empty", () => {
    expect(
      safeVariantGroups([
        { name: "Color", values: ["Black", "Best-seller pink", "White"] },
        { name: "Rated 4.9 out of 5", values: ["One"] },
        { name: "Bundle", values: ["10,000 sold"] },
      ]),
    ).toEqual([{ name: "Color", values: ["Black", "White"] }]);
  });
});
