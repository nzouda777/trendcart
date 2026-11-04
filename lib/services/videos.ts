import "server-only";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { meteredCall } from "@/lib/ai/metering";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import {
  IntegrationError,
  pageCopySchema,
  tiktokPrivacyLevelSchema,
  tiktokVideoUrlSchema,
  type TikTokPrivacyLevel,
  type TikTokPublishStatus,
} from "@/lib/domain/contracts";
import {
  brand,
  product,
  shopifyProduct,
  tiktokAdConnection,
  tiktokPost,
  tiktokProfileConnection,
  video,
} from "@/lib/db/schema";
import { isShopifyMediaProcessing } from "@/lib/integrations/shopify/errors";
import { currencyDecimals } from "@/lib/integrations/tiktok-ads";
import { isPostingAudited, PUBLISH_CLAIM_STALE_MS } from "@/lib/integrations/tiktok-posting/config";
import { assertNoMediaUrl, candidateVideoFields } from "@/lib/media/candidates";
import { deleteVideoMedia, shopifyVideoAlt, uploadApprovedVideo } from "@/lib/media/videos";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";
import { buildCallContext } from "@/lib/workflows/call-context";
import { advertiserBudget } from "@/lib/workflows/campaign-spec";

import { getConcurrencyLimiter, tryLock, withWorkspaceSlot } from "@/lib/workflows/concurrency";
import {
  evidenceOf,
  gatePartStates,
  loadSupplierChoice,
  lockProduct,
  recordGateDecision,
} from "@/lib/workflows/gate-payloads";
import { isUnsafeText } from "@/lib/workflows/page-input";
import { applyProductEventTo } from "@/lib/workflows/product-status";
import { ConcurrencyLimitError } from "@/lib/workflows/retry";
import { checkVideos } from "@/lib/workflows/steps/videos";

