/**
 * Shared contracts for every external integration.
 *
 * Each adapter in lib/integrations/* ships a live.ts and a mock.ts that both
 * implement one of the interfaces below; INTEGRATIONS_MODE picks which one.
 * Services and workflows only ever depend on these interfaces.
 *
 * Secrets arrive here already decrypted by the caller (lib/crypto) and must
 * never be logged or returned to the client.
 */
import { z } from "zod";

import { aiCallSettingsSchema } from "./settings";

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

export const integrationsModeSchema = z.enum(["mock", "live"]);
export type IntegrationsMode = z.infer<typeof integrationsModeSchema>;

export const roleSchema = z.enum(["owner", "media_buyer", "creative", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const productStatusSchema = z.enum([
  "imported",
  "analyzing",
  "awaiting_product_confirmation",
  "sourcing",
  "awaiting_supplier_choice",
  "building_page_and_videos",
  "awaiting_content_approval",
  "preparing_campaign",
  "ready_to_launch",
  "launched",
  "failed",
]);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const gateSchema = z.enum([
  "product_confirmation", // GATE 1
  "supplier_choice", // GATE 2
  "content_approval", // GATE 3
  "launch", // GATE 4
]);
export type Gate = z.infer<typeof gateSchema>;

/** ISO 4217 currency code, e.g. "EUR". */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const moneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

/** Two-letter language (ISO 639-1) and country (ISO 3166-1) codes. */
export const languageSchema = z.string().regex(/^[a-z]{2}$/);
export const countrySchema = z.string().regex(/^[A-Z]{2}$/);

/**
 * Who is calling and through which network path. Every adapter receives it so
 * it can route HTTP through the brand proxy and attribute usage and cost.
 */
export const callContextSchema = z.object({
  workspaceId: z.string().min(1),
  brandId: z.string().min(1).optional(),
  /** Decrypted proxy URL when the brand has an enabled proxy. */
  proxyUrl: z.url().optional(),
  /** Workspace AI settings (models, time limits); adapters default the rest. */
  ai: aiCallSettingsSchema.optional(),
});
export type CallContext = z.infer<typeof callContextSchema>;

export const aiUsageSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "perplexity", "serpapi", "firecrawl"]),
  model: z.string(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

/** AI and paid-API results carry their usage so it lands in usage_monthly. */
export type Metered<T> = { data: T; usage: AiUsage[] };

export type IntegrationErrorCode =
  | "auth_expired" // token expired or revoked: mark the connection, ask to reconnect
  | "permission_denied" // missing scope or app approval
  | "rate_limited"
  | "not_found"
  | "invalid_input"
  | "quota_exceeded" // per-workspace AI cap reached
  | "provider_error"; // anything else upstream; retryable

/** The only error type adapters throw; workflows decide on retries from `retryable`. */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    provider: string,
    code: IntegrationErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = "IntegrationError";
    this.provider = provider;
    this.code = code;
    this.retryable = options?.retryable ?? (code === "rate_limited" || code === "provider_error");
  }
}

/** Short-lived OAuth handshake helpers shared by Shopify and TikTok. */
export const oauthStartSchema = z.object({
  /** Opaque, single-use value stored server-side and checked on callback. */
  state: z.string().min(16),
  redirectUri: z.url(),
});
export type OAuthStart = z.infer<typeof oauthStartSchema>;

/* -------------------------------------------------------------------------- */
/* Shopify                                                                    */
/* -------------------------------------------------------------------------- */

export const shopDomainSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "Expected <shop>.myshopify.com");

export const shopifyCredentialsSchema = z.object({
  shopDomain: shopDomainSchema,
  accessToken: z.string().min(1),
});
export type ShopifyCredentials = z.infer<typeof shopifyCredentialsSchema>;

/** Per-store app credentials, only for app_mode "custom". */
export const shopifyAppCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type ShopifyAppCredentials = z.infer<typeof shopifyAppCredentialsSchema>;

export const shopifyTokenSchema = z.object({
  shopDomain: shopDomainSchema,
  accessToken: z.string().min(1),
  scopes: z.array(z.string()),
});
export type ShopifyToken = z.infer<typeof shopifyTokenSchema>;

export const shopifyShopInfoSchema = z.object({
  shopDomain: shopDomainSchema,
  name: z.string(),
  currency: currencySchema,
  primaryLocale: z.string(),
  plan: z.string().optional(),
});
export type ShopifyShopInfo = z.infer<typeof shopifyShopInfoSchema>;

