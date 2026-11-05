import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/domain/contracts";

import { readLoginConfig } from "../tiktok-posting/config";
import { readAdsConfig } from "./config";
import { MissingConfigError } from "./safety";

/*
 * Missing TikTok app credentials are a setup problem on our side. They stay
 * permission_denied (non retryable) for callers, but are marked so the
 * connect routes can say "not configured" instead of "access was declined".
 */
describe("missing TikTok app credentials", () => {
  it("names the Ads variables that are missing", () => {
    const error = (() => {
      try {
        readAdsConfig({ TIKTOK_APP_ID: "", TIKTOK_APP_SECRET: "s" });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(MissingConfigError);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({ code: "permission_denied", retryable: false });
    expect((error as Error).message).toContain("TIKTOK_APP_ID");
  });

  it("names the Login Kit variables that are missing", () => {
    expect(() => readLoginConfig({ TIKTOK_LOGIN_CLIENT_KEY: "k" })).toThrow(MissingConfigError);
    expect(() => readLoginConfig({ TIKTOK_LOGIN_CLIENT_KEY: "k" })).toThrow(
      /TIKTOK_LOGIN_CLIENT_SECRET/,
    );
  });

  it("does not fire once both values are set", () => {
    expect(readAdsConfig({ TIKTOK_APP_ID: "a", TIKTOK_APP_SECRET: "s" }).appId).toBe("a");
  });
});
