/**
 * Mock Shopify adapter: the whole ShopifyClient contract, deterministic, no
 * network. The install flow is real OAuth shape end to end: buildInstallUrl
 * points straight at our callback with a query signed by the mock secret (or
 * the custom app secret), and completeInstall verifies it like live does.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import {
  productTemplateStructureSchema,
  shopDomainSchema,
  shopifyMediaRefSchema,
  shopifyProductRefSchema,
  shopifyShopInfoSchema,
  type ShopifyAppCredentials,
  type ShopifyCredentials,
  type ShopifyProductRef,
} from "@/lib/domain/contracts";

import { MOCK_SHOPIFY_API_SECRET, SHOPIFY_SCOPES, SHOPIFY_THEME_WRITE_SCOPE } from "./config";
import { shopifyError } from "./errors";
import { isValidShopDomain, signOAuthQuery, verifyOAuthQuery, verifyWebhookBody } from "./hmac";
import { parseDraftInput } from "./product-input";
import {
  isGeneratedTemplateSuffix,
  parseMainSectionSchema,
  sectionCatalog,
} from "./template-builder";
import {
  buildTemplateStructure,
  templateFilename,
  type MetafieldDefinitionInfo,
} from "./templates";
import type { ShopifyAdapter, ShopifyInstallToken } from "./types";
import { sourceKey, videoMarker } from "./video";

/**
 * Product templates of the mock theme, keyed by suffix ("" = product.json).
 * "landing" binds three text metafields with dynamic sources, like a merchant
 * template built with the theme editor, so the mock flow fills template slots.
 */
const MOCK_TEMPLATES: Record<string, Record<string, unknown>> = {
  "": {
    sections: { main: { type: "main-product", blocks: { t: { type: "title" } } } },
    order: ["main"],
  },
  trendcart: {
    sections: {
      main: { type: "main-product", blocks: { t: { type: "title" }, d: { type: "description" } } },
      details: { type: "trendcart-product-details", settings: {} },
    },
    order: ["main", "details"],
  },
  landing: {
    sections: {
      main: {
        type: "main-product",
        blocks: {
          tagline: { type: "text", settings: { text: "{{ product.metafields.custom.tagline }}" } },
          d: { type: "description" },
        },
        block_order: ["tagline", "d"],
      },
      usage: {
        type: "image-with-text",
        settings: {},
        blocks: {
          h: { type: "heading", settings: { heading: "How to use it" } },
          body: {
            type: "text",
            settings: { text: "{{ product.metafields.custom.how_to_use.value }}" },
          },
        },
        block_order: ["h", "body"],
      },
      box: {
        type: "collapsible-content",
        settings: { heading: "In the box" },
        blocks: {
          row: {
            type: "collapsible_row",
            settings: {
              heading: "Included",
              row_content: "{{ product.metafields.custom.in_the_box }}",
            },
          },
        },
      },
    },
    order: ["main", "usage", "box"],
  },
};

/** Section files of the mock theme (real {% schema %} blocks, parsed like live). */
const schema = (s: unknown) =>
  `<div>{{ section.settings.heading }}</div>\n{% schema %}\n${JSON.stringify(s)}\n{% endschema %}`;
