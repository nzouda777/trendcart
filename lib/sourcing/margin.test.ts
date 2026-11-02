import { describe, expect, it } from "vitest";

import { calculateMargin, FEE_PRESETS, minimumPriceForMargin, quoteSupplier } from "./margin";

const base = { currency: "USD", sellingPrice: 29.99, productCost: 6.5, shippingCost: 3.2 };

describe("calculateMargin", () => {
  it("computes landed cost, fees, margin and CPA with Shopify Payments", () => {
    const r = calculateMargin(base);
    // fees = 2.9% × 29.99 (0.87) + 0.30
    expect(r).toMatchObject({
      currency: "USD",
      productCost: 6.5,
      shippingCost: 3.2,
      landedCost: 9.7,
      paymentFees: 1.17,
      shopifyFees: 0,
      fees: 1.17,
      sellingPrice: 29.99,
      grossMargin: 19.12,
      marginRate: 0.6375,
      breakEvenCpa: 19.12,
      maxCpa: 19.12,
      breakEvenRoas: 1.5685,
      targetMarginRate: null,
      meetsTarget: true,
    });
  });

  it("subtracts the target margin from the max CPA", () => {
    const r = calculateMargin({ ...base, targetMarginRate: 0.25 });
    // 25% of 29.99 = 7.50 → 19.12 − 7.50
    expect(r.maxCpa).toBe(11.62);
    expect(r.breakEvenCpa).toBe(19.12);
    expect(r.meetsTarget).toBe(true);
  });

  it("adds Shopify transaction fees for third-party gateways", () => {
    const r = calculateMargin({ ...base, fees: FEE_PRESETS.third_party_basic });
    expect(r.shopifyFees).toBe(0.6);
    expect(r.fees).toBe(1.77);
    expect(r.grossMargin).toBe(18.52);
  });

  it("includes other per-order costs in the landed cost", () => {
    const r = calculateMargin({ ...base, otherCosts: 1.05 });
    expect(r.landedCost).toBe(10.75);
    expect(r.grossMargin).toBe(18.07);
  });

  it("reports negative margins without negative CPA", () => {
    const r = calculateMargin({
      currency: "EUR",
      sellingPrice: 9.99,
      productCost: 8,
      shippingCost: 3,
      targetMarginRate: 0.2,
    });
    expect(r.grossMargin).toBeLessThan(0);
    expect(r.marginRate).toBeLessThan(0);
    expect(r.breakEvenCpa).toBe(0);
    expect(r.maxCpa).toBe(0);
    expect(r.breakEvenRoas).toBeNull();
    expect(r.meetsTarget).toBe(false);
  });

  it("flags a margin below target", () => {
    const r = calculateMargin({ ...base, sellingPrice: 14.99, targetMarginRate: 0.4 });
    expect(r.marginRate).toBeLessThan(0.4);
    expect(r.meetsTarget).toBe(false);
  });

  it("does not drift on float inputs", () => {
    const r = calculateMargin({
      currency: "USD",
      sellingPrice: 0.3,
      productCost: 0.1,
      shippingCost: 0.2,
      fees: { paymentRate: 0, paymentFixed: 0, shopifyTransactionRate: 0 },
    });
    expect(r.grossMargin).toBe(0);
    expect(r.landedCost).toBe(0.3);
  });

  it.each([
    { ...base, sellingPrice: 0 },
    { ...base, productCost: -1 },
    { ...base, currency: "usd" },
    { ...base, targetMarginRate: 1 },
    { ...base, fees: { paymentRate: 0.5, paymentFixed: 0.3, shopifyTransactionRate: 0 } },
    { ...base, sellingPrice: Number.NaN },
  ])("rejects invalid input %#", (input) => {
    expect(() => calculateMargin(input)).toThrow();
  });
});

describe("minimumPriceForMargin", () => {
  it("finds the lowest price that keeps the target margin after fees", () => {
    const price = minimumPriceForMargin({
      productCost: 6.5,
      shippingCost: 3.2,
      targetMarginRate: 0.3,
    })!;
    const at = calculateMargin({ ...base, sellingPrice: price });
    const below = calculateMargin({ ...base, sellingPrice: price - 0.01 });
    expect(at.grossMargin / at.sellingPrice).toBeGreaterThanOrEqual(0.3);
    expect(below.grossMargin / below.sellingPrice).toBeLessThan(0.3);
  });

  it("returns null when fees plus target leave nothing", () => {
    expect(
      minimumPriceForMargin({
        productCost: 5,
        targetMarginRate: 0.99,
        fees: { paymentRate: 0.02, paymentFixed: 0, shopifyTransactionRate: 0 },
      }),
    ).toBeNull();
  });

  it("handles free products (fixed fee only)", () => {
    expect(
      minimumPriceForMargin({
        productCost: 0,
        targetMarginRate: 0,
        fees: { paymentRate: 0, paymentFixed: 0, shopifyTransactionRate: 0 },
      }),
    ).toBe(0.01);
  });
});

