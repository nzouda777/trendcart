/**
 * DTOs returned by lib/services: plain, serialisable (dates as ISO strings),
 * and free of secrets (no *_enc columns, no tokens, no proxy credentials).
 * Safe to import from client components.
 */
import type {
  CampaignIds,
  CampaignSpec,
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

/** Result of a proxy test (see testBrandProxy). Never carries the proxy URL. */
export type BrandProxyCheckDTO = {
  route: "proxy" | "direct";
  proxyKind: "http" | "socks5" | null;
  exitIp: string;
  latencyMs: number;
  /** True in mock mode: no request left the server. */
  simulated: boolean;
  checkedAt: ISODate;
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
  /**
   * Advertiser billing currency (ISO 4217) as TikTok reports it; budgets are
   * spent in it. Null = unknown (connected before it was stored): reconnect.
   */
  currency: string | null;
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
  /** Uploaded to the Shopify product (approved videos). */
  onShopify: boolean;
  /** TikTok Ads video id per advertiser id, once uploaded for a campaign. */
  tiktokVideoIds: Record<string, string>;
  /** Why the compliance check could not run (video gone, refused), else null. */
  checkError: string | null;
  /** Posts of this video to TikTok profiles (newest first). */
  posts: TikTokPostDTO[];
  /**
   * The compliance report was made against other ad texts / highlights than
   * the current page copy (a re-check is due; the build step or recheckVideo
   * runs it). False without a report or without page copy.
   */
  complianceOutdated: boolean;
};

export type TikTokPostDTO = {
  id: string;
  videoId: string;
  profileConnectionId: string;
  /** Profile display name (null if the connection was removed). */
  profileName: string | null;
  status: "pending" | "processing" | "published" | "failed";
  error: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
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
  /** Step that failed when status is "failed" (e.g. "launch"), else null. */
  failedStep: ProductStep | null;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type ProductDetailDTO = ProductListItemDTO & {
  analysis: ProductAnalysis | null;
  compareAtPrice: number | null;
  margin: MarginBreakdown | null;
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
  /**
   * GATE 3 videos part in force: the videos the campaign uses and the TikTok
   * Ads account it is prepared on (null until the videos part is approved).
   */
  videosChoice: { approvalId: string; videoIds: string[]; adConnectionId: string } | null;
  /** The brand's TikTok Ads accounts (GATE 3 videos part picker). */
  adAccounts: TikTokAdAccountOptionDTO[];
  /** The brand's TikTok profiles (publish an approved video). */
  tiktokProfiles: TikTokProfileOptionDTO[];
  /** The paused / launched campaign (after prepare_campaign), else null. */
  campaign: CampaignDTO | null;
  /**
   * The GATE 4 launch in flight (approval recorded, TikTok call running),
   * else null. `stale` after STALE_LAUNCH_CLAIM_MS (15 minutes, longer than
   * any function runs): launchCampaign can be approved again.
   */
  launchClaim: { startedAt: ISODate; stale: boolean } | null;
  /** Whether the posting app is audited (else posts are private: SELF_ONLY). */
  postingAudited: boolean;
  /**
   * Whether the caller's role may complete the GATE 3 videos part and choose
   * the TikTok Ads account (campaign:create: owner, media buyer). Creatives
   * still approve / reject single videos.
   */
  canChooseAdAccount: boolean;
};

/* Campaigns (M3: GATE 4, launch, stats) ------------------------------------ */

export type CampaignStatus = "draft" | "creating" | "paused" | "active" | "failed";

export type CampaignStatDTO = {
  /** Start of the hour, UTC. */
  hour: ISODate;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
};

export type CampaignTotalsDTO = Omit<CampaignStatDTO, "hour"> & {
  /** revenue / spend, null without spend. */
  roas: number | null;
  /** clicks / impressions, null without impressions. */
  ctr: number | null;
};

export type CampaignDTO = {
  id: string;
  adConnectionId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  /**
   * Advertiser (billing) currency, ISO 4217: `config.budget`, `maxBudget`,
   * `minBudget`, `stats` and `totals` are all in it. Null when unknown.
   */
  currency: string | null;
  /** Brand (selling) currency. */
  brandCurrency: string;
  /**
   * Human-supplied rate recorded at GATE 3: 1 brand unit = fxRate advertiser
   * units. Null when the two currencies are equal.
   */
  fxRate: number | null;
  /**
   * Spend and revenue converted back to the brand currency with the recorded
   * rate (approximate: the rate is not today's). Null when the currencies are
   * equal. ROAS is a ratio and needs no conversion.
   */
  totalsInBrandCurrency: { spend: number; revenue: number; approximate: true } | null;
  /**
   * "paused" before launch (and after a pause), "active" once launched.
   * "failed": a launch failed AND pausing it again failed, so part of it may
   * be spending (see `spendingUnknown`).
   */
  status: CampaignStatus;
  /**
   * True when Trendcart cannot tell whether the campaign is spending (a failed
   * launch whose re-pause failed). Show "check TikTok Ads Manager" and offer
   * pauseCampaign, which pauses it again.
   */
  spendingUnknown: boolean;
  /**
   * Whether updateCampaignBudget can be called now: the campaign exists on
   * TikTok (paused or active), the product is at GATE 4 or launched, and no
   * launch is in flight.
   */
  budgetUpdatable: boolean;
  /** Highest daily amount updateCampaignBudget accepts (advertiser currency). */
  maxBudget: number;
  /** TikTok's daily minimum for this budget level, when known (advertiser currency). */
  minBudget: number | null;
  /** The spec sent to TikTok (budget, targeting, ads). */
  config: CampaignSpec;
  tiktokIds: CampaignIds | null;
  launchedAt: ISODate | null;
  /** Hourly stats, oldest first (last 72 hours). */
  stats: CampaignStatDTO[];
  totals: CampaignTotalsDTO;
  /** Last synced hour (null before the first sync). */
  statsSyncedAt: ISODate | null;
};

export type TikTokAdAccountOptionDTO = {
  id: string;
  advertiserId: string;
  name: string;
  status: ConnectionStatus;
  /** Advertiser currency (null = unknown: reconnect before use). */
  currency: string | null;
  /** Can be chosen at GATE 3: working connection and known currency. */
  usable: boolean;
  /** Why it cannot be chosen (null when usable). */
  unusableReason: string | null;
  /**
   * It bills in another currency than the brand: approveVideos then needs an
   * `fxRate` (1 brand unit = fxRate advertiser units), supplied by the user.
   */
  needsFxRate: boolean;
};

export type TikTokProfileOptionDTO = {
  id: string;
  displayName: string;
  status: ConnectionStatus;
  postingMode: "direct" | "inbox";
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