import { idSchema } from "./brands";
import { adAccountUnusableReason, dailyBudgetMinimum } from "./campaign-read";
import { resolveIntegrations, resolveNow, resolvePipeline, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import {
  getShopifyCredentialsFor,
  getTikTokProfileTokens,
  markConnectionNeedsReauth,
  USABLE_CONNECTION_STATUSES,
} from "./internal/credentials";
import { loadPipeline } from "./pipeline";
import { enforceRebuildLimit } from "./rate-limit";
import type { ProductPipelineDTO } from "./types";

/*
 * GATE 3 videos part and TikTok posting (M3). Video lifecycle rules
 * (CLAUDE.md): an approved video is uploaded once to the target Shopify
 * product (stable file URL kept), a rejected one has its Shopify media
 * deleted, provider media URLs are resolved just in time and never stored.
 * Every function checks the role first and is audited.
 */

type ProductRow = Row<typeof product>;
type VideoRow = Row<typeof video>;

/** Videos a product may hold (candidates + user-supplied). */
export const MAX_VIDEOS_PER_PRODUCT = 20;
/**
 * A post left "pending" longer than this (the process died) may be published
 * again. Equals the posting adapter's claim window (longer than its live
 * publish lock), so a second click never races a publish still running.
 */
export const STALE_POST_CLAIM_MS = PUBLISH_CLAIM_STALE_MS;
const MAX_CAPTION = 2200;

const videoActionSchema = z.object({ productId: idSchema, videoId: idSchema });
const rejectVideoSchema = videoActionSchema.extend({
  note: z.string().trim().max(2000).optional(),
});

/** GATE 3 is open for video decisions: product at GATE 3, videos part not approved. */
async function assertVideosOpen(db: ScopedDb, row: ProductRow) {
  if (row.status !== "awaiting_content_approval") {
    throw new ServiceError("invalid_state", "This product is not waiting for a content approval.");
  }
  const parts = await gatePartStates(db, row.id, "content_approval");
  if (parts.videos === "approved") {
    throw new ServiceError("invalid_state", "The videos were already approved for the campaign.");
  }
  return parts;
}

async function loadVideoOf(db: ScopedDb, productId: string, videoId: string): Promise<VideoRow> {
  const row = await db.findFirst(video, and(eq(video.id, videoId), eq(video.productId, productId)));
  if (!row) throw new ServiceError("invalid_input", "This video is not a video of this product.");
  return row;
}

/** The Shopify draft of the product on the GATE 2 store. */
async function loadShopifyPage(db: ScopedDb, productId: string) {
  const choice = await loadSupplierChoice(db, productId);
  if (!choice) throw new ServiceError("invalid_state", "This product has no store yet (GATE 2).");
  const page = await db.findFirst(
    shopifyProduct,
    and(
      eq(shopifyProduct.productId, productId),
      eq(shopifyProduct.connectionId, choice.shopifyConnectionId),
    ),
  );
  if (!page) throw new ServiceError("invalid_state", "This product has no Shopify page yet.");
  return { connectionId: choice.shopifyConnectionId, page };
}

function busy(error: unknown): never {
  if (error instanceof ConcurrencyLimitError) {
    throw new ServiceError("rate_limited", "Too many videos are uploading. Try again in a moment.");
  }
  throw error;
}

/* GATE 3: one video ---------------------------------------------------------- */

/**
 * Approves one video for the product (GATE 3, videos part still open). Its
 * compliance report must exist and not be "fail". A per-video upload lock
 * (Upstash, expires after LEASE_TTL_MS) makes a concurrent approve refuse
 * with reason "upload_in_progress" instead of transferring twice. The video
 * is marked approved under the product lock, then uploaded once to the
 * Shopify product (fresh provider URL, staged upload, workspace "upload"
 * slot), and the media id and stable file URL are stored with a
 * `video.approve` audit entry. If the upload fails the video goes back to its
 * previous decision and the error is rethrown; while Shopify is still
 * processing it stays approved (reason "media_processing": approve again in a
 * minute). Approving an approved video whose upload was lost uploads it again.
 */
export async function approveVideo(
  ctx: WorkspaceContext,
  input: z.input<typeof videoActionSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval", "video:approve");
  const v = videoActionSchema.parse(input);
  const limiter = deps.limiter ?? getConcurrencyLimiter();
  const lock = await tryLock(limiter, `video-upload:${v.videoId}`);
  if (!lock) {
    throw new ServiceError(
      "invalid_state",
      "This video is already uploading to Shopify. It will show up in a moment.",
      { reason: "upload_in_progress" },
    );
  }
  try {
    return await approveVideoLocked(ctx, v, deps);
  } finally {
    await lock.release().catch(() => undefined);
  }
}

async function approveVideoLocked(
  ctx: WorkspaceContext,
  v: z.infer<typeof videoActionSchema>,
  deps: ServiceDeps,
): Promise<ProductPipelineDTO> {
  const integrations = resolveIntegrations(deps);

  const claim = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    await assertVideosOpen(tx, row);
    const target = await loadVideoOf(tx, row.id, v.videoId);
    if (target.approval === "approved" && target.shopifyMediaId) return null;
    if (!target.compliance) {
      throw new ServiceError(
        "invalid_state",
        "This video has not been checked against the ad rules yet.",
      );
    }
    if (target.compliance.overall === "fail") {
      throw new ServiceError(
        "invalid_state",
        "This video breaks TikTok ad rules (see its compliance report). It cannot be used.",
      );
    }
    const { connectionId, page } = await loadShopifyPage(tx, row.id);
    await tx.update(video, { approval: "approved" }, eq(video.id, target.id));
    return { row, target, connectionId, page, previous: target.approval };
  });
  if (!claim) return loadPipeline(ctx, v.productId);

  let media: { mediaId: string; fileUrl: string };
  try {
    media = await withWorkspaceSlot(
      deps.limiter ?? getConcurrencyLimiter(),
      ctx.workspaceId,
      "upload",
      async () => {
        const { creds } = await getShopifyCredentialsFor(ctx, integrations, claim.connectionId);
        const call = await buildCallContext(ctx.db, claim.row.brandId);
        return uploadApprovedVideo({
          integrations,
          call,
          creds,
          shopifyProductId: claim.page.shopifyProductId,
          videoId: claim.target.id,
          tiktokUrl: claim.target.tiktokUrl,
          alt: shopifyVideoAlt(claim.row.name),
        });
      },
    );
  } catch (error) {
    if (isShopifyMediaProcessing(error)) {
      // Still processing on Shopify: the video stays approved (claimed) and
      // approving it again resumes the same upload (same idempotency key).
      throw new ServiceError(
        "invalid_state",
        "Shopify is still processing this video. Approve it again in a minute.",
        { reason: "media_processing" },
      );
    }
    // Back to the previous decision, unless someone decided meanwhile.
    await ctx.db.update(
      video,
      { approval: claim.previous === "approved" ? "pending" : claim.previous },
      (t) => and(eq(t.id, claim.target.id), eq(t.approval, "approved"), isNull(t.shopifyMediaId)),
    );
    busy(error);
  }

  const stillApproved = await ctx.db.transaction(async (tx) => {
    await lockProduct(tx, claim.row.id);
    const current = await tx.getById(video, claim.target.id);
    if (current.approval !== "approved") return false;
    await tx.update(
      video,
      { shopifyMediaId: media.mediaId, shopifyFileUrl: media.fileUrl },
      eq(video.id, current.id),
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "video.approve",
        targetType: "video",
        targetId: current.id,
        metadata: {
          productId: claim.row.id,
          shopifyProductId: claim.page.shopifyProductId,
          shopifyMediaId: media.mediaId,
          compliance: current.compliance?.overall ?? null,
        },
      },
    );
    return true;
  });

  if (!stillApproved) {
    // Rejected while uploading: the media must not stay on the store.
    const { creds } = await getShopifyCredentialsFor(ctx, integrations, claim.connectionId);
    await deleteVideoMedia({
      integrations,
      creds,
      shopifyProductId: claim.page.shopifyProductId,
      mediaId: media.mediaId,
    });
  }
  return loadPipeline(ctx, claim.row.id);
}