export const shopifyFaqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

/** Product metafield types Trendcart writes into a template slot (text only). */
export const templateSlotTypeSchema = z.enum([
  "single_line_text_field",
  "multi_line_text_field",
  "rich_text_field",
  "list.single_line_text_field",
]);
export type TemplateSlotType = z.infer<typeof templateSlotTypeSchema>;

const metafieldNamespaceSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const metafieldKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * A product metafield the selected theme template renders through a dynamic
 * source (`{{ product.metafields.<namespace>.<key> }}` in a section or block
 * setting), that Trendcart fills with generated copy.
 */
export const templateSlotSchema = z.object({
  namespace: metafieldNamespaceSchema,
  key: metafieldKeySchema,
  type: templateSlotTypeSchema,
  /** Metafield definition name, e.g. "How to use". */
  name: z.string().max(255),
  description: z.string().max(500).nullable(),
  /** Where the template renders it, e.g. "Image with text › text › text". */
  usedIn: z.array(z.string().max(300)).max(10),
  /** Static texts of the same section (headings, labels): what the slot is about. */
  context: z.array(z.string().max(200)).max(10),
});
export type TemplateSlot = z.infer<typeof templateSlotSchema>;

/** Content structure of one product template of the store's live theme. */
export const productTemplateStructureSchema = z.object({
  /** null = templates/product.json. */
  suffix: z.string().nullable(),
  /** Sections in render order with their block types, for the copywriter. */
  outline: z.array(z.string().max(300)).max(60),
  /** Metafields to generate, in template order. */
  slots: z.array(templateSlotSchema).max(30),
  /** Metafields the template shows that Trendcart does not write (files, references, numbers…). */
  skipped: z.array(z.object({ namespace: z.string(), key: z.string(), type: z.string() })).max(50),
});
export type ProductTemplateStructure = z.infer<typeof productTemplateStructureSchema>;

/* Template generation (a CRO template designed by Claude from the theme's sections) */

/** A theme setting Trendcart can fill (text and simple values; never media or links). */
export const themeSettingSpecSchema = z.object({
  id: z.string(),
  type: z.enum([
    "text",
    "textarea",
    "richtext",
    "inline_richtext",
    "select",
    "radio",
    "checkbox",
    "range",
    "number",
    /** Button / link targets: "product" (this product) or "all_products". */
    "url",
    /** One of the theme color schemes (art direction per section). */
    "color_scheme",
    /** Product photos, only when the template may use images. */
    "image_picker",
  ]),
  label: z.string(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});
export type ThemeSettingSpec = z.infer<typeof themeSettingSpecSchema>;

/** One section of the live theme that a product template may use. */
export const themeSectionSpecSchema = z.object({
  /** sections/<type>.liquid */
  type: z.string(),
  name: z.string(),
  settings: z.array(themeSettingSpecSchema),
  blocks: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      settings: z.array(themeSettingSpecSchema),
      limit: z.number().int().positive().optional(),
    }),
  ),
  maxBlocks: z.number().int().positive().optional(),
  /** Has image/video/product pickers Trendcart leaves empty: it may show placeholders. */
  hasMediaSettings: z.boolean(),
});
export type ThemeSectionSpec = z.infer<typeof themeSectionSpecSchema>;

/** A theme color scheme (config/settings_data.json), for the page's art direction. */
export const themeColorSchemeSchema = z.object({
  id: z.string(),
  background: z.string().nullable(),
  text: z.string().nullable(),
  button: z.string().nullable(),
});
export type ThemeColorScheme = z.infer<typeof themeColorSchemeSchema>;

/** What Claude designs: sections placed after the base template's main product section. */
const planSettingSchema = z.object({ id: z.string(), value: z.string() });

/** Where a block is added in the main product section (the buy box). */
export const mainBlockPositionSchema = z.enum([
  "after_title",
  "after_price",
  "before_buy_buttons",
  "after_buy_buttons",
  "end",
]);

