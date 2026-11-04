/**
 * Shopify adapter configuration: pinned API version, scopes, metafield
 * definitions and env access. Pure apart from `readShopifyEnv()`.
 */

/**
 * Latest stable Admin API version (released 2026-10-01, supported until
 * 2027-10-16). Checked against shopify.dev/docs/api/usage/versioning.
 * Override with SHOPIFY_API_VERSION only to pin an older/newer quarter.
 */
export const DEFAULT_SHOPIFY_API_VERSION = "2026-10";

/**
 * Access scopes requested at install. Must match the app's shopify.app.toml.
 * A write_* scope implies its read_* scope.
 *
 * - write_products: metafield definitions (PRODUCT), productSet, product media.
 * - read_themes: active theme's templates/product*.json (never written in v1).
 * - write_files: staged uploads for product videos (M2).
 * - write_publications: publish to the Online Store sales channel (M2).
 */
export const SHOPIFY_SCOPES = [
  "write_products",
  "read_themes",
  "write_files",
  "write_publications",
] as const;

/**
 * Optional scope for templates Claude designs (themeFilesUpsert). Shopify also
 * requires its theme-modification exemption for the app. Requested only when
 * SHOPIFY_THEME_WRITES=1 (the app config must list it too); never required,
 * so stores installed without it keep working with existing templates.
 */
export const SHOPIFY_THEME_WRITE_SCOPE = "write_themes";

/** Scopes asked at install: the required ones, plus write_themes when enabled. */
export function requestedShopifyScopes(env: NodeJS.ProcessEnv = process.env): string[] {
  return env.SHOPIFY_THEME_WRITES === "1"
    ? [...SHOPIFY_SCOPES, SHOPIFY_THEME_WRITE_SCOPE]
    : [...SHOPIFY_SCOPES];
}

/** Whether a store's granted scopes allow writing generated templates. */
export const canWriteThemes = (scopes: readonly string[]) =>
  scopes.includes(SHOPIFY_THEME_WRITE_SCOPE);

/** Metafields shown on generated product pages (namespace `custom`, owner PRODUCT). */
export const SHOPIFY_METAFIELD_DEFINITIONS = [
  {
    namespace: "custom",
    key: "highlights",
    name: "Highlights",
    type: "list.single_line_text_field",
    description: "Key selling points shown on the product page (Trendcart).",
  },
  {
    namespace: "custom",
    key: "faq",
    name: "FAQ",
    type: "json",
    description: 'Product FAQ as [{ "question": "...", "answer": "..." }] (Trendcart).',
  },
  {
    namespace: "custom",
    key: "guarantee",
    name: "Guarantee",
    type: "multi_line_text_field",
    description: "Guarantee / returns text shown on the product page (Trendcart).",
  },
] as const;

/**
 * Custom ID used as the productSet upsert identifier, so re-running draft
 * creation for one Trendcart product updates the same Shopify product.
 * Type `id` metafields are unique per store by construction. Not pinned: it is
 * plumbing, not merchant-facing content.
 */
export const SHOPIFY_PRODUCT_ID_METAFIELD = {
  namespace: "trendcart",
  key: "product_id",
  name: "Trendcart product ID",
  type: "id",
  description: "Links this product to its Trendcart product. Do not edit.",
} as const;

export type ShopifyMetafieldDefinitionSpec =
  (typeof SHOPIFY_METAFIELD_DEFINITIONS)[number] | typeof SHOPIFY_PRODUCT_ID_METAFIELD;

/** Everything ensureMetafieldDefinitions() creates, with whether to pin it in the admin. */
export const ENSURED_METAFIELD_DEFINITIONS: readonly {
  spec: ShopifyMetafieldDefinitionSpec;
  pin: boolean;
}[] = [
  ...SHOPIFY_METAFIELD_DEFINITIONS.map((spec) => ({ spec, pin: true })),
  { spec: SHOPIFY_PRODUCT_ID_METAFIELD, pin: false },
];

/** Online Store app handle, used to find its publication. */
export const ONLINE_STORE_APP_HANDLE = "online_store";

/** Throttle retries inside one Admin API call (cost-based leaky bucket). */
export const THROTTLE_MAX_RETRIES = 3;
/** Never wait longer than this for one throttle retry (keeps steps short). */
export const THROTTLE_MAX_WAIT_MS = 5_000;

/** Secret the mock adapter signs and verifies its fake OAuth callbacks and webhooks with. */
export const MOCK_SHOPIFY_API_KEY = "mock-shopify-api-key";
export const MOCK_SHOPIFY_API_SECRET = "mock-shopify-api-secret";
export const MOCK_SHOP_DOMAIN = "trendcart-demo.myshopify.com";

/** Refresh an expiring offline token when it has less than this left. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type ShopifyEnv = {
  apiKey: string | undefined;
  apiSecret: string | undefined;
  apiVersion: string;
};

/** Env vars read by the Shopify adapter. */
export function readShopifyEnv(env: NodeJS.ProcessEnv = process.env): ShopifyEnv {
  const apiVersion = env.SHOPIFY_API_VERSION?.trim() || DEFAULT_SHOPIFY_API_VERSION;
  if (!/^\d{4}-(01|04|07|10)$/.test(apiVersion) && apiVersion !== "unstable") {
    throw new Error(`SHOPIFY_API_VERSION must look like YYYY-01|04|07|10, got "${apiVersion}".`);
  }
  return {
    apiKey: env.SHOPIFY_API_KEY?.trim() || undefined,
    apiSecret: env.SHOPIFY_API_SECRET?.trim() || undefined,
    apiVersion,
  };
}
