/**
 * DTOs returned by lib/services: plain, serialisable (dates as ISO strings),
 * and free of secrets (no *_enc columns, no tokens, no proxy credentials).
 * Safe to import from client components.
 */
import type {
  ComplianceReport,
  Gate,
  PageCopy,
  PageTemplateChoice,
  ProductAnalysis,
  ProductStatus,
  Role,
} from "@/lib/domain/contracts";
import type { GatePart, ProductStep } from "@/lib/domain/state-machine";
import type { MarginBreakdown, PricingRule } from "@/lib/db/schema/business";

export type ISODate = string;

/* Brands ------------------------------------------------------------------- */

export type BrandProxyDTO = {
  configured: boolean;
  enabled: boolean;
  /** "scheme://host:port" only, never the credentials. */
  display: string | null;
  updatedAt: ISODate | null;
};

export type BrandDTO = {
  id: string;
  name: string;
  country: string;
  language: string;
  currency: string;
  defaultTestBudget: number | null;
  /** 0..1 */
  minMargin: number | null;
  pricingRule: PricingRule | null;
  proxy: BrandProxyDTO;
  createdAt: ISODate;
  updatedAt: ISODate;
};

/* Connections -------------------------------------------------------------- */

export type ConnectionKind = "shopify" | "tiktok_ads" | "tiktok_profile";
/** Same values as the `connection_status` enum (lib/db/schema). */
export type ConnectionStatus = import("@/lib/db/schema").ConnectionStatus;
/** green = working, orange = needs attention soon / setup incomplete, red = broken. */
export type ConnectionHealth = "green" | "orange" | "red";

type ConnectionBase = {
  id: string;
  brandId: string;
  status: ConnectionStatus;
  health: ConnectionHealth;
  /** Short human explanation of the health colour. */
  healthReason: string;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type ShopifyConnectionDTO = ConnectionBase & {
  kind: "shopify";
  shopDomain: string;
  scopes: string[];
  appMode: "public" | "custom";
  templateSuffix: string | null;
};

export type TikTokAdConnectionDTO = ConnectionBase & {
  kind: "tiktok_ads";
  advertiserId: string;
  name: string;
};

export type TikTokProfileConnectionDTO = ConnectionBase & {
  kind: "tiktok_profile";
  openId: string;
  displayName: string;
  postingMode: "direct" | "inbox";
  expiresAt: ISODate | null;
};

export type ConnectionDTO =
  ShopifyConnectionDTO | TikTokAdConnectionDTO | TikTokProfileConnectionDTO;

export type BrandConnectionsDTO = {
  brandId: string;
  shopify: ShopifyConnectionDTO[];
  tiktokAds: TikTokAdConnectionDTO[];
  tiktokProfiles: TikTokProfileConnectionDTO[];
};

/* Team --------------------------------------------------------------------- */

export type MemberDTO = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: ISODate;
  isCurrentUser: boolean;
};

/* Products ----------------------------------------------------------------- */

export type JobDTO = {
  id: string;
  step: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
  aiCostUsd: number;
  startedAt: ISODate | null;
  finishedAt: ISODate | null;
  updatedAt: ISODate;
};

export type ApprovalDTO = {
  id: string;
  gate: Gate;
  decision: "approved" | "rejected";
  userId: string;
  note: string | null;
  createdAt: ISODate;
};

export type VideoDTO = {
  id: string;
  tiktokUrl: string;
  author: string | null;
  thumbnailUrl: string | null;
  origin: "imported" | "related_search" | "user_supplied";
  metadata: Record<string, unknown> | null;
  compliance: ComplianceReport | null;
  approval: "pending" | "approved" | "rejected";
  /** Stable Shopify CDN URL once approved and uploaded. */
  shopifyFileUrl: string | null;
  hasSparkCode: boolean;
  createdAt: ISODate;
};