const MOCK_SECTION_FILES = [
  {
    filename: "sections/rich-text.liquid",
    content: schema({
      name: "Rich text",
      settings: [
        {
          type: "select",
          id: "desktop_content_position",
          label: "Position",
          options: [{ value: "left" }, { value: "center" }],
          default: "center",
        },
        { type: "color_scheme", id: "color_scheme", label: "Color scheme", default: "scheme-1" },
      ],
      blocks: [
        {
          type: "button",
          name: "Button",
          limit: 1,
          settings: [
            { type: "text", id: "button_label", label: "Button label", default: "Button label" },
            { type: "url", id: "button_link", label: "Link" },
          ],
        },
        {
          type: "heading",
          name: "Heading",
          limit: 3,
          settings: [{ type: "inline_richtext", id: "heading", label: "Heading" }],
        },
        { type: "text", name: "Text", settings: [{ type: "richtext", id: "text", label: "Text" }] },
      ],
      presets: [{ name: "Rich text" }],
    }),
  },
  {
    filename: "sections/multicolumn.liquid",
    content: schema({
      name: "Multicolumn",
      max_blocks: 6,
      settings: [
        { type: "inline_richtext", id: "title", label: "Heading" },
        {
          type: "range",
          id: "columns_desktop",
          label: "Columns",
          min: 1,
          max: 6,
          step: 1,
          default: 3,
        },
      ],
      blocks: [
        {
          type: "column",
          name: "Column",
          settings: [
            { type: "image_picker", id: "image", label: "Image" },
            { type: "inline_richtext", id: "title", label: "Heading" },
            { type: "richtext", id: "text", label: "Description" },
          ],
        },
      ],
      presets: [{ name: "Multicolumn" }],
    }),
  },
  {
    filename: "sections/image-with-text.liquid",
    content: schema({
      name: "Image with text",
      settings: [
        { type: "image_picker", id: "image", label: "Image" },
        {
          type: "select",
          id: "layout",
          label: "Layout",
          options: [{ value: "image_first" }, { value: "text_first" }],
        },
        { type: "color_scheme", id: "color_scheme", label: "Color scheme" },
      ],
      blocks: [
        {
          type: "heading",
          name: "Heading",
          limit: 1,
          settings: [
            {
              type: "inline_richtext",
              id: "heading",
              label: "Heading",
              default: "Image with text",
            },
          ],
        },
        { type: "text", name: "Text", settings: [{ type: "richtext", id: "text", label: "Text" }] },
      ],
      presets: [{ name: "Image with text" }],
    }),
  },
  {
    filename: "sections/collapsible-content.liquid",
    content: schema({
      name: "Collapsible content",
      settings: [{ type: "inline_richtext", id: "heading", label: "Heading" }],
      blocks: [
        {
          type: "collapsible_row",
          name: "Collapsible row",
          settings: [
            { type: "text", id: "heading", label: "Heading" },
            { type: "richtext", id: "row_content", label: "Row content" },
          ],
        },
      ],
      presets: [{ name: "Collapsible content" }],
    }),
  },
  {
    filename: "sections/announcement.liquid",
    content: schema({
      name: "Announcement",
      enabled_on: { groups: ["header"] },
      settings: [{ type: "text", id: "text", label: "Text" }],
      presets: [{ name: "Announcement" }],
    }),
  },
  {
    filename: "sections/main-product.liquid",
    content: schema({
      name: "Product information",
      settings: [],
      blocks: [
        { type: "title", name: "Title", limit: 1 },
        { type: "price", name: "Price", limit: 1 },
        { type: "buy_buttons", name: "Buy buttons", limit: 1 },
        {
          type: "custom_liquid",
          name: "Custom liquid",
          settings: [{ type: "liquid", id: "custom_liquid", label: "Liquid" }],
        },
        {
          type: "text",
          name: "Text",
          settings: [
            { type: "inline_richtext", id: "text", label: "Text" },
            {
              type: "select",
              id: "text_style",
              label: "Style",
              options: [{ value: "body" }, { value: "subtitle" }, { value: "uppercase" }],
            },
          ],
        },
        {
          type: "collapsible_tab",
          name: "Collapsible row",
          settings: [
            { type: "text", id: "heading", label: "Heading" },
            { type: "richtext", id: "content", label: "Row content" },
          ],
        },
        {
          type: "icon-with-text",
          name: "Icon with text",
          settings: [
            { type: "text", id: "heading_1", label: "Heading 1" },
            { type: "text", id: "heading_2", label: "Heading 2" },
            { type: "text", id: "heading_3", label: "Heading 3" },
          ],
        },
      ],
    }),
  },
];

