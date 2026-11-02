import { describe, expect, it } from "vitest";

import { normalizeProductUrl, parseImportLink } from "./links";

describe("normalizeProductUrl", () => {
  it("strips tracking params and fragments, keeps meaningful params sorted", () => {
    expect(
      normalizeProductUrl(
        "https://WWW.Example-Shop.com/products/lamp?variant=42&utm_source=tiktok&fbclid=abc&ttclid=x#reviews",
      ),
    ).toBe("https://www.example-shop.com/products/lamp?variant=42");
    expect(normalizeProductUrl("example.com/p?b=2&a=1")).toBe("https://example.com/p?a=1&b=2");
    expect(
      normalizeProductUrl(
        "https://www.aliexpress.com/item/1005006.html?spm=a2g0o&gatewayAdapt=glo2usa",
      ),
    ).toBe("https://www.aliexpress.com/item/1005006.html?gatewayAdapt=glo2usa");
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/file",
    "http://localhost:3000/x",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://2130706433/",
    "https://user:pw@example.com/",
    "https://example.com:8443/p",
    "https://intranet/p",
    "https://printer.local/",
    "https://db.internal/x",
    "",
  ])("rejects %s", (input) => {
    expect(() => normalizeProductUrl(input)).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});

describe("parseImportLink", () => {
  it("classifies TikTok videos", () => {
    expect(parseImportLink("https://www.tiktok.com/@a.b/video/7412345678901234567")).toMatchObject({
      sourceType: "tiktok_video",
      tiktok: { kind: "video", videoId: "7412345678901234567" },
    });
    expect(parseImportLink("https://vm.tiktok.com/ZMh7Abc12/")).toMatchObject({
      sourceType: "tiktok_video",
      tiktok: { kind: "short" },
    });
  });

  it("rejects TikTok links that are not videos", () => {
    expect(() => parseImportLink("https://www.tiktok.com/@a.b")).toThrow(/not a video/);
  });

  it("classifies product links", () => {
    expect(parseImportLink("https://shop.example.com/products/lamp?utm_medium=x")).toEqual({
      sourceType: "product_link",
      url: "https://shop.example.com/products/lamp",
    });
  });
});