/**
 * Rejects one video (GATE 3, videos part still open), audited `video.reject`.
 * An approved video already on Shopify has its product media deleted
 * (`video.media_delete`). If that deletion fails the video stays rejected
 * with its media id, the error is rethrown, and rejecting again retries it.
 */
export async function rejectVideo(
  ctx: WorkspaceContext,
  input: z.input<typeof rejectVideoSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval", "video:approve");
  const v = rejectVideoSchema.parse(input);
  const integrations = resolveIntegrations(deps);

  const decided = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    await assertVideosOpen(tx, row);
    const target = await loadVideoOf(tx, row.id, v.videoId);
    if (target.approval !== "rejected") {
      await tx.update(video, { approval: "rejected" }, eq(video.id, target.id));
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "video.reject",
          targetType: "video",
          targetId: target.id,
          metadata: { productId: row.id, previous: target.approval, hasNote: !!v.note },
        },
      );
    }
    if (!target.shopifyMediaId) return null;
    const { connectionId, page } = await loadShopifyPage(tx, row.id);
    return { row, mediaId: target.shopifyMediaId, connectionId, page };
  });

  if (decided) {
    const { creds } = await getShopifyCredentialsFor(ctx, integrations, decided.connectionId);
    await deleteVideoMedia({
      integrations,
      creds,
      shopifyProductId: decided.page.shopifyProductId,
      mediaId: decided.mediaId,
    });
    await ctx.db.transaction(async (tx) => {
      const cleared = await tx.update(video, { shopifyMediaId: null, shopifyFileUrl: null }, (t) =>
        and(eq(t.id, v.videoId), eq(t.shopifyMediaId, decided.mediaId)),
      );
      if (cleared.length === 0) return;
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "video.media_delete",
          targetType: "video",
          targetId: v.videoId,
          metadata: {
            productId: decided.row.id,
            shopifyProductId: decided.page.shopifyProductId,
            shopifyMediaId: decided.mediaId,
          },
        },
      );
    });
  }
  return loadPipeline(ctx, v.productId);
}

/* GATE 3: the videos part ---------------------------------------------------- */

const approveVideosSchema = z.object({
  productId: idSchema,
  /** TikTok Ads account for the campaign; optional when the brand has exactly one active. */
  adConnectionId: idSchema.optional(),
  /**
   * Required when the ad account bills in another currency than the brand:
   * 1 brand unit = fxRate advertiser units, supplied by the user (Trendcart
   * fetches no FX rates). Ignored when the currencies match.
   */
  fxRate: z.number().positive().finite().max(1_000_000).optional(),
  note: z.string().trim().max(2000).optional(),
});

const USABLE_CONNECTION = USABLE_CONNECTION_STATUSES;