export const templatePlanSchema = z.object({
  /** Blocks added to the buy box (benefits, reassurance, details tabs...). */
  mainBlocks: z
    .array(
      z.object({
        type: z.string(),
        position: mainBlockPositionSchema,
        settings: z.array(planSettingSchema).max(40),
      }),
    )
    .max(8)
    .default([]),
  sections: z
    .array(
      z.object({
        type: z.string(),
        /** Why this section is there (CRO role), shown to reviewers. */
        purpose: z.string().max(300),
        settings: z.array(planSettingSchema).max(40),
        blocks: z
          .array(z.object({ type: z.string(), settings: z.array(planSettingSchema).max(40) }))
          .max(16),
      }),
    )
    .max(12),
});
export type TemplatePlan = z.infer<typeof templatePlanSchema>;

/**
 * Product template a page is built on: an existing template of the live
 * theme ("existing"), or a template Claude designs for this product from the
 * theme's sections, keeping the main product section of `suffix` ("generate").
 */
export const pageTemplateChoiceSchema = z.object({
  mode: z.enum(["existing", "generate"]),
  /** existing: the template; generate: the base template (null = product.json). */
  suffix: z.string().min(1).max(100).nullable(),
  /** generate: sections may show the product photos (image settings filled). */
  withImages: z.boolean().default(false),
  /** Set once the generated template was written to the theme. */
  generated: z
    .object({
      suffix: z.string().min(1).max(100),
      sections: z.array(z.object({ type: z.string(), name: z.string(), purpose: z.string() })),
      generatedAt: z.string(),
    })
    .nullable()
    .default(null),
});
export type PageTemplateChoice = z.infer<typeof pageTemplateChoiceSchema>;

export const shopifyDraftProductInputSchema = z.object({
  /**
   * Stable Trendcart key (e.g. the Trendcart product id). When set, re-running
   * createDraftProduct updates the same Shopify product (custom ID metafield
   * `trendcart.product_id`) instead of creating a duplicate.
   */
  idempotencyKey: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(255),
  descriptionHtml: z.string(),
  /** Search listing; derived from title/description when omitted. */
  seo: z
    .object({ title: z.string().min(1).max(70), description: z.string().min(1).max(320) })
    .optional(),
  /** Theme template suffix, e.g. "trendcart" for templates/product.trendcart.json. */
  templateSuffix: z.string().nullable(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).default([]),
  options: z
    .array(z.object({ name: z.string().min(1), values: z.array(z.string().min(1)).min(1) }))
    .max(3),
  variants: z
    .array(
      z.object({
        /** One value per option, in the same order as `options`. */
        optionValues: z.array(z.string()),
        price: z.number().nonnegative(),
        compareAtPrice: z.number().nonnegative().nullable(),
        sku: z.string().optional(),
      }),
    )
    .min(1),
  /** Public image URLs Shopify fetches itself (originalSource). */
  imageUrls: z.array(z.url()),
  metafields: z.object({
    highlights: z.array(z.string()),
    faq: z.array(shopifyFaqItemSchema),
    guarantee: z.string(),
  }),
  /** Template slot metafields, `value` already in Shopify's format for `type`. */
  extraMetafields: z
    .array(
      z.object({
        namespace: metafieldNamespaceSchema,
        key: metafieldKeySchema,
        type: templateSlotTypeSchema,
        value: z.string().min(1),
      }),
    )
    .max(30)
    .default([]),
});
export type ShopifyDraftProductInput = z.input<typeof shopifyDraftProductInputSchema>;

export const shopifyProductRefSchema = z.object({
  productId: z.string(), // GID
  handle: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  adminUrl: z.url(),
  onlineStoreUrl: z.url().nullable(),
  /** Storefront preview (Shopify `onlineStorePreviewUrl`), available while the product is a draft. */
  previewUrl: z.url().nullable().optional(),
});
export type ShopifyProductRef = z.infer<typeof shopifyProductRefSchema>;

export const shopifyMediaRefSchema = z.object({
  mediaId: z.string(), // GID
  /** Stable CDN URL reused for TikTok uploads after approval. */
  fileUrl: z.url(),
  status: z.enum(["READY", "FAILED"]),
});
export type ShopifyMediaRef = z.infer<typeof shopifyMediaRefSchema>;

export interface ShopifyClient {
  /** Install URL for the public app, or for a custom app when `app` is given. */
  buildInstallUrl(input: {
    shopDomain: string;
    oauth: OAuthStart;
    app?: ShopifyAppCredentials;
  }): string;
  /** Verifies the callback HMAC and state, then exchanges the code for an offline token. */
  completeInstall(input: {
    query: Record<string, string>;
    expectedState: string;
    app?: ShopifyAppCredentials;
  }): Promise<ShopifyToken>;
  /** Verifies an incoming webhook body against X-Shopify-Hmac-Sha256. */
  verifyWebhook(input: {
    rawBody: string;
    hmacHeader: string;
    app?: ShopifyAppCredentials;
  }): boolean;

