import { describe, expect, it } from "vitest";

import { supplierListingSchema, type SupplierListingInput } from "@/lib/domain/contracts";

import { fullSizeImageUrl, isPageImage } from "./images";
import { pickWithRequiredSources, qualitySignal, scoreListings, shortlistListings } from "./value";

const listing = (over: Partial<SupplierListingInput>) =>
  supplierListingSchema.parse({
    source: "aliexpress",
    url: `https://example.com/${Math.random()}`,
    title: "Lamp",
    price: { amount: 10, currency: "USD" },
    shipping: null,
    leadTimeDays: null,
    images: [],
    variants: [],
    matchScore: 0.9,
    ...over,
  });

describe("quality/price ratio", () => {
  it("prefers the cheaper landed cost at equal relevance and rating", () => {
    const [cheap, dear] = scoreListings([
      listing({ price: { amount: 5, currency: "USD" }, shipping: { amount: 1, currency: "USD" } }),
      listing({ price: { amount: 12, currency: "USD" } }),
    ]);
    expect(cheap!.valueScore).toBeGreaterThan(dear!.valueScore);
  });

  it("lets a well-reviewed offer beat a slightly cheaper unknown one", () => {
    const [unknown, rated] = scoreListings([
      listing({ price: { amount: 9, currency: "USD" }, leadTimeDays: { min: 15, max: 25 } }),
      listing({
        price: { amount: 10, currency: "USD" },
        rating: 4.8,
        reviewCount: 5000,
        leadTimeDays: { min: 5, max: 9 },
      }),
    ]);
    expect(rated!.valueScore).toBeGreaterThan(unknown!.valueScore);
  });

  it("trusts a rating only with enough reviews", () => {
    expect(qualitySignal(5, 1)).toBeLessThan(qualitySignal(5, 1000));
    expect(qualitySignal(null, null)).toBe(0.5);
    expect(qualitySignal(3, 10_000)).toBe(0);
  });

  it("never ranks another product first for its price", () => {
    const [other] = scoreListings([
      listing({
        matchScore: 0.2,
        price: { amount: 1, currency: "USD" },
        rating: 5,
        reviewCount: 9999,
      }),
      listing({ matchScore: 0.9 }),
    ]);
    expect(other!.valueScore).toBeLessThanOrEqual(0.2);
  });
});

describe("shortlist", () => {
  it("always keeps the best eligible offer of AliExpress, CJ and Amazon", () => {
    const list = shortlistListings(
      [
        ...Array.from({ length: 5 }, () =>
          listing({ source: "temu", price: { amount: 2, currency: "USD" } }),
        ),
        listing({ source: "amazon", price: { amount: 30, currency: "USD" } }),
        listing({ source: "cjdropshipping", price: { amount: 20, currency: "USD" } }),
        listing({ source: "cjdropshipping", matchScore: 0.1 }),
        listing({ source: "aliexpress", price: { amount: 25, currency: "USD" } }),
      ],
      4,
    );
    expect(list).toHaveLength(4);
    expect(list.map((l) => l.source).sort()).toEqual([
      "aliexpress",
      "amazon",
      "cjdropshipping",
      "temu",
    ]);
    expect(list.every((l) => l.matchScore >= 0.35)).toBe(true);
  });

  it("keeps the ranking order and fills with the best others", () => {
    const picked = pickWithRequiredSources(["a1", "x1", "x2", "c1", "x3"], {
      limit: 3,
      sourceOf: (s) =>
        ({ a: "aliexpress", c: "cjdropshipping", x: "other" })[s[0] as "a" | "c" | "x"],
      eligible: () => true,
    });
    expect(picked).toEqual(["a1", "x1", "c1"]);
  });
});

describe("supplier images", () => {
  it("asks marketplace CDNs for the original size", () => {
    expect(fullSizeImageUrl("https://ae01.alicdn.com/kf/Sabc.jpg_640x640.jpg_.webp")).toBe(
      "https://ae01.alicdn.com/kf/Sabc.jpg",
    );
    expect(fullSizeImageUrl("https://m.media-amazon.com/images/I/71abcXYZ._AC_SL1500_.jpg")).toBe(
      "https://m.media-amazon.com/images/I/71abcXYZ.jpg",
    );
    expect(fullSizeImageUrl("https://cf.cjdropshipping.com/a.jpg?x-oss-process=resize")).toBe(
      "https://cf.cjdropshipping.com/a.jpg",
    );
    expect(fullSizeImageUrl("https://shop.example.com/a.jpg?v=2")).toBe(
      "https://shop.example.com/a.jpg?v=2",
    );
  });

  it("drops search thumbnails", () => {
    expect(isPageImage("https://encrypted-tbn0.gstatic.com/shopping?q=1")).toBe(false);
    expect(isPageImage("https://serpapi.com/searches/x/images/y.jpeg")).toBe(false);
    expect(isPageImage("http://ae01.alicdn.com/kf/a.jpg")).toBe(false);
    expect(isPageImage("https://ae01.alicdn.com/kf/a.jpg")).toBe(true);
  });
});