/**
 * GATE 3, videos part: the approved videos (each already on Shopify) are the
 * campaign's videos, and the TikTok Ads account is chosen. Owner and media
 * buyer only (`campaign:create`): this picks the advertiser account the
 * paused campaign is created on; creatives approve / reject single videos.
 *
 * Refused when an approved video's (re-)check now fails, when the ad
 * account's currency is unknown (reconnect it), when it bills in another
 * currency than the brand and no `fxRate` is given (invalid_input), and when
 * the brand default test budget converted to the advertiser currency
 * (amount x fxRate, 2 decimals) is under TikTok's daily minimum.
 * Recorded in `approval` (payload { part: "videos", videoIds, adConnectionId,
 * brandCurrency, advertiserCurrency, fxRate }) and audited `gate.approve`,
 * under the product lock. When the
 * page part is approved too, the product moves to preparing_campaign in the
 * same transaction and the pipeline prepares the paused campaign.
 */
export async function approveVideos(
  ctx: WorkspaceContext,
  input: z.input<typeof approveVideosSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval", "video:approve", "campaign:create");
  const v = approveVideosSchema.parse(input);
  const userId = ctx.actor.userId;

  const result = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    const parts = await assertVideosOpen(tx, row);
    const approved = await tx.select(video, {
      where: and(eq(video.productId, row.id), eq(video.approval, "approved")),
      orderBy: (t) => t.createdAt,
    });
    if (approved.some((a) => !a.shopifyMediaId || !a.shopifyFileUrl)) {
      throw new ServiceError(
        "invalid_state",
        "A video is still uploading to Shopify. Try again in a moment.",
      );
    }
    if (approved.length === 0) {
      throw new ServiceError("precondition_failed", "Approve at least one video first.");
    }
    // N13: approved videos are re-checked (report only) when the page copy
    // changes; one that now fails cannot run.
    if (approved.some((a) => a.compliance?.overall === "fail")) {
      throw new ServiceError(
        "precondition_failed",
        "An approved video now fails the ad rules (checked again against the new page copy). Reject it first.",
      );
    }

    const brandRow = await tx.getById(brand, row.brandId);
    const accounts = await tx.select(tiktokAdConnection, {
      where: eq(tiktokAdConnection.brandId, row.brandId),
      orderBy: (t) => t.createdAt,
    });
    let account;
    if (v.adConnectionId) {
      account = accounts.find((a) => a.id === v.adConnectionId);
      if (!account) {
        throw new ServiceError(
          "invalid_input",
          "This TikTok Ads account is not connected to the brand.",
        );
      }
    } else {
      const usable = accounts.filter((a) => USABLE_CONNECTION.has(a.status));
      if (usable.length === 0) {
        throw new ServiceError(
          "precondition_failed",
          "Connect a TikTok Ads account to this brand before approving the videos.",
        );
      }
      if (usable.length > 1) {
        throw new ServiceError(
          "invalid_input",
          "This brand has several TikTok Ads accounts: choose one.",
        );
      }
      account = usable[0]!;
    }
    const unusable = adAccountUnusableReason(account);
    if (unusable) throw new ServiceError("precondition_failed", unusable);
    const advertiserCurrency = account.currency!;
    const brandCurrency = brandRow.currency;
    let fxRate: number | null = null;
    if (advertiserCurrency !== brandCurrency) {
      if (v.fxRate === undefined) {
        throw new ServiceError(
          "invalid_input",
          `This TikTok Ads account bills in ${advertiserCurrency} but the brand sells in ${brandCurrency}. Enter the exchange rate (1 ${brandCurrency} = ? ${advertiserCurrency}).`,
        );
      }
      fxRate = v.fxRate;
    }
    if (brandRow.defaultTestBudget !== null && brandRow.defaultTestBudget > 0) {
      const amount = advertiserBudget(
        brandRow.defaultTestBudget,
        fxRate ?? 1,
        currencyDecimals(advertiserCurrency),
      );
      const min = dailyBudgetMinimum("ad_group", advertiserCurrency);
      if (min !== undefined && amount < min) {
        const brandPart = fxRate
          ? `${brandRow.defaultTestBudget} ${brandCurrency} = ${amount} ${advertiserCurrency}`
          : `${amount} ${advertiserCurrency}`;
        throw new ServiceError(
          "precondition_failed",
          `The daily test budget (${brandPart}) is under TikTok's minimum of ${min} ${advertiserCurrency}. Raise the brand default test budget.`,
        );
      }
    }

    const videoIds = approved.map((a) => a.id).slice(0, MAX_VIDEOS_PER_PRODUCT);
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "content_approval",
      userId,
      decision: "approved",
      note: v.note ?? null,
      payload: {
        part: "videos",
        kind: "approve",
        videoIds,
        adConnectionId: account.id,
        brandCurrency,
        advertiserCurrency,
        fxRate,
      },
    });
    const complete = parts.page === "approved";
    if (complete) {
      await applyProductEventTo(tx, row, {
        type: "gate_approved",
        productId: row.id,
        approval: evidenceOf(recorded, ["page", "videos"]),
      });
    }
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.approve",
        targetType: "product",
        targetId: row.id,
        metadata: {
          gate: "content_approval",
          part: "videos",
          approvalId: recorded.id,
          videoIds,
          adConnectionId: account.id,
          brandCurrency,
          advertiserCurrency,
          fxRate,
          complete,
        },
      },
    );
    return { approvalId: recorded.id, complete };
  });

  if (result.complete) {
    await resolvePipeline(deps).continueAfterGate(
      ctx,
      v.productId,
      "content_approval",
      result.approvalId,
    );
  }
  return loadPipeline(ctx, v.productId);
}

