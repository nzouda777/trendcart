import { describe, expect, it } from "vitest";

import { resolveAiMode, resolveIntegrationsMode } from "./mode";

describe("resolveIntegrationsMode", () => {
  it("defaults to mock outside production", () => {
    expect(resolveIntegrationsMode({})).toBe("mock");
  });

  it("requires live in production", () => {
    expect(() => resolveIntegrationsMode({ VERCEL_ENV: "production" })).toThrow();
    expect(resolveIntegrationsMode({ VERCEL_ENV: "production", INTEGRATIONS_MODE: "live" })).toBe(
      "live",
    );
  });
});

describe("resolveAiMode", () => {
  it("follows INTEGRATIONS_MODE when unset or blank", () => {
    expect(resolveAiMode({})).toBe("mock");
    expect(resolveAiMode({ INTEGRATIONS_MODE: "live", AI_MODE: " " })).toBe("live");
  });

  it("overrides INTEGRATIONS_MODE either way", () => {
    expect(resolveAiMode({ INTEGRATIONS_MODE: "mock", AI_MODE: "live" })).toBe("live");
    expect(resolveAiMode({ INTEGRATIONS_MODE: "live", AI_MODE: "mock" })).toBe("mock");
  });

  it("rejects unknown values", () => {
    expect(() => resolveAiMode({ AI_MODE: "real" })).toThrow();
  });

  it("refuses mock in production", () => {
    const prod = { VERCEL_ENV: "production", INTEGRATIONS_MODE: "live" };
    expect(() => resolveAiMode({ ...prod, AI_MODE: "mock" })).toThrow(/AI_MODE/);
    expect(resolveAiMode({ ...prod, AI_MODE: "live" })).toBe("live");
    expect(resolveAiMode(prod)).toBe("live");
  });
});
