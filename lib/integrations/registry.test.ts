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
