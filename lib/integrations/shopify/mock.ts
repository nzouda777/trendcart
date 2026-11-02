/**
 * Mock Shopify adapter: the whole ShopifyClient contract, deterministic, no
 * network. The install flow is real OAuth shape end to end: buildInstallUrl
 * points straight at our callback with a query signed by the mock secret (or
 * the custom app secret), and completeInstall verifies it like live does.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import {
  shopDomainSchema,
  shopifyMediaRefSchema,
  shopifyProductRefSchema,
  shopifyShopInfoSchema,
  type ShopifyAppCredentials,
  type ShopifyCredentials,
  type ShopifyProductRef,
} from "@/lib/domain/contracts";

import { MOCK_SHOPIFY_API_SECRET, SHOPIFY_SCOPES } from "./config";
import { shopifyError } from "./errors";
import { isValidShopDomain, signOAuthQuery, verifyOAuthQuery, verifyWebhookBody } from "./hmac";
import { parseDraftInput } from "./product-input";
import type { ShopifyAdapter, ShopifyInstallToken } from "./types";

export type MockShopifyOptions = {
  now?: () => number;
};

const MOCK_TOKEN_TTL_S = 3600;
const MOCK_REFRESH_TTL_S = 90 * 24 * 3600;

function digest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Stable positive integer id (13 digits, like Shopify's) from a seed. */
function numericId(...parts: string[]): string {
  // 12 hex chars = 48 bits, well inside Number.MAX_SAFE_INTEGER.
  return String((parseInt(digest(...parts).slice(0, 12), 16) % 9e12) + 1e12);
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

const storeHandle = (shopDomain: string) => shopDomain.replace(/\.myshopify\.com$/, "");

function titleCase(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function createMockShopifyClient(options: MockShopifyOptions = {}): ShopifyAdapter {
  const now = options.now ?? Date.now;
  /**
   * In-memory products for this client instance (handle + status), so
   * re-runs and publishProduct behave like the live store. Ids are
   * deterministic, so a fresh instance returns the same ids.
   */
  const products = new Map<string, { handle: string; status: ShopifyProductRef["status"] }>();

  const secretFor = (app?: ShopifyAppCredentials) => app?.clientSecret ?? MOCK_SHOPIFY_API_SECRET;

  function issueToken(shopDomain: string, seed: string): ShopifyInstallToken {
    const t = now();
    return {
      shopDomain,
      accessToken: `shpat_mock_${digest("access", shopDomain, seed).slice(0, 32)}`,
      scopes: [...SHOPIFY_SCOPES],
      refreshToken: `shprt_mock_${digest("refresh", shopDomain, seed).slice(0, 32)}`,
      expiresAt: new Date(t + MOCK_TOKEN_TTL_S * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(t + MOCK_REFRESH_TTL_S * 1000).toISOString(),
    };
  }

  function assertCreds(creds: ShopifyCredentials) {
    if (!isValidShopDomain(creds.shopDomain) || !creds.accessToken) {
      throw shopifyError("auth_expired", "Mock Shopify: missing or invalid credentials.");
    }
  }

  function productRef(
    shop: string,
    productId: string,
    handle: string,
    status: ShopifyProductRef["status"],
  ) {
    const numeric = productId.split("/").pop()!;
    return shopifyProductRefSchema.parse({
      productId,
      handle,
      status,
      adminUrl: `https://admin.shopify.com/store/${storeHandle(shop)}/products/${numeric}`,
      onlineStoreUrl: status === "ACTIVE" ? `https://${shop}/products/${handle}` : null,
      previewUrl: `https://${shop}/products_preview?preview_key=${digest("preview", productId).slice(0, 32)}`,
    });
  }

  return {
    mode: "mock",

    buildInstallUrl({ shopDomain, oauth, app }) {
      const shop = shopDomainSchema.parse(shopDomain);
      // Skip Shopify: hand back the callback URL Shopify would redirect to.
      const query: Record<string, string> = {
        code: `mock_code_${digest("code", shop, oauth.state).slice(0, 16)}`,
        shop,
        state: oauth.state,
        timestamp: String(Math.floor(now() / 1000)),
      };
      query.hmac = signOAuthQuery(query, secretFor(app));
      const url = new URL(oauth.redirectUri);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      return url.toString();
    },

    async completeInstall({ query, expectedState, app }) {
      if (!isValidShopDomain(query.shop)) {
        throw shopifyError("invalid_input", "Invalid shop in OAuth callback.");
      }
      if (!verifyOAuthQuery(query, secretFor(app))) {
        throw shopifyError("invalid_input", "Invalid OAuth callback signature.");
      }
      const a = Buffer.from(expectedState);
      const b = Buffer.from(query.state ?? "");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw shopifyError("invalid_input", "OAuth state mismatch.");
      }
      if (!query.code) throw shopifyError("invalid_input", "Missing authorization code.");
      return issueToken(query.shop, query.code);
    },

    async refreshAccessToken({ shopDomain, refreshToken }) {
      if (!refreshToken.startsWith("shprt_mock_")) {
        throw shopifyError("auth_expired", "Mock Shopify: invalid refresh token.");
      }
      return issueToken(shopDomainSchema.parse(shopDomain), `${refreshToken}:${now()}`);
    },

    verifyWebhook({ rawBody, hmacHeader, app }) {
      return verifyWebhookBody(rawBody, hmacHeader, secretFor(app));
    },

    async getShopInfo(creds) {
      assertCreds(creds);
      return shopifyShopInfoSchema.parse({
        shopDomain: creds.shopDomain,
        name: titleCase(storeHandle(creds.shopDomain)) || "Demo Store",
        currency: "USD",
        primaryLocale: "en",
        plan: "Development",
      });
    },

    async listProductTemplates(creds) {
      assertCreds(creds);
      return [null, "trendcart"];
    },

    async ensureMetafieldDefinitions(creds) {
      assertCreds(creds);
    },

    async createDraftProduct(creds, input) {
      assertCreds(creds);
      // Same validation as live (option/variant consistency included).
      const p = parseDraftInput(input);
      // Like the live custom-ID upsert: one product per idempotency key, whose
      // handle and status survive re-runs; without a key, one per title.
      const seed = p.idempotencyKey ? `key:${p.idempotencyKey}` : p.title;
      const productId = `gid://shopify/Product/${numericId(creds.shopDomain, "product", seed)}`;
      const known = products.get(productId);
      if (known) {
        return productRef(creds.shopDomain, productId, known.handle, known.status);
      }
      const handle = slugify(p.title);
      products.set(productId, { handle, status: "DRAFT" });
      return productRef(creds.shopDomain, productId, handle, "DRAFT");
    },

    async attachVideoFromUrl(creds, input) {
      assertCreds(creds);
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(input.productId)) {
        throw shopifyError("not_found", "Mock Shopify: unknown product.");
      }
      let source: URL;
      try {
        source = new URL(input.sourceUrl);
      } catch {
        throw shopifyError("invalid_input", "Mock Shopify: sourceUrl must be a URL.");
      }
      const key = digest(creds.shopDomain, input.productId, source.toString());
      return shopifyMediaRefSchema.parse({
        mediaId: `gid://shopify/Video/${numericId(key)}`,
        fileUrl: `https://cdn.shopify.com/videos/c/o/v/${key.slice(0, 32)}.mp4`,
        status: "READY",
      });
    },

    async deleteProductMedia(creds, input) {
      assertCreds(creds);
      if (input.mediaIds.some((id) => !id.startsWith("gid://shopify/"))) {
        throw shopifyError("invalid_input", "Mock Shopify: media ids must be GIDs.");
      }
    },

    async publishProduct(creds, productId) {
      assertCreds(creds);
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
        throw shopifyError("not_found", "Mock Shopify: unknown product.");
      }
      const known = products.get(productId);
      const handle = known?.handle ?? `product-${productId.split("/").pop()}`;
      products.set(productId, { handle, status: "ACTIVE" });
      return productRef(creds.shopDomain, productId, handle, "ACTIVE");
    },

    async unpublishProduct(creds, productId) {
      assertCreds(creds);
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
        throw shopifyError("not_found", "Mock Shopify: unknown product.");
      }
      const known = products.get(productId);
      const handle = known?.handle ?? `product-${productId.split("/").pop()}`;
      products.set(productId, { handle, status: "DRAFT" });
      return productRef(creds.shopDomain, productId, handle, "DRAFT");
    },
  };
}
