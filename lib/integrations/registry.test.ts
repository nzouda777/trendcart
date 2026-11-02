import { describe, expect, it } from "vitest";

import { createIntegrations, getIntegrationsMode } from "./index";

describe("integration registry", () => {
  it("defaults to mock mode", () => {
    expect(getIntegrationsMode()).toBe("mock");
  });

  it("resolves every adapter in mock mode", () => {
    const integrations = createIntegrations("mock");
    expect(integrations.mode).toBe("mock");
    for (const key of [
      "shopify",
      "tiktokAds",
      "tiktokPosting",
      "tiktokData",
      "productAnalyzer",
      "supplierFinder",
      "complianceChecker",
      "copywriter",
    ] as const) {
      expect(integrations[key], key).toBeTruthy();
    }
  });
});

describe("AI_MODE split", () => {
  it("builds live analysis adapters next to mock store adapters", () => {
    const integrations = createIntegrations("mock", "live");
    expect(integrations.mode).toBe("mock");
    expect(integrations.productAnalyzer).toBeTruthy();
    expect(integrations.supplierFinder).toBeTruthy();
  });
});
