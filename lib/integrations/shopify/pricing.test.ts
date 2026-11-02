import { describe, expect, it } from "vitest";

import { priceFromCost, roundToEnding } from "./pricing";

describe("roundToEnding", () => {
  it.each([
    [23.4, 23.99],
    [24, 24.99],
    [23.99, 23.99],
    [23.991, 24.99],
    [0, 0.99],
    [0.5, 0.99],
    [99.99, 99.99],
    [100, 100.99],
  ])("%s -> %s (.99)", (amount, expected) => {
    expect(roundToEnding(amount)).toBe(expected);
  });

  it("supports other endings", () => {
    expect(roundToEnding(23.4, 0.95)).toBe(23.95);
    expect(roundToEnding(23.96, 0.95)).toBe(24.95);
    expect(roundToEnding(23.4, 0)).toBe(24);
    expect(roundToEnding(24, 0)).toBe(24);
  });

  it("rejects invalid inputs", () => {
    expect(() => roundToEnding(-1)).toThrow();
    expect(() => roundToEnding(Number.NaN)).toThrow();
    expect(() => roundToEnding(10, 1)).toThrow();
  });
});

describe("priceFromCost", () => {
  it("multiplies the landed cost and rounds to .99 by default", () => {
    expect(priceFromCost(7.8, { multiplier: 3 })).toEqual({ price: 23.99, compareAtPrice: null });
    // Float-unsafe product (7.5 * 3.12 = 23.400000000000002) still lands on 23.99.
    expect(priceFromCost(7.5, { multiplier: 3.12 }).price).toBe(23.99);
  });

  it("honours roundTo and compareAtMultiplier", () => {
    expect(priceFromCost(10, { multiplier: 2.5, roundTo: 0.95, compareAtMultiplier: 1.4 })).toEqual(
      {
        price: 25.95,
        compareAtPrice: 36.95,
      },
    );
  });

  it("keeps the compare-at price strictly above the price, on the same ending", () => {
    const quote = priceFromCost(0, { multiplier: 3, compareAtMultiplier: 1.01 });
    expect(quote).toEqual({ price: 0.99, compareAtPrice: 1.99 });
  });

  it("validates the rule and cost", () => {
    expect(() => priceFromCost(10, { multiplier: 0 })).toThrow();
    expect(() => priceFromCost(-5, { multiplier: 2 })).toThrow();
    expect(() => priceFromCost(10, { multiplier: 2, compareAtMultiplier: 0.8 })).toThrow();
  });
});