export type ProductListItemDTO = {
  id: string;
  brandId: string;
  name: string | null;
  sourceType: "tiktok_video" | "product_link";
  sourceUrl: string;
  status: ProductStatus;
  /** Gate the product waits at (needs a human), or null. */
  gate: Gate | null;
  thumbnailUrl: string | null;
  sellingPrice: number | null;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type ProductDetailDTO = ProductListItemDTO & {
  analysis: ProductAnalysis | null;
  compareAtPrice: number | null;
  margin: MarginBreakdown | null;
  /** Step that failed when status is "failed". */
  failedStep: ProductStep | null;
  /** Latest error message when failed. */
  error: string | null;
  jobs: JobDTO[];
  approvals: ApprovalDTO[];
  videos: VideoDTO[];
};

export type ImportResultDTO = {
  product: ProductDetailDTO;
  /** false when the same source was already imported for this brand. */
  created: boolean;
};

export type ProductListDTO = {
  items: ProductListItemDTO[];
  total: number;
};

/* Pipeline (M2: GATE 2 and GATE 3 page) ------------------------------------- */

export type SupplierDTO = {
  id: string;
  source: string;
  url: string;
  title: string;
  /** Listing currency (may differ from the brand currency: then GATE 2 needs an fxRate). */
  currency: string;
  price: number;
  shipping: number | null;
  shippingCurrency: string;
  leadTime: { min: number; max: number } | null;
  images: string[];
  variants: { name: string; values: string[] }[];
  /** 0..1 similarity with the analysed product. */
  matchScore: number;
  /** 0..1 quality/price ratio (null on listings found before it was computed). */
  valueScore: number | null;
  /** Rating out of 5 and review count printed on the listing. */
  rating: number | null;
  reviewCount: number | null;
  selected: boolean;
  createdAt: ISODate;
};

/** GATE 2 price suggestion and margin for one listing (quoteSupplier from lib/sourcing). */
export type SupplierQuoteDTO = {
  supplierMatchId: string;
  currency: string;
  sellingPrice: number;
  compareAtPrice: number | null;
  priceSource: "pricing_rule" | "default_rule" | "min_margin" | "manual";
  /** Lowest price meeting the brand minimum margin (null without min_margin). */
  minimumPrice: number | null;
  margin: MarginBreakdown & {
    breakEvenCpa: number;
    maxCpa: number;
    breakEvenRoas: number | null;
    targetMarginRate: number | null;
    meetsTarget: boolean;
  };
  warnings: string[];
};

/**
 * "publishing": the page approval is recorded and its Shopify publish is in
 * flight (closed to edits and rejections, not yet approved).
 */
export type GatePartState = "pending" | "publishing" | "approved" | "rejected";

export type ShopifyPageDTO = {
  connectionId: string;
  shopDomain: string;
  shopifyProductId: string;
  handle: string;
  status: "draft" | "active" | "archived";
  /** Shopify admin product page. */
  adminUrl: string;
  /** Storefront URL once published (null while draft). */
  storefrontUrl: string | null;
  /**
   * Storefront preview of the draft (shopify_product.preview_url, stored at
   * every sync, so reads need no Shopify call). Null until known.
   */
  previewUrl: string | null;
};

export type ShopifyStoreOptionDTO = {
  id: string;
  shopDomain: string;
  status: ConnectionStatus;
  templateSuffix: string | null;
  /** Granted write_themes: Claude-designed templates can be written to its theme. */
  canWriteThemes: boolean;
};

export type ProductPipelineDTO = ProductDetailDTO & {
  /** Brand selling currency and minimum margin (0..1), for the GATE 2 screen. */
  currency: string;
  minMargin: number | null;
  suppliers: SupplierDTO[];
  /** GATE 2 decision in force. */
  supplierChoice: {
    approvalId: string;
    supplierMatchId: string;
    shopifyConnectionId: string;
    /** Product template the page is built on (null = product.json). */
    templateSuffix: string | null;
    fxRate: number | null;
    warnings: string[];
  } | null;
  /** The brand's Shopify stores (GATE 2 store picker). */
  shopifyStores: ShopifyStoreOptionDTO[];
  /** Template the page is built on (after GATE 2); generated sections once written. */
  pageTemplate: PageTemplateChoice | null;
  pageCopy: PageCopy | null;
  pageCopyGeneratedAt: ISODate | null;
  /**
   * Version of `pageCopy` (16 hex chars, content hash; null without copy).
   * Send it back as `approvePage({ copyVersion })`: the approval is refused
   * when the copy changed since it was loaded.
   */
  pageCopyVersion: string | null;
  shopify: ShopifyPageDTO | null;
  /** GATE 3 parts: the page (M2) and the videos (M3). */
  contentParts: Record<GatePart, GatePartState>;
  /**
   * The in-flight GATE 3 page publish, non-null only while
   * `contentParts.page === "publishing"`. `startedAt` is when the approval
   * claimed the page (ISO). `stale` is true once the claim is older than
   * STALE_PUBLISH_CLAIM_MS (5 min): approvePage then takes it over, so the UI
   * can offer "retry approval".
   */
  pagePublishClaim: { startedAt: ISODate; stale: boolean } | null;
};

export type ShopifyTemplatesDTO = {
  connectionId: string;
  /** Theme template suffixes; null = the default product template. */
  suffixes: (string | null)[];
  /** Whether the Trendcart template kit (product.trendcart) is installed. */
  hasTrendcartTemplate: boolean;
};

/* Usage -------------------------------------------------------------------- */

export type UsageDTO = {
  /** "YYYY-MM" (UTC). */
  month: string;
  aiCostUsd: number;
  apiCalls: number;
};