const addVideoSchema = z.object({
  productId: idSchema,
  url: tiktokVideoUrlSchema,
});

/**
 * Adds a TikTok video supplied by a user (GATE 3, videos part open): resolved
 * through the data provider (metadata only is stored, origin "user_supplied")
 * and checked against the ad rules right away (metered): only this video, so
 * the server action stays short (other due checks belong to the build step).
 * Rate-limited like a rebuild (paid calls). Idempotent on the URL.
 */
export async function addVideo(
  ctx: WorkspaceContext,
  input: z.input<typeof addVideoSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval", "video:approve");
  const v = addVideoSchema.parse(input);
  const integrations = resolveIntegrations(deps);

  const row = await ctx.db.getById(product, v.productId);
  await assertVideosOpen(ctx.db, row);
  if ((await ctx.db.count(video, eq(video.productId, row.id))) >= MAX_VIDEOS_PER_PRODUCT) {
    throw new ServiceError(
      "precondition_failed",
      "This product already has the maximum number of videos.",
    );
  }
  await enforceRebuildLimit(ctx.workspaceId, row.id, deps);

  const call = await buildCallContext(ctx.db, row.brandId);
  let resolved;
  try {
    resolved = await integrations.tiktokData.resolveVideo(call, v.url);
  } catch (error) {
    if (error instanceof IntegrationError && !error.retryable) {
      throw new ServiceError(
        "invalid_input",
        "This TikTok video could not be found or is private.",
      );
    }
    throw error;
  }
  const fields = candidateVideoFields(resolved);
  assertNoMediaUrl(fields.metadata);
  const saved = await ctx.db.upsert(
    video,
    { productId: row.id, tiktokUrl: resolved.tiktokUrl, origin: "user_supplied", ...fields },
    { target: (t) => [t.productId, t.tiktokUrl], set: { thumbnailUrl: fields.thumbnailUrl } },
  );

  await runChecks(ctx, row, call, deps, { only: [saved.id] });
  return loadPipeline(ctx, row.id);
}

/** Compliance checks from a service (metered on the workspace AI cap). */
async function runChecks(
  ctx: WorkspaceContext,
  row: ProductRow,
  call: Awaited<ReturnType<typeof buildCallContext>>,
  deps: ServiceDeps,
  options: Parameters<typeof checkVideos>[5],
) {
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);
  const brandRow = await ctx.db.getById(brand, row.brandId);
  const copy = row.pageCopy ? pageCopySchema.parse(row.pageCopy) : null;
  return checkVideos(
    {
      ctx,
      integrations,
      metered: (fn) =>
        meteredCall(ctx.db, { workspaceId: ctx.workspaceId }, fn, { capUsd: deps.aiCapUsd, now }),
    },
    row,
    brandRow,
    copy,
    call,
    options,
  );
}

/**
 * Runs the compliance check of one video again (GATE 3, videos part open),
 * e.g. after an incomplete AI review (`policy.ai_review` fail) or to refresh
 * a report made against older ad texts. Pending and approved videos (an
 * approved one keeps its decision: report only, and approveVideos refuses it
 * if the new report fails); rejected ones are not checked. Creative and up,
 * metered, rate-limited like a rebuild. Not audited: it decides nothing (the
 * audit action list has no entry for it).
 */
