import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/domain/contracts";

import fx from "./__fixtures__/admin-graphql-theme-files.json";
import type { FetchLike } from "./graphql";
import { createLiveShopifyClient } from "./live";

/*
 * Generated-template cleanup (QA N6) against recorded 2026-10 responses (no
 * network): exact operations and variables, in order.
 */

type Call = { url: string; query: string; variables: Record<string, unknown> };

function replay(...responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push({ url, query: body.query, variables: body.variables ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request #${calls.length}: ${body.query.slice(0, 80)}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch, calls };
}

const creds = { shopDomain: "some-shop.myshopify.com", accessToken: "shpat_test" };
const PRODUCT = "gid://shopify/Product/1234567890";
const SUFFIX = "tc-prod_123";

const client = (fetch: FetchLike) =>
  createLiveShopifyClient({
    apiKey: "k",
    apiSecret: "s",
    apiVersion: "2026-10",
    fetch,
    sleep: async () => {},
  });

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

const op = (c: Call) => /(?:query|mutation)\s+(\w+)/.exec(c.query)?.[1];

describe("live deleteProductTemplate", () => {
  it("deletes templates/product.tc-*.json from the MAIN theme", async () => {
    const { fetch, calls } = replay({ body: fx.mainTheme }, { body: fx.deleted });
    await expect(client(fetch).deleteProductTemplate(creds, { suffix: SUFFIX })).resolves.toEqual({
      deleted: true,
    });
    expect(calls.map(op)).toEqual(["TrendcartMainTheme", "TrendcartThemeFilesDelete"]);
    expect(calls[1]!.url).toBe("https://some-shop.myshopify.com/admin/api/2026-10/graphql.json");
    expect(calls[1]!.variables).toEqual({
      themeId: "gid://shopify/OnlineStoreTheme/529529152",
      files: ["templates/product.tc-prod_123.json"],
    });
  });

  it("is idempotent: an already-missing file is not an error", async () => {
    const { fetch } = replay({ body: fx.mainTheme }, { body: fx.alreadyGone });
    await expect(client(fetch).deleteProductTemplate(creds, { suffix: SUFFIX })).resolves.toEqual({
      deleted: false,
    });
  });

  it("no published theme: nothing to delete, no mutation", async () => {
    const { fetch, calls } = replay({ body: fx.noMainTheme });
    await expect(client(fetch).deleteProductTemplate(creds, { suffix: SUFFIX })).resolves.toEqual({
      deleted: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses merchant templates, paths and bad product ids before any call", async () => {
    const { fetch, calls } = replay();
    for (const suffix of [
      "trendcart",
      "default",
      "",
      "tc",
      "TC-abc",
      "tc-../../layout/theme",
      "tc-a/b",
      "tc-a.liquid",
      " tc-abc",
    ]) {
      const e = await rejection(client(fetch).deleteProductTemplate(creds, { suffix }));
      expect(e.code, suffix).toBe("invalid_input");
      expect(e.retryable).toBe(false);
    }
    const e = await rejection(
      client(fetch).deleteProductTemplate(creds, { suffix: SUFFIX, productId: "1234" }),
    );
    expect(e.code).toBe("invalid_input");
    expect(calls).toHaveLength(0);
  });

  it("refuses while the published product still renders with it", async () => {
    const { fetch, calls } = replay({ body: fx.productActiveUsing });
    const e = await rejection(
      client(fetch).deleteProductTemplate(creds, { suffix: SUFFIX, productId: PRODUCT }),
    );
    expect(e.code).toBe("invalid_input");
    expect(e.retryable).toBe(false);
    expect(calls.map(op)).toEqual(["TrendcartProductTemplateUsage"]);
    expect(calls[0]!.variables).toEqual({ id: PRODUCT });
  });

  it("deletes when the product is a draft, uses another template, or is gone", async () => {
    for (const product of [fx.productDraftUsing, fx.productActiveOther, fx.productGone]) {
      const { fetch, calls } = replay(
        { body: product },
        { body: fx.mainTheme },
        { body: fx.deleted },
      );
      await expect(
        client(fetch).deleteProductTemplate(creds, { suffix: SUFFIX, productId: PRODUCT }),
      ).resolves.toEqual({ deleted: true });
      expect(calls.map(op)).toEqual([
        "TrendcartProductTemplateUsage",
        "TrendcartMainTheme",
        "TrendcartThemeFilesDelete",
      ]);
    }
  });

  it("surfaces other user errors and a missing theme exemption", async () => {
    const throttled = replay({ body: fx.mainTheme }, { body: fx.throttled });
    const t = await rejection(
      client(throttled.fetch).deleteProductTemplate(creds, { suffix: SUFFIX }),
    );
    expect(t.code).toBe("rate_limited");
    expect(t.retryable).toBe(true);

    const other = replay(
      { body: fx.mainTheme },
      {
        body: {
          data: {
            themeFilesDelete: {
              deletedThemeFiles: [],
              userErrors: [{ field: ["files"], message: "Error.", code: "ERROR" }],
            },
          },
        },
      },
    );
    const o = await rejection(client(other.fetch).deleteProductTemplate(creds, { suffix: SUFFIX }));
    expect(o.code).toBe("invalid_input");
    expect(o.message).toMatch(/themeFilesDelete failed/);

    const denied = replay({ body: fx.mainTheme }, { body: fx.accessDenied });
    const e = await rejection(
      client(denied.fetch).deleteProductTemplate(creds, { suffix: SUFFIX }),
    );
    expect(e.code).toBe("permission_denied");
    expect(e.retryable).toBe(false);
  });
});