  getShopInfo(creds: ShopifyCredentials): Promise<ShopifyShopInfo>;
  /** Template suffixes found in the active theme's templates/product*.json (null = default). */
  listProductTemplates(creds: ShopifyCredentials): Promise<(string | null)[]>;
  /**
   * Reads templates/product[.suffix].json of the live theme (read_themes) and
   * the product metafield definitions: the text metafields its sections and
   * blocks render, to generate content for. not_found when the template is gone.
   */
  getProductTemplateStructure(
    creds: ShopifyCredentials,
    suffix: string | null,
  ): Promise<ProductTemplateStructure>;
  /**
   * What a generated template is built from: the base template's JSON (its
   * main product section is kept) and the theme sections usable in product
   * templates (sections/*.liquid schemas). read_themes only.
   */
  getTemplateDesignContext(
    creds: ShopifyCredentials,
    baseSuffix: string | null,
  ): Promise<{
    base: Record<string, unknown>;
    sections: ThemeSectionSpec[];
    /** Blocks the base's main product section accepts (null when unknown). */
    mainSection: ThemeSectionSpec | null;
    colorSchemes: ThemeColorScheme[];
  }>;
  /**
   * Writes templates/product.<suffix>.json to the live theme (themeFilesUpsert:
   * write_themes + a Shopify exemption). Never overwrites a template Trendcart
   * did not generate (suffix must start with "tc-").
   */
  upsertProductTemplate(
    creds: ShopifyCredentials,
    input: { suffix: string; template: Record<string, unknown> },
  ): Promise<void>;
  /**
   * Deletes templates/product.<suffix>.json from the live theme (themeFilesDelete,
   * same scope as upsertProductTemplate). Only "tc-" suffixes; refused when
   * `productId` is ACTIVE and still uses it. Idempotent (deleted: false when gone).
   */
  deleteProductTemplate(
    creds: ShopifyCredentials,
    input: { suffix: string; productId?: string },
  ): Promise<{ deleted: boolean }>;
  /** Idempotent: creates custom.highlights, custom.faq and custom.guarantee if missing. */
  ensureMetafieldDefinitions(creds: ShopifyCredentials): Promise<void>;

  createDraftProduct(
    creds: ShopifyCredentials,
    input: ShopifyDraftProductInput,
  ): Promise<ShopifyProductRef>;
  /** Streams a video from `sourceUrl` into a staged upload, attaches it and waits until READY. */
  attachVideoFromUrl(
    creds: ShopifyCredentials,
    input: {
      productId: string;
      sourceUrl: string;
      alt?: string;
      /** Stable per Trendcart video (use video.id) so a re-run never adds a second copy. */
      idempotencyKey?: string;
      /** Brand proxy for the source fetch. */
      proxyUrl?: string;
    },
  ): Promise<ShopifyMediaRef>;
  deleteProductMedia(
    creds: ShopifyCredentials,
    input: { productId: string; mediaIds: string[] },
  ): Promise<void>;
  /** Sets ACTIVE and publishes to the Online Store. Only after GATE 3. */
  publishProduct(creds: ShopifyCredentials, productId: string): Promise<ShopifyProductRef>;
  /** Sets the product back to DRAFT (idempotent). Reverts a failed GATE 3 publish. */
  unpublishProduct(creds: ShopifyCredentials, productId: string): Promise<ShopifyProductRef>;
}

/* -------------------------------------------------------------------------- */
/* TikTok Ads (Marketing API)                                                 */
/* -------------------------------------------------------------------------- */

export const tiktokAdsCredentialsSchema = z.object({
  advertiserId: z.string().min(1),
  accessToken: z.string().min(1),
});
export type TikTokAdsCredentials = z.infer<typeof tiktokAdsCredentialsSchema>;

export const tiktokAdvertiserSchema = z.object({
  advertiserId: z.string(),
  name: z.string(),
  currency: currencySchema.optional(),
  timezone: z.string().optional(),
});
export type TikTokAdvertiser = z.infer<typeof tiktokAdvertiserSchema>;