export async function recheckVideo(
  ctx: WorkspaceContext,
  input: z.input<typeof videoActionSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "gate:content_approval", "video:approve");
  const v = videoActionSchema.parse(input);
  const row = await ctx.db.getById(product, v.productId);
  await assertVideosOpen(ctx.db, row);
  const target = await loadVideoOf(ctx.db, row.id, v.videoId);
  if (target.approval === "rejected") {
    throw new ServiceError("invalid_state", "This video was rejected: it is not checked again.");
  }
  await enforceRebuildLimit(ctx.workspaceId, row.id, deps);

  const call = await buildCallContext(ctx.db, row.brandId);
  await runChecks(ctx, row, call, deps, { only: [target.id], force: true });
  return loadPipeline(ctx, row.id);
}

/* TikTok posting ------------------------------------------------------------- */

const publishSchema = z.object({
  videoId: idSchema,
  profileConnectionId: idSchema,
  /** Defaults to the first page copy ad text. */
  caption: z.string().trim().min(1).max(MAX_CAPTION).optional(),
  /** Only honoured once the app passed TikTok's audit; SELF_ONLY otherwise. */
  privacyLevel: tiktokPrivacyLevelSchema.optional(),
});

function captionFor(row: ProductRow, input?: string): string {
  if (input) return input;
  const copy = row.pageCopy ? pageCopySchema.safeParse(row.pageCopy) : null;
  return (copy?.success ? copy.data.adTexts[0] : null) ?? row.name ?? "New find";
}

/**
 * Publishes an approved video (on Shopify) to a TikTok profile of the same
 * brand, streamed by the posting adapter from the Shopify file URL. Private
 * (SELF_ONLY) while the app is unaudited. One post per (video, profile): a
 * post that is pending, processing or published is returned as is; a failed
 * or stale one is published again. Stored in tiktok_post and audited
 * `video.publish` (success and failure).
 */
export async function publishToProfile(
  ctx: WorkspaceContext,
  input: z.input<typeof publishSchema>,
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "video:publish");
  const v = publishSchema.parse(input);
  const integrations = resolveIntegrations(deps);
  const now = resolveNow(deps);

  const target = await ctx.db.getById(video, v.videoId);
  const row = await ctx.db.getById(product, target.productId);
  if (target.approval !== "approved" || !target.shopifyFileUrl) {
    throw new ServiceError(
      "invalid_state",
      "Only approved videos (uploaded to Shopify) can be posted.",
    );
  }
  const profile = await ctx.db.findById(tiktokProfileConnection, v.profileConnectionId);
  if (!profile || profile.brandId !== row.brandId) {
    throw new ServiceError("invalid_input", "This TikTok profile is not connected to the brand.");
  }
  if (!USABLE_CONNECTION.has(profile.status)) {
    throw new ServiceError("precondition_failed", "This TikTok profile needs to be reconnected.");
  }
  const caption = captionFor(row, v.caption).slice(0, MAX_CAPTION);
  if (isUnsafeText(caption)) {
    throw new ServiceError(
      "invalid_input",
      "The caption makes claims that are not allowed. Change it.",
    );
  }
  const audited = isPostingAudited();
  if (v.privacyLevel && v.privacyLevel !== "SELF_ONLY" && !audited) {
    throw new ServiceError(
      "invalid_input",
      "Posts stay private (only me) until TikTok has audited the app.",
    );
  }
  const privacyLevel: TikTokPrivacyLevel = audited ? (v.privacyLevel ?? "SELF_ONLY") : "SELF_ONLY";

  // Claim the (video, profile) post.
  const post = await ctx.db.transaction(async (tx) => {
    await lockProduct(tx, row.id);
    const existing = await tx.findFirst(
      tiktokPost,
      and(eq(tiktokPost.videoId, target.id), eq(tiktokPost.profileConnectionId, profile.id)),
    );
    const stalePending =
      existing?.status === "pending" &&
      now().getTime() - existing.updatedAt.getTime() > STALE_POST_CLAIM_MS;
    if (existing && existing.status !== "failed" && !stalePending) return null;
    if (existing) {
      const [reset] = await tx.update(
        tiktokPost,
        { status: "pending", error: null, publishId: null },
        eq(tiktokPost.id, existing.id),
      );
      return reset!;
    }
    return tx.insert(tiktokPost, {
      videoId: target.id,
      profileConnectionId: profile.id,
      status: "pending",
    });
  });
  if (!post) return loadPipeline(ctx, row.id);

  try {
    const tokens = await getTikTokProfileTokens(ctx, profile.id);
    // The brand proxy (if any) for the source reads from the Shopify URL.
    const { proxyUrl } = await buildCallContext(ctx.db, row.brandId);
    const { publishId } = await integrations.tiktokPosting.publishVideoFromUrl({
      accessToken: tokens.accessToken,
      sourceUrl: target.shopifyFileUrl,
      caption,
      privacyLevel,
      ...(proxyUrl ? { proxyUrl } : {}),
    });

    await ctx.db.transaction(async (tx) => {
      await tx.update(tiktokPost, { publishId, status: "processing" }, eq(tiktokPost.id, post.id));
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "video.publish",
          targetType: "tiktok_post",
          targetId: post.id,
          metadata: {
            productId: row.id,
            videoId: target.id,
            profileConnectionId: profile.id,
            privacyLevel,
            outcome: "submitted",
          },
        },
      );
    });
  } catch (error) {
    const code =
      error instanceof IntegrationError || error instanceof ServiceError ? error.code : "unknown";
    const message =
      error instanceof IntegrationError || error instanceof ServiceError
        ? error.message.slice(0, 500)
        : "Publishing failed.";
    if (error instanceof IntegrationError && error.code === "auth_expired") {
      await markConnectionNeedsReauth(ctx, "tiktok_profile", profile.id, error.message);
    }
    await ctx.db.transaction(async (tx) => {
      await tx.update(tiktokPost, { status: "failed", error: message }, eq(tiktokPost.id, post.id));
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "video.publish",
          targetType: "tiktok_post",
          targetId: post.id,
          metadata: {
            productId: row.id,
            videoId: target.id,
            profileConnectionId: profile.id,
            outcome: "failed",
            error: code,
          },
        },
      );
    });
    throw error;
  }
  return loadPipeline(ctx, row.id);
}

