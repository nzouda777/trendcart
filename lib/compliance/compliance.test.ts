import { describe, expect, it } from "vitest";

import { complianceReportSchema } from "@/lib/domain/contracts";

import {
  checkAspectRatio,
  checkDuration,
  checkResolution,
  createComplianceChecker,
  overallVerdict,
  screenPolicy,
} from ".";

const verdict = (rules: { ruleId: string; verdict: string }[], id: string) =>
  rules.find((r) => r.ruleId === id)?.verdict;

describe("technical checks", () => {
  it.each([
    [3, "fail"],
    [5, "pass"],
    [30, "pass"],
    [61, "warn"],
    [601, "fail"],
  ])("duration %ss -> %s", (sec, expected) => {
    expect(checkDuration(sec).verdict).toBe(expected);
  });

  it.each([
    [1080, 1920, "pass"],
    [720, 1280, "pass"],
    [1080, 1080, "warn"],
    [1920, 1080, "warn"],
    [1080, 1350, "fail"],
    [576, 1024, "pass"],
  ])("aspect %sx%s -> %s", (w, h, expected) => {
    expect(checkAspectRatio(w, h).verdict).toBe(expected);
  });

  it.each([
    [1080, 1920, "pass"],
    [576, 1024, "warn"],
    [360, 640, "fail"],
    [600, 600, "fail"],
    [720, 720, "pass"],
  ])("resolution %sx%s -> %s", (w, h, expected) => {
    expect(checkResolution(w, h).verdict).toBe(expected);
  });

  it("takes the worst verdict overall", () => {
    expect(overallVerdict([{ verdict: "pass" }, { verdict: "warn" }])).toBe("warn");
    expect(overallVerdict([{ verdict: "warn" }, { verdict: "fail" }, { verdict: "pass" }])).toBe(
      "fail",
    );
    expect(overallVerdict([])).toBe("pass");
  });
});

describe("policy screen", () => {
  const screen = (caption: string, claims: string[] = [], productCategory = "Home & Living") =>
    screenPolicy({ caption, claims, productCategory });

  it("passes a clean caption", () => {
    expect(
      screen("Golden hour, every hour #homedecor", [
        "BPA-free bottle",
        "Free shipping over $40",
      ]).every((r) => r.verdict === "pass"),
    ).toBe(true);
  });

  it("fails health claims", () => {
    expect(verdict(screen("This patch cures back pain in a week"), "policy.health_claims")).toBe(
      "fail",
    );
    expect(verdict(screen("", ["Lose 10 kg in a month"]), "policy.health_claims")).toBe("fail");
  });

  it("fails prohibited products from the category too", () => {
    expect(
      verdict(screen("new flavour", [], "Vape & E-cigarettes"), "policy.prohibited_products"),
    ).toBe("fail");
  });

  it("warns on exaggerated and pricing claims", () => {
    const rules = screen("100% guaranteed results, FREE gift today only");
    expect(verdict(rules, "policy.misleading_claims")).toBe("warn");
    expect(verdict(rules, "policy.pricing_claims")).toBe("warn");
  });

  it("fails counterfeit wording and personal-attribute targeting", () => {
    expect(verdict(screen("1:1 copy of the designer bag"), "policy.intellectual_property")).toBe(
      "fail",
    );
    expect(verdict(screen("Are you overweight? Try this"), "policy.personal_attributes")).toBe(
      "fail",
    );
  });
});

describe("mock ComplianceChecker", () => {
  it("returns a contract report with per-rule reasons", async () => {
    const { data, usage } = await createComplianceChecker("mock").check(
      { workspaceId: "ws" },
      {
        durationSec: 75,
        width: 1080,
        height: 1920,
        caption: "Clinically proven to boost immunity",
        claims: [],
        productCategory: "Health",
        countries: ["US"],
      },
    );
    complianceReportSchema.parse(data);
    expect(data.overall).toBe("fail");
    expect(verdict(data.rules, "tech.duration")).toBe("warn");
    expect(data.rules.every((r) => r.reason.length > 0)).toBe(true);
    expect(usage).toEqual([]);
  });
});