export const tiktokIdentitySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("custom"),
    displayName: z.string().min(1),
    avatarUrl: z.url().optional(),
  }),
  /** Spark Ads: authorization code from the creator. */
  z.object({ type: z.literal("spark"), authCode: z.string().min(1) }),
]);
export type TikTokIdentity = z.infer<typeof tiktokIdentitySchema>;

export const campaignSpecSchema = z.object({
  name: z.string().min(1),
  objective: z.enum(["WEB_CONVERSIONS", "TRAFFIC"]),
  budget: z.object({
    mode: z.enum(["daily", "total"]),
    amount: z.number().positive(),
    level: z.enum(["campaign", "ad_group"]),
  }),
  pixelId: z.string().optional(),
  optimizationEvent: z.string().optional(),
  landingPageUrl: z.url(),
  adGroups: z
    .array(
      z.object({
        name: z.string().min(1),
        countries: z.array(countrySchema).min(1),
        ageGroups: z.array(z.string()).optional(),
        gender: z.enum(["all", "male", "female"]).default("all"),
        bidStrategy: z.enum(["lowest_cost", "cost_cap"]),
        bidAmount: z.number().positive().optional(),
        ads: z
          .array(
            z.object({
              name: z.string().min(1),
              videoId: z.string().min(1),
              adText: z.string().min(1).max(100),
              callToAction: z.string().min(1),
              identity: tiktokIdentitySchema,
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type CampaignSpec = z.input<typeof campaignSpecSchema>;

export const campaignIdsSchema = z.object({
  campaignId: z.string(),
  adGroups: z.array(z.object({ adGroupId: z.string(), adIds: z.array(z.string()) })),
});
export type CampaignIds = z.infer<typeof campaignIdsSchema>;

export const hourlyStatSchema = z.object({
  hour: z.iso.datetime(), // start of the hour, UTC
  spend: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  revenue: z.number().nonnegative(),
});
export type HourlyStat = z.infer<typeof hourlyStatSchema>;

export interface TikTokAdsClient {
  buildAuthUrl(oauth: OAuthStart): string;
  /** Exchanges the auth code; the token covers every advertiser the user granted. */
  exchangeAuthCode(input: {
    code: string;
  }): Promise<{ accessToken: string; advertiserIds: string[]; scopes: string[] }>;
  listAdvertisers(input: { accessToken: string }): Promise<TikTokAdvertiser[]>;

  uploadVideoByUrl(
    creds: TikTokAdsCredentials,
    input: { videoUrl: string; fileName: string },
  ): Promise<{ videoId: string }>;
  /** Creates campaign, ad groups and ads, every one of them disabled. Never spends. */
  createPausedCampaign(creds: TikTokAdsCredentials, spec: CampaignSpec): Promise<CampaignIds>;
  /** Enables everything in `ids`. Only called by the launch service after GATE 4. */
  launchCampaign(creds: TikTokAdsCredentials, ids: CampaignIds): Promise<void>;
  pauseCampaign(creds: TikTokAdsCredentials, ids: CampaignIds): Promise<void>;
  /**
   * Optional (added in M3, additive): sets a new budget amount on the
   * entities that carry it (`budget.level`: the campaign or every ad group in
   * `ids`). Never changes their operation status. Adapters without it make
   * the budget-change service answer "not supported yet".
   */
  updateBudget?(
    creds: TikTokAdsCredentials,
    input: { ids: CampaignIds; budget: CampaignSpec["budget"] },
  ): Promise<void>;
  getHourlyStats(
    creds: TikTokAdsCredentials,
    input: { campaignId: string; from: string; to: string },
  ): Promise<HourlyStat[]>;
}

/* -------------------------------------------------------------------------- */
/* TikTok posting (Content Posting API + Login Kit)                           */
/* -------------------------------------------------------------------------- */

export const tiktokProfileTokenSchema = z.object({
  openId: z.string(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  refreshExpiresAt: z.iso.datetime().optional(),
  scopes: z.array(z.string()),
});
export type TikTokProfileToken = z.infer<typeof tiktokProfileTokenSchema>;

export const tiktokPrivacyLevelSchema = z.enum([
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "PUBLIC_TO_EVERYONE",
]);
export type TikTokPrivacyLevel = z.infer<typeof tiktokPrivacyLevelSchema>;

export const tiktokCreatorInfoSchema = z.object({
  displayName: z.string(),
  avatarUrl: z.url().optional(),
  privacyLevelOptions: z.array(tiktokPrivacyLevelSchema),
  maxVideoPostDurationSec: z.number().int().positive(),
  commentDisabled: z.boolean(),
  duetDisabled: z.boolean(),
  stitchDisabled: z.boolean(),
});
export type TikTokCreatorInfo = z.infer<typeof tiktokCreatorInfoSchema>;

export const tiktokPublishStatusSchema = z.object({
  status: z.enum([
    "PROCESSING_UPLOAD",
    "PROCESSING_DOWNLOAD",
    "SEND_TO_USER_INBOX",
    "PUBLISH_COMPLETE",
    "FAILED",
  ]),
  failReason: z.string().optional(),
  postIds: z.array(z.string()).default([]),
});
export type TikTokPublishStatus = z.infer<typeof tiktokPublishStatusSchema>;

export interface TikTokPostingClient {
  buildAuthUrl(oauth: OAuthStart): string;
  exchangeAuthCode(input: { code: string; redirectUri: string }): Promise<TikTokProfileToken>;
  refreshToken(input: { refreshToken: string }): Promise<TikTokProfileToken>;
  getCreatorInfo(input: { accessToken: string }): Promise<TikTokCreatorInfo>;
  /**
   * Chunked FILE_UPLOAD streamed from `sourceUrl` (the Shopify file URL).
   * `privacyLevel` must be SELF_ONLY while the app is unaudited.
   */
  publishVideoFromUrl(input: {
    accessToken: string;
    sourceUrl: string;
    caption: string;
    privacyLevel: TikTokPrivacyLevel;
    /** Brand proxy for the source reads (HEAD / Range) from the Shopify URL. */
    proxyUrl?: string;
  }): Promise<{ publishId: string }>;
  getPublishStatus(input: { accessToken: string; publishId: string }): Promise<TikTokPublishStatus>;
}

/* -------------------------------------------------------------------------- */
/* TikTok data (third-party provider: resolve and search public videos)       */
/* -------------------------------------------------------------------------- */

/*
 * TikTok video or short-link URL. Mirrors the forms accepted by
 * lib/integrations/tiktok-data/links.ts (kept inline: that module imports
 * this one). Profiles, tags, music and search pages are rejected.
 */
const TIKTOK_VIDEO_PATHS = [
  /^\/@[^/]+\/(video|photo)\/\d{15,21}(\/.*)?$/, // www.tiktok.com/@user/video/<id>
  /^\/v\/\d{15,21}(\.html)?\/?$/, // m.tiktok.com/v/<id>.html
  /^\/embed(\/v2)?\/\d{15,21}\/?$/, // www.tiktok.com/embed/v2/<id>
  /^\/t\/[A-Za-z0-9]{5,20}\/?$/, // www.tiktok.com/t/<code>
];
const TIKTOK_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

export function isTikTokVideoUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.port) return false;
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return false;
  if (TIKTOK_SHORT_HOSTS.has(host)) return /^\/[A-Za-z0-9]{5,20}\/?$/.test(url.pathname);
  return TIKTOK_VIDEO_PATHS.some((re) => re.test(url.pathname));
}

export const tiktokVideoUrlSchema = z
  .url()
  .refine(
    isTikTokVideoUrl,
    "Expected a TikTok video link (tiktok.com/@user/video/… or vm.tiktok.com/…)",
  );

export const videoCandidateSchema = z.object({
  tiktokUrl: z.url(),
  tiktokVideoId: z.string(),
  author: z.object({ username: z.string(), displayName: z.string().optional() }),
  caption: z.string(),
  thumbnailUrl: z.url(),
  stats: z.object({
    views: z.number().int().nonnegative(),
    likes: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    shares: z.number().int().nonnegative(),
  }),
  durationSec: z.number().nonnegative(),
  postedAt: z.iso.datetime().optional(),
});
export type VideoCandidate = z.infer<typeof videoCandidateSchema>;

export const resolvedTikTokVideoSchema = videoCandidateSchema.extend({
  /** Short-lived, provider-signed URL. Never persist it; resolve again when needed. */
  mediaUrl: z.url(),
  mediaUrlExpiresAt: z.iso.datetime().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ResolvedTikTokVideo = z.infer<typeof resolvedTikTokVideoSchema>;

export interface TikTokDataProvider {
  resolveVideo(ctx: CallContext, url: string): Promise<ResolvedTikTokVideo>;
  searchVideos(
    ctx: CallContext,
    input: { query: string; country?: string; limit?: number },
  ): Promise<VideoCandidate[]>;
}

/* -------------------------------------------------------------------------- */
/* AI: product analysis                                                       */
/* -------------------------------------------------------------------------- */

export const productAnalysisSchema = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  description: z.string(),
  features: z.array(z.string()),
  sellingPoints: z.array(z.string()),
  /** Search keywords for supplier lookup and related videos. */
  keywords: z.array(z.string()).min(1),
  /** Seconds into the video where the product is most visible (video sources only). */
  bestFrameSec: z.number().nonnegative().nullable(),
  /** Image to feed reverse image search; from the page or a frame thumbnail. */
  referenceImageUrl: z.url().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ProductAnalysis = z.infer<typeof productAnalysisSchema>;

export const analyzeInputSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("tiktok_video"),
    /** Fresh media URL from TikTokDataProvider.resolveVideo; streamed, never stored. */
    mediaUrl: z.url(),
    caption: z.string().optional(),
    thumbnailUrl: z.url().optional(),
  }),
  z.object({ source: z.literal("product_link"), url: z.url() }),
]);
export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

/** Feedback from GATE 1 rejections, so a re-analysis can correct course. */
export const analyzeHintSchema = z.object({
  note: z.string().max(2000).optional(),
  rejectedProductNames: z.array(z.string()).max(20).optional(),
});
export type AnalyzeHint = z.infer<typeof analyzeHintSchema>;

export interface ProductAnalyzer {
  analyze(
    ctx: CallContext,
    input: AnalyzeInput & { language: string; hint?: AnalyzeHint },
  ): Promise<Metered<ProductAnalysis>>;
}

/* -------------------------------------------------------------------------- */
/* Sourcing: supplier listings                                                */
/* -------------------------------------------------------------------------- */

/** Scraped URLs: web schemes only (z.url() alone accepts javascript: and data:). */
const webUrlSchema = z.url({ protocol: /^https?$/ });

export const supplierListingSchema = z.object({
  source: z.string(), // e.g. "aliexpress", "amazon", domain otherwise
  url: webUrlSchema,
  title: z.string(),
  price: moneySchema,
  shipping: moneySchema.nullable(),
  leadTimeDays: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
    .nullable(),
  images: z.array(webUrlSchema),
  variants: z.array(
    z.object({ name: z.string(), values: z.array(z.string()), price: moneySchema.optional() }),
  ),
  /** 0..1 similarity with the analysed product. */
  matchScore: z.number().min(0).max(1),
  /** Average rating out of 5 printed on the listing; null when not shown. */
  rating: z.number().min(0).max(5).nullable().default(null),
  /** Number of reviews printed on the listing; null when not shown. */
  reviewCount: z.number().int().nonnegative().nullable().default(null),
  /**
   * 0..1 quality/price ratio among the listings of one search: relevance,
   * landed cost, rating (weighted by review count) and delivery time
   * (lib/sourcing/value.ts). Listings are offered best value first.
   */
  valueScore: z.number().min(0).max(1).default(0),
});
export type SupplierListing = z.infer<typeof supplierListingSchema>;
export type SupplierListingInput = z.input<typeof supplierListingSchema>;

export interface SupplierFinder {
  find(
    ctx: CallContext,
    input: {
      imageUrl: string | null;
      keywords: string[];
      country: string;
      currency: string;
      limit?: number;
      /** Listing URLs rejected at GATE 2: never return these again. */
      excludeUrls?: string[];
    },
    /**
     * Listings best value first. AliExpress, CJ Dropshipping and Amazon are
     * always searched; the best offer of each is returned when one matches
     * the product (REQUIRED_SUPPLIER_SOURCES).
     */
  ): Promise<Metered<SupplierListing[]>>;
}

/* -------------------------------------------------------------------------- */
/* Compliance                                                                 */
/* -------------------------------------------------------------------------- */

export const complianceVerdictSchema = z.enum(["pass", "warn", "fail"]);
export type ComplianceVerdict = z.infer<typeof complianceVerdictSchema>;

export const complianceReportSchema = z.object({
  overall: complianceVerdictSchema,
  rules: z.array(
    z.object({
      ruleId: z.string(), // e.g. "tech.duration", "policy.health_claims"
      kind: z.enum(["technical", "policy"]),
      verdict: complianceVerdictSchema,
      reason: z.string(),
    }),
  ),
  checkedAt: z.iso.datetime(),
});
export type ComplianceReport = z.infer<typeof complianceReportSchema>;

export interface ComplianceChecker {
  check(
    ctx: CallContext,
    input: {
      durationSec: number;
      width: number;
      height: number;
      caption: string;
      /** Ad text and page claims the video will run with. */
      claims: string[];
      productCategory: string;
      countries: string[];
      /**
       * Fresh media URL from `TikTokDataProvider.resolveVideo`, used only for
       * the visual review (streamed to Gemini Files). Never stored.
       */
      mediaUrl?: string;
    },
  ): Promise<Metered<ComplianceReport>>;
}

/* -------------------------------------------------------------------------- */
/* Copywriting                                                                */
/* -------------------------------------------------------------------------- */

/** Max characters of one template field (lists: the whole field, items joined by newlines). */
export const TEMPLATE_FIELD_MAX = 5000;

export const pageTemplateFieldSchema = z.object({
  namespace: metafieldNamespaceSchema,
  key: metafieldKeySchema,
  type: templateSlotTypeSchema,
  /** Slot name shown to reviewers. */
  label: z.string().min(1).max(255),
  value: z.string().trim().min(1).max(TEMPLATE_FIELD_MAX),
});
export type PageTemplateField = z.infer<typeof pageTemplateFieldSchema>;

export const pageCopySchema = z.object({
  title: z.string().min(1).max(255),
  descriptionHtml: z.string().min(1),
  highlights: z.array(z.string().min(1)).min(3).max(6),
  faq: z.array(shopifyFaqItemSchema).min(3).max(8),
  guarantee: z.string().min(1),
  /** Short primary texts for ads, ≤ 100 chars each. */
  adTexts: z.array(z.string().min(1).max(100)).min(1).max(5),
  /** Search listing (Shopify product SEO title / meta description). Optional, additive in M2. */
  seo: z
    .object({ title: z.string().min(1).max(70), description: z.string().min(1).max(320) })
    .optional(),
  /**
   * Content for the selected template's slots (see TemplateSlot), pushed as
   * product metafields. Plain text; list types hold one item per line.
   */
  templateFields: z.array(pageTemplateFieldSchema).max(30).optional(),
});
export type PageCopy = z.infer<typeof pageCopySchema>;

export const copyHintSchema = z.object({
  note: z.string().max(2000).optional(),
  previousTitle: z.string().max(255).optional(),
});
export type CopyHint = z.infer<typeof copyHintSchema>;

export interface Copywriter {
  writePage(
    ctx: CallContext,
    input: {
      analysis: ProductAnalysis;
      supplier: SupplierListing | null;
      language: string;
      brandName: string;
      /** GATE 3 rejection feedback that steers a regeneration. */
      hint?: CopyHint;
      /** Selected theme template: the copy fills its slots (templateFields). */
      template?: Pick<ProductTemplateStructure, "outline" | "slots">;
    },
  ): Promise<Metered<PageCopy>>;
  /**
   * Designs a conversion-oriented product page from the theme's sections:
   * which sections, in which order, with their text settings, consistent
   * with the page copy. Only types and setting ids of `sections` are valid.
   */
  designTemplate(
    ctx: CallContext,
    input: {
      analysis: ProductAnalysis;
      copy: PageCopy;
      language: string;
      brandName: string;
      sections: ThemeSectionSpec[];
      /** Buy box blocks that can be added (null: none). */
      mainSection: ThemeSectionSpec | null;
      colorSchemes: ThemeColorScheme[];
      /** Product photos: shown to the model for the art direction; "image:N" refers to them. */
      imageUrls: string[];
      /** Whether image settings may be filled with the product photos. */
      withImages: boolean;
    },
  ): Promise<Metered<TemplatePlan>>;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

/** What lib/integrations/index.ts resolves for the current INTEGRATIONS_MODE. */
export interface Integrations {
  mode: IntegrationsMode;
  shopify: ShopifyClient;
  tiktokAds: TikTokAdsClient;
  tiktokPosting: TikTokPostingClient;
  tiktokData: TikTokDataProvider;
  productAnalyzer: ProductAnalyzer;
  supplierFinder: SupplierFinder;
  complianceChecker: ComplianceChecker;
  copywriter: Copywriter;
}
