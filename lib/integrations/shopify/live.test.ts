import { describe, expect, it } from "vitest";

import { IntegrationError, shopifyShopInfoSchema } from "@/lib/domain/contracts";

import gqlFixtures from "./__fixtures__/admin-graphql.json";
import oauth from "./__fixtures__/oauth.json";
import { SHOPIFY_SCOPES } from "./config";
import type { FetchLike } from "./graphql";
import { createLiveShopifyClient } from "./live";
import { shopifyInstallTokenSchema } from "./types";

type Call = { url: string; init?: RequestInit; body: unknown };

/** Replays recorded responses in order and records the requests. */
function replay(...responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const raw = typeof init?.body === "string" ? init.body : "";
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      body = Object.fromEntries(new URLSearchParams(raw));
    }
    calls.push({ url, init, body });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request to ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch, calls };
}

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const creds = { shopDomain: "some-shop.myshopify.com", accessToken: "shpat_test" };

function client(fetch: FetchLike) {
  return createLiveShopifyClient({
    apiKey: "public-key",
    apiSecret: oauth.secret,
    apiVersion: "2026-10",
    fetch,
    now: () => NOW,
    sleep: async () => {},
  });
}

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

describe("live install", () => {
  it("builds an offline authorize URL with the pinned scopes", () => {
    const url = new URL(
      client(replay().fetch).buildInstallUrl({
        shopDomain: "some-shop.myshopify.com",
        oauth: {
          state: "s".repeat(32),
          redirectUri: "https://trendcart.test/api/shopify/callback",
        },
      }),
    );
    expect(url.origin + url.pathname).toBe("https://some-shop.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("public-key");
    expect(url.searchParams.get("scope")).toBe(SHOPIFY_SCOPES.join(","));
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://trendcart.test/api/shopify/callback",
    );
    expect(url.searchParams.get("state")).toBe("s".repeat(32));
    expect(url.searchParams.has("grant_options[]")).toBe(false);
  });

  it("uses the custom app client id when given", () => {
    const url = new URL(
      client(replay().fetch).buildInstallUrl({
        shopDomain: "some-shop.myshopify.com",
        oauth: { state: "s".repeat(32), redirectUri: "https://trendcart.test/cb" },
        app: { clientId: "custom-id", clientSecret: "custom-secret" },
      }),
    );
    expect(url.searchParams.get("client_id")).toBe("custom-id");
  });

  it("verifies the callback and exchanges the code for an expiring offline token", async () => {
    const { fetch, calls } = replay({ body: oauth.tokenResponse });
    const token = await client(fetch).completeInstall({
      query: oauth.callbackQuery,
      expectedState: oauth.callbackQuery.state,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://some-shop.myshopify.com/admin/oauth/access_token");
    expect(calls[0]!.body).toEqual({
      client_id: "public-key",
      client_secret: oauth.secret,
      code: oauth.callbackQuery.code,
      expiring: "1",
    });
    expect(shopifyInstallTokenSchema.parse(token)).toEqual({
      shopDomain: "some-shop.myshopify.com",
      accessToken: oauth.tokenResponse.access_token,
      scopes: [...SHOPIFY_SCOPES],
      refreshToken: oauth.tokenResponse.refresh_token,
      expiresAt: "2026-10-25T13:00:00.000Z",
      refreshTokenExpiresAt: "2027-01-23T12:00:00.000Z",
    });
  });

  it("rejects a bad HMAC before any network call", async () => {
    const { fetch, calls } = replay();
    const error = await rejection(
      client(fetch).completeInstall({
        query: { ...oauth.callbackQuery, code: "forged" },
        expectedState: oauth.callbackQuery.state,
      }),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.message).toMatch(/signature/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a state mismatch before any network call", async () => {
    const { fetch, calls } = replay();
    const error = await rejection(
      client(fetch).completeInstall({ query: oauth.callbackQuery, expectedState: "x".repeat(43) }),
    );
    expect(error.message).toMatch(/state/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid shop", async () => {
    const error = await rejection(
      client(replay().fetch).completeInstall({
        query: { ...oauth.callbackQuery, shop: "some-shop.myshopify.com.evil.test" },
        expectedState: oauth.callbackQuery.state,
      }),
    );
    expect(error.message).toMatch(/shop/);
  });

  it("fails when the merchant granted fewer scopes", async () => {
    const { fetch } = replay({ body: oauth.tokenResponseMissingScopes });
    const error = await rejection(
      client(fetch).completeInstall({
        query: oauth.callbackQuery,
        expectedState: oauth.callbackQuery.state,
      }),
    );
    expect(error.code).toBe("permission_denied");
    expect(error.message).toContain("read_themes");
  });

  it("maps a rejected code exchange to auth_expired", async () => {
    const { fetch } = replay({ status: 400, body: { error: "invalid_request" } });
    const error = await rejection(
      client(fetch).completeInstall({
        query: oauth.callbackQuery,
        expectedState: oauth.callbackQuery.state,
      }),
    );
    expect(error.code).toBe("auth_expired");
    expect(error.retryable).toBe(false);
  });

  it("refreshes an expiring token", async () => {
    const { fetch, calls } = replay({ body: oauth.refreshResponse });
    const token = await client(fetch).refreshAccessToken({
      shopDomain: "some-shop.myshopify.com",
      refreshToken: "shprt_old",
    });
    expect(calls[0]!.body).toEqual({
      client_id: "public-key",
      client_secret: oauth.secret,
      grant_type: "refresh_token",
      refresh_token: "shprt_old",
    });
    expect(token.accessToken).toBe(oauth.refreshResponse.access_token);
    expect(token.refreshToken).toBe(oauth.refreshResponse.refresh_token);
  });

  it("verifies webhooks with the public or the custom secret", () => {
    const c = client(replay().fetch);
    expect(c.verifyWebhook({ rawBody: oauth.webhook.body, hmacHeader: oauth.webhook.hmac })).toBe(
      true,
    );
    expect(
      c.verifyWebhook({
        rawBody: oauth.webhook.body,
        hmacHeader: oauth.webhook.hmac,
        app: { clientId: "x", clientSecret: "other" },
      }),
    ).toBe(false);
  });
});

describe("live Admin GraphQL", () => {
  it("reads shop info against the pinned version", async () => {
    const { fetch, calls } = replay({ body: gqlFixtures.shopInfo });
    const info = await client(fetch).getShopInfo(creds);
    expect(calls[0]!.url).toBe("https://some-shop.myshopify.com/admin/api/2026-10/graphql.json");
    expect(new Headers(calls[0]!.init?.headers).get("X-Shopify-Access-Token")).toBe("shpat_test");
    expect(shopifyShopInfoSchema.parse(info)).toEqual({
      shopDomain: "some-shop.myshopify.com",
      name: "Some Shop",
      currency: "EUR",
      primaryLocale: "fr",
      plan: "Basic",
    });
  });

  it("lists product template suffixes across pages of the MAIN theme", async () => {
    const { fetch, calls } = replay(
      { body: gqlFixtures.templatesPage1 },
      { body: gqlFixtures.templatesPage2 },
    );
    const suffixes = await client(fetch).listProductTemplates(creds);
    expect(suffixes).toEqual([null, "bundle", "pre-order", "trendcart"]);
    const [first, second] = calls.map(
      (c) => c.body as { query: string; variables: { after: string | null } },
    );
    expect(first!.query).toContain("roles: [MAIN]");
    expect(first!.query).toContain('filenames: ["templates/product*.json"]');
    expect(first!.variables.after).toBeNull();
    expect(second!.variables.after).toBe("eyJsYXN0X2lkIjozfQ==");
  });

  it("fails clearly without a published theme", async () => {
    const { fetch } = replay({ body: gqlFixtures.noMainTheme });
    expect((await rejection(client(fetch).listProductTemplates(creds))).code).toBe("not_found");
  });

  it("creates only the missing metafield definitions", async () => {
    const { fetch, calls } = replay(
      { body: gqlFixtures.definitionsPartial },
      { body: gqlFixtures.definitionCreated },
      { body: gqlFixtures.definitionCreated },
      { body: gqlFixtures.definitionCreated },
    );
    await client(fetch).ensureMetafieldDefinitions(creds);
    const created = calls
      .slice(1)
      .map(
        (c) =>
          (c.body as { variables: { definition: Record<string, unknown> } }).variables.definition,
      );
    expect(created).toEqual([
      expect.objectContaining({
        namespace: "custom",
        key: "faq",
        type: "json",
        ownerType: "PRODUCT",
        pin: true,
      }),
      expect.objectContaining({
        namespace: "custom",
        key: "guarantee",
        type: "multi_line_text_field",
        ownerType: "PRODUCT",
      }),
      // The custom ID used for idempotent upserts: unique by type, not pinned.
      expect.objectContaining({
        namespace: "trendcart",
        key: "product_id",
        type: "id",
        ownerType: "PRODUCT",
        pin: false,
      }),
    ]);
  });

  it("is a no-op when every definition exists", async () => {
    const { fetch, calls } = replay({ body: gqlFixtures.definitionsAll });
    await client(fetch).ensureMetafieldDefinitions(creds);
    expect(calls).toHaveLength(1);
  });

  it("treats a concurrent TAKEN as success and retries unpinned on the pin limit", async () => {
    const { fetch, calls } = replay(
      { body: gqlFixtures.definitionsPartial },
      { body: gqlFixtures.definitionTaken },
      { body: gqlFixtures.definitionPinnedLimit },
      { body: gqlFixtures.definitionCreated },
      { body: gqlFixtures.definitionCreated },
    );
    await client(fetch).ensureMetafieldDefinitions(creds);
    const pins = calls
      .slice(1)
      .map(
        (c) => (c.body as { variables: { definition: { pin: boolean } } }).variables.definition.pin,
      );
    expect(pins).toEqual([true, true, false, false]);
  });

  it("refuses to reuse a definition with the wrong type", async () => {
    const { fetch } = replay({ body: gqlFixtures.definitionsWrongType });
    const error = await rejection(client(fetch).ensureMetafieldDefinitions(creds));
    expect(error.code).toBe("invalid_input");
    expect(error.retryable).toBe(false);
  });

  it("maps throttling, access denied and HTTP errors", async () => {
    expect(
      (
        await rejection(
          client(
            replay(
              { body: gqlFixtures.throttled },
              { body: gqlFixtures.throttled },
              { body: gqlFixtures.throttled },
              { body: gqlFixtures.throttled },
            ).fetch,
          ).getShopInfo(creds),
        )
      ).code,
    ).toBe("rate_limited");
    expect(
      (
        await rejection(
          client(replay({ body: gqlFixtures.accessDenied }).fetch).listProductTemplates(creds),
        )
      ).code,
    ).toBe("permission_denied");
    expect(
      (await rejection(client(replay({ status: 401, body: {} }).fetch).getShopInfo(creds))).code,
    ).toBe("auth_expired");
    const server = await rejection(
      client(replay({ status: 503, body: {} }).fetch).getShopInfo(creds),
    );
    expect(server.code).toBe("provider_error");
    expect(server.retryable).toBe(true);
  });
});
