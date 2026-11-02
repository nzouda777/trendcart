import * as nodeCrypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/oauth.json";
import {
  normalizeShopDomain,
  oauthHmacMessage,
  signOAuthQuery,
  signWebhookBody,
  verifyOAuthQuery,
  verifyWebhookBody,
} from "./hmac";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { secret, callbackQuery, webhook } = fixture;

beforeEach(() => {
  vi.mocked(nodeCrypto.timingSafeEqual).mockClear();
});

describe("OAuth callback HMAC", () => {
  it("accepts the recorded callback", () => {
    expect(verifyOAuthQuery(callbackQuery, secret)).toBe(true);
  });

  it("builds the sorted message without hmac/signature", () => {
    expect(oauthHmacMessage({ ...callbackQuery, signature: "x" })).toBe(
      `code=${callbackQuery.code}&shop=${callbackQuery.shop}&state=${callbackQuery.state}&timestamp=${callbackQuery.timestamp}`,
    );
    // Order of keys in the query does not matter.
    const reversed = Object.fromEntries(Object.entries(callbackQuery).reverse());
    expect(verifyOAuthQuery(reversed, secret)).toBe(true);
  });

  it("rejects a tampered parameter, a wrong secret, or an added parameter", () => {
    expect(verifyOAuthQuery({ ...callbackQuery, shop: "evil-shop.myshopify.com" }, secret)).toBe(
      false,
    );
    expect(verifyOAuthQuery(callbackQuery, "not-hush")).toBe(false);
    expect(verifyOAuthQuery({ ...callbackQuery, host: "YWRtaW4uc2hvcGlmeS5jb20" }, secret)).toBe(
      false,
    );
  });

  it("rejects missing, malformed or wrong-length signatures without throwing", () => {
    const { hmac: _drop, ...noHmac } = callbackQuery;
    void _drop;
    expect(verifyOAuthQuery(noHmac, secret)).toBe(false);
    expect(verifyOAuthQuery({ ...callbackQuery, hmac: "abc" }, secret)).toBe(false);
    expect(verifyOAuthQuery({ ...callbackQuery, hmac: "z".repeat(64) }, secret)).toBe(false);
    expect(verifyOAuthQuery({ ...callbackQuery, hmac: `${callbackQuery.hmac}00` }, secret)).toBe(
      false,
    );
    expect(verifyOAuthQuery(callbackQuery, "")).toBe(false);
  });

  it("compares in constant time", () => {
    verifyOAuthQuery(callbackQuery, secret);
    verifyOAuthQuery({ ...callbackQuery, hmac: "0".repeat(64) }, secret);
    expect(nodeCrypto.timingSafeEqual).toHaveBeenCalledTimes(2);
  });

  it("signOAuthQuery round-trips", () => {
    const q = { shop: "a.myshopify.com", code: "c", state: "s".repeat(32), timestamp: "1" };
    expect(verifyOAuthQuery({ ...q, hmac: signOAuthQuery(q, "k") }, "k")).toBe(true);
  });
});

describe("webhook HMAC", () => {
  it("accepts the recorded delivery", () => {
    expect(verifyWebhookBody(webhook.body, webhook.hmac, secret)).toBe(true);
    expect(signWebhookBody(webhook.body, secret)).toBe(webhook.hmac);
  });

  it("rejects a re-serialized or modified body", () => {
    const reserialized = JSON.stringify(JSON.parse(webhook.body), null, 2);
    expect(verifyWebhookBody(reserialized, webhook.hmac, secret)).toBe(false);
    expect(verifyWebhookBody(`${webhook.body} `, webhook.hmac, secret)).toBe(false);
    expect(verifyWebhookBody(webhook.body, webhook.hmac, "other")).toBe(false);
  });

  it("rejects missing, malformed or truncated headers without throwing", () => {
    expect(verifyWebhookBody(webhook.body, null, secret)).toBe(false);
    expect(verifyWebhookBody(webhook.body, "", secret)).toBe(false);
    expect(verifyWebhookBody(webhook.body, "not base64!", secret)).toBe(false);
    expect(verifyWebhookBody(webhook.body, webhook.hmac.slice(0, 20), secret)).toBe(false);
  });

  it("compares in constant time", () => {
    verifyWebhookBody(webhook.body, webhook.hmac, secret);
    verifyWebhookBody(webhook.body, signWebhookBody("x", secret), secret);
    expect(nodeCrypto.timingSafeEqual).toHaveBeenCalledTimes(2);
  });
});

describe("normalizeShopDomain", () => {
  it.each([
    ["acme", "acme.myshopify.com"],
    ["Acme.myshopify.com", "acme.myshopify.com"],
    ["https://acme-2.myshopify.com/admin/products", "acme-2.myshopify.com"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeShopDomain(input)).toBe(expected);
  });

  it.each(["", "acme.com", "acme.myshopify.com.attacker.example", "-acme", "ac me"])(
    "rejects %s",
    (input) => {
      expect(normalizeShopDomain(input)).toBeNull();
    },
  );
});
