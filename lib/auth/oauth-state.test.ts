import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createCipher } from "@/lib/crypto/cipher";

import { OAuthStateError, openOAuthState, sealOAuthState } from "./oauth-state";

const sealer = createCipher(randomBytes(32).toString("base64"));
const input = { workspaceId: "ws_a", userId: "user_1", data: { brandId: "brand_1" } };

describe("oauth state", () => {
  it("round-trips the flow bound to workspace and user", () => {
    const { state, sealed } = sealOAuthState("shopify", input, { sealer });
    const flow = openOAuthState("shopify", sealed, state, { sealer });
    expect(flow).toMatchObject({ provider: "shopify", workspaceId: "ws_a", userId: "user_1" });
    expect(flow.data).toEqual({ brandId: "brand_1" });
  });

  it("generates a fresh state each time", () => {
    const a = sealOAuthState("shopify", input, { sealer });
    const b = sealOAuthState("shopify", input, { sealer });
    expect(a.state).not.toBe(b.state);
  });

  it("rejects a mismatched, missing or tampered state", () => {
    const { state, sealed } = sealOAuthState("tiktok_ads", input, { sealer });
    const other = sealOAuthState("tiktok_ads", input, { sealer }).state;
    expect(() => openOAuthState("tiktok_ads", sealed, other, { sealer })).toThrow(OAuthStateError);
    expect(() => openOAuthState("tiktok_ads", sealed, null, { sealer })).toThrow(OAuthStateError);
    expect(() => openOAuthState("tiktok_ads", undefined, state, { sealer })).toThrow(
      OAuthStateError,
    );
    expect(() => openOAuthState("tiktok_ads", `${sealed}x`, state, { sealer })).toThrow(
      OAuthStateError,
    );
  });

  it("rejects a flow sealed for another provider", () => {
    const { state, sealed } = sealOAuthState("tiktok_login", input, { sealer });
    expect(() => openOAuthState("tiktok_ads", sealed, state, { sealer })).toThrow(OAuthStateError);
  });

  it("rejects an expired flow", () => {
    const now = Date.now();
    const { state, sealed } = sealOAuthState("shopify", input, { sealer, now });
    expect(() =>
      openOAuthState("shopify", sealed, state, { sealer, now: now + 11 * 60 * 1000 }),
    ).toThrow(/expired/);
  });
});
