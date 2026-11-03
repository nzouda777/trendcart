/**
 * Business tables. Every table carries `workspace_id` (FK to organization) and
 * an index on it. Never query these directly: go through
 * lib/tenant/scoped-db.ts, which injects the session workspace.
 *
 * Cross-workspace references are impossible at the database level too: every
 * parent table has a UNIQUE (workspace_id, id) and every child references it
 * with a composite FK (workspace_id, parent_id), so a row can only point at a
 * parent in its own workspace.
 *
 * Secrets live in `*_enc` columns as lib/crypto envelopes (the envelope carries
 * the key version used, for rotation).
 */
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  gateSchema,
  productStatusSchema,
  type CampaignIds,
  type CampaignSpec,
  type ComplianceReport,
  type Gate,
  type PageCopy,
  type ProductAnalysis,
  type ProductStatus,
} from "../../domain/contracts";

import { organization, user } from "./auth";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

type NonEmpty<T> = [T, ...T[]];

export const productStatusEnum = pgEnum(
  "product_status",
  productStatusSchema.options as NonEmpty<ProductStatus>,
);
export const gateEnum = pgEnum("approval_gate", gateSchema.options as NonEmpty<Gate>);
export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected"]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "pending",
  "active",
  /** Usable, but the refresh token (or a non-refreshable token) expires soon: prompt a reconnect. */
  "expiring",
  /** Token refresh failed or the token expired: the user must reconnect. */
  "needs_reauth",
  /** The provider revoked access (app uninstalled, consent withdrawn): reconnect from scratch. */
  "revoked",
  "disconnected",
]);
export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];
export const shopifyAppModeEnum = pgEnum("shopify_app_mode", ["public", "custom"]);
export const productSourceTypeEnum = pgEnum("product_source_type", [
  "tiktok_video",
  "product_link",
]);
export const videoOriginEnum = pgEnum("video_origin", [
  "imported", // the TikTok link the product was imported from
  "related_search", // found by the related-video search
  "user_supplied", // a TikTok URL added by a user
]);
export const videoApprovalEnum = pgEnum("video_approval", ["pending", "approved", "rejected"]);
export const shopifyProductStatusEnum = pgEnum("shopify_product_status", [
  "draft",
  "active",
  "archived",
]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "creating",
  "paused", // created in TikTok, every entity disabled
  "active", // launched after GATE 4
  "failed",
]);
export const tiktokPostStatusEnum = pgEnum("tiktok_post_status", [
  "pending",
  "processing",
  "published",
  "failed",
]);
export const tiktokPostingModeEnum = pgEnum("tiktok_posting_mode", [
  "direct", // Direct Post (private until the app passes TikTok's audit)
  "inbox", // Upload to the creator's inbox as a draft
]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);

/* -------------------------------------------------------------------------- */
/* Column helpers                                                             */
/* -------------------------------------------------------------------------- */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const workspaceId = () =>
  text("workspace_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const createdAt = () => tz("created_at").defaultNow().notNull();
const updatedAt = () =>
  tz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

type WsTable = { workspaceId: AnyPgColumn; id: AnyPgColumn };

/** Composite FK that keeps parent and child in the same workspace. */
function sameWorkspaceFk(
  name: string,
  child: { workspaceId: AnyPgColumn; ref: AnyPgColumn },
  parent: () => WsTable,
  onDelete: "cascade" | "restrict" = "cascade",
) {
  const p = parent();
  return foreignKey({
    name,
    columns: [child.workspaceId, child.ref],
    foreignColumns: [p.workspaceId, p.id],
  }).onDelete(onDelete);
}

/* -------------------------------------------------------------------------- */
/* JSON shapes                                                                */
/* -------------------------------------------------------------------------- */

/** How a selling price is derived from the landed cost. */
export type PricingRule = {
  /** Selling price = landed cost × multiplier. */
  multiplier: number;
  /** Optional psychological ending, e.g. 0.99. */
  roundTo?: number;
  /** compare_at_price = selling price × this, when set. */
  compareAtMultiplier?: number;
};

export type MarginBreakdown = {
  currency: string;
  productCost: number;
  shippingCost: number;
  fees: number;
  landedCost: number;
  sellingPrice: number;
  grossMargin: number;
  /** 0..1 */
  marginRate: number;
};

export type LeadTime = { min: number; max: number } | null;

/** advertiser_id → TikTok video_id. */
export type TikTokVideoIds = Record<string, string>;

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

export const brand = pgTable(
  "brand",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    /** ISO 3166-1 alpha-2, e.g. "FR". */
    country: text("country").notNull(),
    /** ISO 639-1, e.g. "fr". */
    language: text("language").notNull(),
    /** ISO 4217, used for margins and budgets. */
    currency: text("currency").notNull().default("USD"),
    defaultTestBudget: money("default_test_budget"),
    /** Minimum acceptable margin rate, 0..1. */
    minMargin: numeric("min_margin", { precision: 5, scale: 4, mode: "number" }),
    pricingRule: jsonb("pricing_rule").$type<PricingRule>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("brand_workspace_idx").on(t.workspaceId),
    unique("brand_workspace_id_uq").on(t.workspaceId, t.id),
  ],
);