describe("quoteSupplier", () => {
  const listing = {
    price: { amount: 6.5, currency: "USD" },
    shipping: { amount: 3.2, currency: "USD" },
  };
  const rule = { multiplier: 3, roundTo: 0.99, compareAtMultiplier: 1.5 };

  it("applies the brand pricing rule to the landed cost", () => {
    const q = quoteSupplier({ listing, currency: "USD", pricingRule: rule, minMargin: 0.3 });
    // landed 9.70 × 3 = 29.10 -> 29.99; compare-at 29.99 × 1.5 = 44.985 -> 44.99
    expect(q).toMatchObject({
      currency: "USD",
      sellingPrice: 29.99,
      compareAtPrice: 44.99,
      priceSource: "pricing_rule",
      minimumPrice: 14.99,
      warnings: [],
    });
    // fees 0.87 + 0.30; gross 29.99 - 9.70 - 1.17
    expect(q.margin).toMatchObject({
      landedCost: 9.7,
      fees: 1.17,
      grossMargin: 19.12,
      meetsTarget: true,
    });
    expect(q.margin.maxCpa).toBe(10.12); // 19.12 - 30 % × 29.99 (9.00)
  });

  it("raises the price to the min_margin floor when the rule lands below it", () => {
    const q = quoteSupplier({
      listing,
      currency: "USD",
      pricingRule: { multiplier: 1.2, roundTo: 0.99 },
      minMargin: 0.3,
    });
    expect(q).toMatchObject({
      sellingPrice: 14.99,
      priceSource: "min_margin",
      compareAtPrice: null,
    });
    expect(q.margin.marginRate).toBeGreaterThanOrEqual(0.3);
    expect(q.margin.meetsTarget).toBe(true);
  });

  it("uses the default rule without a brand rule and converts with fxRate", () => {
    const q = quoteSupplier({ listing, currency: "EUR", fxRate: 0.92 });
    // 6.50 × 0.92 = 5.98, 3.20 × 0.92 = 2.94; landed 8.92 × 3 = 26.76 -> 26.99
    expect(q).toMatchObject({
      currency: "EUR",
      sellingPrice: 26.99,
      compareAtPrice: null,
      priceSource: "default_rule",
      minimumPrice: null,
    });
    expect(q.margin).toMatchObject({ currency: "EUR", productCost: 5.98, shippingCost: 2.94 });
  });

  it("refuses a currency mismatch without an exchange rate", () => {
    expect(() => quoteSupplier({ listing, currency: "EUR" })).toThrow(/exchange rate/);
    expect(() =>
      quoteSupplier({
        listing: { ...listing, shipping: { amount: 1, currency: "EUR" } },
        currency: "USD",
      }),
    ).toThrow(/different currencies/);
  });

  it("keeps manual prices and warns when they miss the target", () => {
    const below = quoteSupplier({ listing, currency: "USD", minMargin: 0.3, sellingPrice: 12.99 });
    expect(below).toMatchObject({ sellingPrice: 12.99, priceSource: "manual" });
    expect(below.margin.meetsTarget).toBe(false);
    expect(below.warnings).toEqual([expect.stringMatching(/below the brand minimum of 30.0 %/)]);

    const loss = quoteSupplier({ listing, currency: "USD", sellingPrice: 9.99 });
    expect(loss.warnings).toEqual([expect.stringMatching(/does not cover/)]);

    // A compare-at price must be strictly above the selling price.
    expect(
      quoteSupplier({ listing, currency: "USD", sellingPrice: 19.99, compareAtPrice: 19.99 })
        .compareAtPrice,
    ).toBeNull();
    expect(
      quoteSupplier({ listing, currency: "USD", sellingPrice: 19.99, compareAtPrice: 29.99 })
        .compareAtPrice,
    ).toBe(29.99);
  });

  it("handles listings without shipping and other per-order costs", () => {
    const q = quoteSupplier({
      listing: { price: listing.price, shipping: null },
      currency: "USD",
      otherCosts: 1,
      pricingRule: { multiplier: 2.5, roundTo: 0.95 },
    });
    // landed 6.50 + 1.00 = 7.50 × 2.5 = 18.75 -> 18.95
    expect(q).toMatchObject({ sellingPrice: 18.95 });
    expect(q.margin.landedCost).toBe(7.5);
  });
});