/** tiktok_post status for a TikTok publish status. */
export function postStatusOf(
  status: TikTokPublishStatus["status"],
): "processing" | "published" | "failed" {
  if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") return "published";
  if (status === "FAILED") return "failed";
  return "processing";
}

/**
 * Polls TikTok for the product's posts still processing (at most 10) and
 * stores their status (call it while the UI shows "processing"). Transient
 * provider errors leave the post as is.
 */
export async function refreshTikTokPosts(
  ctx: WorkspaceContext,
  input: { productId: string },
  deps: ServiceDeps = {},
): Promise<ProductPipelineDTO> {
  requirePermission(ctx, "video:publish");
  const productId = idSchema.parse(input.productId);
  const integrations = resolveIntegrations(deps);
  await ctx.db.getById(product, productId);

  const videos = await ctx.db.select(video, { where: eq(video.productId, productId) });
  if (videos.length > 0) {
    const posts = await ctx.db.select(tiktokPost, {
      where: and(
        inArray(
          tiktokPost.videoId,
          videos.map((x) => x.id),
        ),
        eq(tiktokPost.status, "processing"),
        isNotNull(tiktokPost.publishId),
      ),
      limit: 10,
    });
    for (const post of posts) {
      try {
        const tokens = await getTikTokProfileTokens(ctx, post.profileConnectionId);
        const status = await integrations.tiktokPosting.getPublishStatus({
          accessToken: tokens.accessToken,
          publishId: post.publishId!,
        });
        const next = postStatusOf(status.status);
        if (next === "processing") continue;
        await ctx.db.update(
          tiktokPost,
          {
            status: next,
            error:
              next === "failed"
                ? (status.failReason ?? "TikTok refused the post.").slice(0, 500)
                : null,
          },
          eq(tiktokPost.id, post.id),
        );
      } catch (error) {
        if (error instanceof IntegrationError && error.code === "auth_expired") {
          await markConnectionNeedsReauth(
            ctx,
            "tiktok_profile",
            post.profileConnectionId,
            error.message,
          );
          continue;
        }
        if (error instanceof IntegrationError || error instanceof ServiceError) continue;
        throw error;
      }
    }
  }
  return loadPipeline(ctx, productId);
}