export const proxy = pgTable(
  "proxy",
  {
    id: id(),
    workspaceId: workspaceId(),
    brandId: text("brand_id").notNull(),
    /** Encrypted proxy URL, credentials included. */
    urlEnc: text("url_enc").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("proxy_workspace_idx").on(t.workspaceId),
    uniqueIndex("proxy_brand_uidx").on(t.workspaceId, t.brandId),
    sameWorkspaceFk("proxy_brand_fk", { workspaceId: t.workspaceId, ref: t.brandId }, () => brand),
  ],
);

export const shopifyConnection = pgTable(
  "shopify_connection",
  {
    id: id(),
    workspaceId: workspaceId(),
    brandId: text("brand_id").notNull(),
    shopDomain: text("shop_domain").notNull(),
    /**
     * Encrypted access token. Target format: the bare token. Legacy rows (M1)
     * hold an encrypted JSON bundle {v, accessToken, refreshToken, expiresAt,
     * refreshTokenExpiresAt}; readers must keep accepting it while
     * `refresh_token_enc` is null, and rewrite the row in the new format on the
     * next token write (the bundle cannot be split in SQL: it is encrypted).
     */
    accessTokenEnc: text("access_token_enc"),
    /** Encrypted refresh token (expiring offline tokens only). */
    refreshTokenEnc: text("refresh_token_enc"),
    /** Access-token expiry; null for non-expiring tokens. */
    tokenExpiresAt: tz("token_expires_at"),
    /** Refresh-token expiry; null when Shopify returns none. */
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scopes: text("scopes").array().notNull().default([]),
    appMode: shopifyAppModeEnum("app_mode").notNull().default("public"),
    /** Custom-app client id (app_mode "custom" only). */
    clientId: text("client_id"),
    clientSecretEnc: text("client_secret_enc"),
    /** Theme template suffix used for generated pages (null = default template). */
    templateSuffix: text("template_suffix"),
    status: connectionStatusEnum("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shopify_connection_workspace_idx").on(t.workspaceId),
    unique("shopify_connection_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("shopify_connection_shop_uidx").on(t.workspaceId, t.shopDomain),
    sameWorkspaceFk(
      "shopify_connection_brand_fk",
      { workspaceId: t.workspaceId, ref: t.brandId },
      () => brand,
    ),
  ],
);

export const tiktokAdConnection = pgTable(
  "tiktok_ad_connection",
  {
    id: id(),
    workspaceId: workspaceId(),
    brandId: text("brand_id").notNull(),
    advertiserId: text("advertiser_id").notNull(),
    name: text("name").notNull(),
    accessTokenEnc: text("access_token_enc"),
    status: connectionStatusEnum("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tiktok_ad_connection_workspace_idx").on(t.workspaceId),
    unique("tiktok_ad_connection_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("tiktok_ad_connection_advertiser_uidx").on(t.workspaceId, t.advertiserId),
    sameWorkspaceFk(
      "tiktok_ad_connection_brand_fk",
      { workspaceId: t.workspaceId, ref: t.brandId },
      () => brand,
    ),
  ],
);

export const tiktokProfileConnection = pgTable(
  "tiktok_profile_connection",
  {
    id: id(),
    workspaceId: workspaceId(),
    brandId: text("brand_id").notNull(),
    openId: text("open_id").notNull(),
    displayName: text("display_name").notNull(),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    /** Access-token expiry (24 h). */
    expiresAt: tz("expires_at"),
    /** Refresh-token expiry (365 days); past it the creator must reconnect. */
    refreshExpiresAt: tz("refresh_expires_at"),
    postingMode: tiktokPostingModeEnum("posting_mode").notNull().default("direct"),
    status: connectionStatusEnum("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tiktok_profile_connection_workspace_idx").on(t.workspaceId),
    unique("tiktok_profile_connection_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("tiktok_profile_connection_open_id_uidx").on(t.workspaceId, t.openId),
    sameWorkspaceFk(
      "tiktok_profile_connection_brand_fk",
      { workspaceId: t.workspaceId, ref: t.brandId },
      () => brand,
    ),
  ],
);

export const product = pgTable(
  "product",
  {
    id: id(),
    workspaceId: workspaceId(),
    brandId: text("brand_id").notNull(),
    sourceType: productSourceTypeEnum("source_type").notNull(),
    sourceUrl: text("source_url").notNull(),
    status: productStatusEnum("status").notNull().default("imported"),
    name: text("name"),
    analysis: jsonb("analysis").$type<ProductAnalysis>(),
    sellingPrice: money("selling_price"),
    compareAtPrice: money("compare_at_price"),
    margin: jsonb("margin").$type<MarginBreakdown>(),
    /** Copywriter output (validated with pageCopySchema), reviewed at GATE 3. */
    pageCopy: jsonb("page_copy").$type<PageCopy>(),
    /** When `page_copy` was last (re)generated. */
    pageCopyGeneratedAt: tz("page_copy_generated_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("product_workspace_idx").on(t.workspaceId),
    index("product_workspace_status_idx").on(t.workspaceId, t.status),
    index("product_brand_idx").on(t.workspaceId, t.brandId),
    unique("product_workspace_id_uq").on(t.workspaceId, t.id),
    sameWorkspaceFk(
      "product_brand_fk",
      { workspaceId: t.workspaceId, ref: t.brandId },
      () => brand,
    ),
  ],
);

export const supplierMatch = pgTable(
  "supplier_match",
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text("product_id").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    currency: text("currency").notNull(),
    price: money("price").notNull(),
    shipping: money("shipping"),
    leadTime: jsonb("lead_time").$type<LeadTime>(),
    images: jsonb("images").$type<string[]>().notNull().default([]),
    /** Raw listing extras (variants, match score). */
    details: jsonb("details").$type<Record<string, unknown>>(),
    selected: boolean("selected").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supplier_match_workspace_idx").on(t.workspaceId),
    index("supplier_match_product_idx").on(t.workspaceId, t.productId),
    uniqueIndex("supplier_match_product_url_uidx").on(t.workspaceId, t.productId, t.url),
    sameWorkspaceFk(
      "supplier_match_product_fk",
      { workspaceId: t.workspaceId, ref: t.productId },
      () => product,
    ),
  ],
);

export const video = pgTable(
  "video",
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text("product_id").notNull(),
    tiktokUrl: text("tiktok_url").notNull(),
    author: text("author"),
    thumbnailUrl: text("thumbnail_url"),
    /** Provider metadata (caption, stats, duration). Never a media URL. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    origin: videoOriginEnum("origin").notNull(),
    compliance: jsonb("compliance").$type<ComplianceReport>(),
    approval: videoApprovalEnum("approval").notNull().default("pending"),
    shopifyMediaId: text("shopify_media_id"),
    shopifyFileUrl: text("shopify_file_url"),
    tiktokVideoIds: jsonb("tiktok_video_ids").$type<TikTokVideoIds>().notNull().default({}),
    sparkCodeEnc: text("spark_code_enc"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("video_workspace_idx").on(t.workspaceId),
    index("video_product_idx").on(t.workspaceId, t.productId),
    unique("video_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("video_product_url_uidx").on(t.workspaceId, t.productId, t.tiktokUrl),
    sameWorkspaceFk(
      "video_product_fk",
      { workspaceId: t.workspaceId, ref: t.productId },
      () => product,
    ),
  ],
);

export const shopifyProduct = pgTable(
  "shopify_product",
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text("product_id").notNull(),
    connectionId: text("connection_id").notNull(),
    shopifyProductId: text("shopify_product_id").notNull(),
    handle: text("handle").notNull(),
    status: shopifyProductStatusEnum("status").notNull().default("draft"),
    /**
     * Latest URLs from the Shopify product ref. `preview_url` is the draft
     * preview (Product.onlineStorePreviewUrl); `storefront_url` is the public
     * product URL (only reachable once published); `admin_url` opens the
     * product in the Shopify admin. Null until known.
     */
    previewUrl: text("preview_url"),
    adminUrl: text("admin_url"),
    storefrontUrl: text("storefront_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shopify_product_workspace_idx").on(t.workspaceId),
    uniqueIndex("shopify_product_product_connection_uidx").on(
      t.workspaceId,
      t.productId,
      t.connectionId,
    ),
    sameWorkspaceFk(
      "shopify_product_product_fk",
      { workspaceId: t.workspaceId, ref: t.productId },
      () => product,
    ),
    sameWorkspaceFk(
      "shopify_product_connection_fk",
      { workspaceId: t.workspaceId, ref: t.connectionId },
      () => shopifyConnection,
      "restrict",
    ),
  ],
);

export const campaign = pgTable(
  "campaign",
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text("product_id").notNull(),
    adConnectionId: text("ad_connection_id").notNull(),
    tiktokIds: jsonb("tiktok_ids").$type<CampaignIds>(),
    config: jsonb("config").$type<CampaignSpec>().notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    launchedAt: tz("launched_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("campaign_workspace_idx").on(t.workspaceId),
    index("campaign_product_idx").on(t.workspaceId, t.productId),
    unique("campaign_workspace_id_uq").on(t.workspaceId, t.id),
    sameWorkspaceFk(
      "campaign_product_fk",
      { workspaceId: t.workspaceId, ref: t.productId },
      () => product,
    ),
    sameWorkspaceFk(
      "campaign_ad_connection_fk",
      { workspaceId: t.workspaceId, ref: t.adConnectionId },
      () => tiktokAdConnection,
      "restrict",
    ),
  ],
);

export const campaignStatsHourly = pgTable(
  "campaign_stats_hourly",
  {
    id: id(),
    workspaceId: workspaceId(),
    campaignId: text("campaign_id").notNull(),
    /** Start of the hour, UTC. */
    hour: tz("hour").notNull(),
    spend: money("spend").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    revenue: money("revenue").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("campaign_stats_hourly_workspace_idx").on(t.workspaceId),
    uniqueIndex("campaign_stats_hourly_campaign_hour_uidx").on(t.workspaceId, t.campaignId, t.hour),
    sameWorkspaceFk(
      "campaign_stats_hourly_campaign_fk",
      { workspaceId: t.workspaceId, ref: t.campaignId },
      () => campaign,
    ),
  ],
);

export const tiktokPost = pgTable(
  "tiktok_post",
  {
    id: id(),
    workspaceId: workspaceId(),
    videoId: text("video_id").notNull(),
    profileConnectionId: text("profile_connection_id").notNull(),
    publishId: text("publish_id"),
    status: tiktokPostStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tiktok_post_workspace_idx").on(t.workspaceId),
    uniqueIndex("tiktok_post_video_profile_uidx").on(
      t.workspaceId,
      t.videoId,
      t.profileConnectionId,
    ),
    sameWorkspaceFk(
      "tiktok_post_video_fk",
      { workspaceId: t.workspaceId, ref: t.videoId },
      () => video,
    ),
    sameWorkspaceFk(
      "tiktok_post_profile_fk",
      { workspaceId: t.workspaceId, ref: t.profileConnectionId },
      () => tiktokProfileConnection,
      "restrict",
    ),
  ],
);

export const job = pgTable(
  "job",
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text("product_id").notNull(),
    /** Workflow step name, e.g. "analyze". */
    step: text("step").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    aiCostUsd: numeric("ai_cost_usd", { precision: 10, scale: 4, mode: "number" })
      .notNull()
      .default(0),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("job_workspace_idx").on(t.workspaceId),
    index("job_product_idx").on(t.workspaceId, t.productId),
    sameWorkspaceFk(
      "job_product_fk",
      { workspaceId: t.workspaceId, ref: t.productId },
      () => product,
    ),
  ],
);

export const approval = pgTable(
  "approval",
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text("product_id").notNull(),
    gate: gateEnum("gate").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: approvalDecisionEnum("decision").notNull(),
    note: text("note"),
    /** Gate-specific choice, e.g. { supplierMatchId } or { videoIds }. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("approval_workspace_idx").on(t.workspaceId),
    index("approval_product_idx").on(t.workspaceId, t.productId),
    sameWorkspaceFk(
      "approval_product_fk",
      { workspaceId: t.workspaceId, ref: t.productId },
      () => product,
    ),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: workspaceId(),
    /** Null for system actions (cron, webhooks). */
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Redacted by lib/audit before insert: never secrets. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_workspace_idx").on(t.workspaceId),
    index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("audit_log_target_idx").on(t.workspaceId, t.targetType, t.targetId),
  ],
);