const MOCK_DEFINITIONS: MetafieldDefinitionInfo[] = [
  {
    namespace: "custom",
    key: "tagline",
    name: "Tagline",
    description: "One-line hook under the title.",
    type: "single_line_text_field",
  },
  {
    namespace: "custom",
    key: "how_to_use",
    name: "How to use",
    description: null,
    type: "rich_text_field",
  },
  {
    namespace: "custom",
    key: "in_the_box",
    name: "In the box",
    description: "What the parcel contains.",
    type: "list.single_line_text_field",
  },
];

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
  const products = new Map<
    string,
    { handle: string; status: ShopifyProductRef["status"]; templateSuffix?: string | null }
  >();
  /** Generated templates written by upsertProductTemplate (shop/suffix → JSON). */
  const writtenTemplates = new Map<string, Record<string, unknown>>();

  const secretFor = (app?: ShopifyAppCredentials) => app?.clientSecret ?? MOCK_SHOPIFY_API_SECRET;

  function issueToken(shopDomain: string, seed: string): ShopifyInstallToken {
    const t = now();
    return {
      shopDomain,
      accessToken: `shpat_mock_${digest("access", shopDomain, seed).slice(0, 32)}`,
      // The mock app has the theme-write exemption, so generated templates work in demos.
      scopes: [...SHOPIFY_SCOPES, SHOPIFY_THEME_WRITE_SCOPE],
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
      return [null, ...Object.keys(MOCK_TEMPLATES).filter((s) => s !== "")].sort((a, b) =>
        a === null ? -1 : b === null ? 1 : a.localeCompare(b),
      );
    },

    async getProductTemplateStructure(creds, suffix) {
      assertCreds(creds);
      const template = MOCK_TEMPLATES[suffix ?? ""];
      if (!template) {
        throw shopifyError(
          "not_found",
          `The store's theme has no ${templateFilename(suffix)} template.`,
          {
            retryable: false,
          },
        );
      }
      return productTemplateStructureSchema.parse(
        buildTemplateStructure(suffix, template, MOCK_DEFINITIONS),
      );
    },

    async getTemplateDesignContext(creds, baseSuffix) {
      assertCreds(creds);
      const base = MOCK_TEMPLATES[baseSuffix ?? ""];
      if (!base) {
        throw shopifyError(
          "not_found",
          `The store's theme has no ${templateFilename(baseSuffix)} template.`,
          { retryable: false },
        );
      }
      const main = MOCK_SECTION_FILES.find((f) => f.filename === "sections/main-product.liquid")!;
      return {
        base: structuredClone(base),
        sections: sectionCatalog(MOCK_SECTION_FILES),
        mainSection: parseMainSectionSchema(main.filename, main.content),
        colorSchemes: [
          { id: "scheme-1", background: "#FFFFFF", text: "#121212", button: "#121212" },
          { id: "scheme-2", background: "#F3F3F3", text: "#121212", button: "#121212" },
          { id: "scheme-3", background: "#242833", text: "#FFFFFF", button: "#FFFFFF" },
        ],
      };
    },

    async upsertProductTemplate(creds, input) {
      assertCreds(creds);
      if (!isGeneratedTemplateSuffix(input.suffix)) {
        throw shopifyError("invalid_input", "Mock Shopify: only product.tc-*.json can be written.");
      }
      writtenTemplates.set(`${creds.shopDomain}/${input.suffix}`, structuredClone(input.template));
    },

    async deleteProductTemplate(creds, input) {
      assertCreds(creds);
      if (!isGeneratedTemplateSuffix(input.suffix)) {
        throw shopifyError(
          "invalid_input",
          "Mock Shopify: only product.tc-*.json can be deleted.",
          {
            retryable: false,
          },
        );
      }
      if (input.productId !== undefined) {
        if (!/^gid:\/\/shopify\/Product\/\d+$/.test(input.productId)) {
          throw shopifyError("invalid_input", "Mock Shopify: productId must be a Product GID.", {
            retryable: false,
          });
        }
        const p = products.get(input.productId);
        if (p?.status === "ACTIVE" && p.templateSuffix === input.suffix) {
          throw shopifyError(
            "invalid_input",
            "Mock Shopify: the template is used by a published product.",
            { retryable: false },
          );
        }
      }
      return { deleted: writtenTemplates.delete(`${creds.shopDomain}/${input.suffix}`) };
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
        // productSet updates the template on a re-run, like live.
        known.templateSuffix = p.templateSuffix ?? null;
        return productRef(creds.shopDomain, productId, known.handle, known.status);
      }
      const handle = slugify(p.title);
      products.set(productId, {
        handle,
        status: "DRAFT",
        templateSuffix: p.templateSuffix ?? null,
      });
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
        throw shopifyError("invalid_input", "Mock Shopify: sourceUrl must be a URL.", {
          retryable: false,
        });
      }
      if (source.protocol !== "https:" && source.protocol !== "http:") {
        throw shopifyError("invalid_input", "Mock Shopify: sourceUrl must be http(s).", {
          retryable: false,
        });
      }
      // Same idempotency as live: the Trendcart video id, else the URL without
      // its (expiring) query string. A re-run returns the same media.
      const marker = videoMarker(input.idempotencyKey?.trim() || sourceKey(source.toString()));
      const key = digest(creds.shopDomain, input.productId, marker);
      return shopifyMediaRefSchema.parse({
        mediaId: `gid://shopify/Video/${numericId(key)}`,
        fileUrl: `https://cdn.shopify.com/videos/c/o/v/${key.slice(0, 32)}.mp4`,
        status: "READY",
      });
    },

    async deleteProductMedia(creds, input) {
      assertCreds(creds);
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(input.productId)) {
        throw shopifyError("invalid_input", "Mock Shopify: expected a product GID.", {
          retryable: false,
        });
      }
      // Images and videos alike; already-deleted media is a success (as live).
      if (input.mediaIds.some((id) => !/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(id))) {
        throw shopifyError("invalid_input", "Mock Shopify: media ids must be GIDs.", {
          retryable: false,
        });
      }
    },

    async publishProduct(creds, productId) {
      assertCreds(creds);
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
        throw shopifyError("not_found", "Mock Shopify: unknown product.");
      }
      const known = products.get(productId);
      const handle = known?.handle ?? `product-${productId.split("/").pop()}`;
      products.set(productId, { ...known, handle, status: "ACTIVE" });
      return productRef(creds.shopDomain, productId, handle, "ACTIVE");
    },

    async unpublishProduct(creds, productId) {
      assertCreds(creds);
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
        throw shopifyError("not_found", "Mock Shopify: unknown product.");
      }
      const known = products.get(productId);
      const handle = known?.handle ?? `product-${productId.split("/").pop()}`;
      products.set(productId, { ...known, handle, status: "DRAFT" });
      return productRef(creds.shopDomain, productId, handle, "DRAFT");
    },
  };
}