export const usageMonthly = pgTable(
  "usage_monthly",
  {
    id: id(),
    workspaceId: workspaceId(),
    /** "YYYY-MM", UTC. */
    month: text("month").notNull(),
    aiCostUsd: numeric("ai_cost_usd", { precision: 12, scale: 4, mode: "number" })
      .notNull()
      .default(0),
    apiCalls: integer("api_calls").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("usage_monthly_workspace_idx").on(t.workspaceId),
    uniqueIndex("usage_monthly_workspace_month_uidx").on(t.workspaceId, t.month),
  ],
);

/**
 * Workspace settings (one row per workspace, created on first save). Every
 * null column means "use the default" (env var or built-in value), see
 * lib/settings.
 */
export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    id: id(),
    workspaceId: workspaceId(),
    /** Gemini model for product analysis (lib/domain/settings ANALYSIS_MODELS). */
    analysisModel: text("analysis_model"),
    /** Claude model for page copy (COPYWRITING_MODELS). */
    copywritingModel: text("copywriting_model"),
    /** Monthly AI + paid API budget; 0 disables AI calls. */
    aiMonthlyCapUsd: numeric("ai_monthly_cap_usd", { precision: 10, scale: 2, mode: "number" }),
    /** Whole product analysis (download, upload, model call). */
    analysisTimeoutSec: integer("analysis_timeout_sec"),
    /** One page copy generation. */
    copywritingTimeoutSec: integer("copywriting_timeout_sec"),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workspace_settings_workspace_uidx").on(t.workspaceId)],
);

/**
 * Every workspace-scoped table. lib/tenant/scoped-db only accepts these.
 * Add new business tables here, or they cannot be queried.
 */
export const businessTables = {
  brand,
  workspaceSettings,
  proxy,
  shopifyConnection,
  tiktokAdConnection,
  tiktokProfileConnection,
  product,
  supplierMatch,
  video,
  shopifyProduct,
  campaign,
  campaignStatsHourly,
  tiktokPost,
  job,
  approval,
  auditLog,
  usageMonthly,
};

export const businessEnums = {
  productStatusEnum,
  gateEnum,
  approvalDecisionEnum,
  connectionStatusEnum,
  shopifyAppModeEnum,
  productSourceTypeEnum,
  videoOriginEnum,
  videoApprovalEnum,
  shopifyProductStatusEnum,
  campaignStatusEnum,
  tiktokPostStatusEnum,
  tiktokPostingModeEnum,
  jobStatusEnum,
};
