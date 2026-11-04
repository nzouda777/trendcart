/**
 * Video lifecycle after a human decision (CLAUDE.md "Video lifecycle"). We
 * store no file: only ids and stable URLs on the platforms that host them.
 *
 * - Approved: a fresh provider URL is resolved just in time and streamed once
 *   into the target Shopify product as product media (staged upload, done by
 *   the adapter). We keep `shopify_media_id` and the Shopify file URL, and use
 *   that stable URL for everything after (TikTok Ads, TikTok posting).
 * - TikTok Ads: uploaded by URL from the Shopify file URL, once per advertiser
 *   (`tiktok_video_ids[advertiserId]`).
 * - TikTok posting: streamed from the Shopify file URL by the posting adapter.
 * - Rejected or removed: its Shopify media is deleted.
 *
 * Only contract types here: callers pass the adapters and credentials.
 */
import {
  IntegrationError,
  type CallContext,
  type Integrations,
  type ShopifyCredentials,
  type ShopifyMediaRef,
  type TikTokAdsCredentials,
} from "@/lib/domain/contracts";
import type { TikTokVideoIds } from "@/lib/db/schema/business";

import { resolveFreshMedia } from "./candidates";

/** Alt text of a product video on Shopify (plain, short). */
export function shopifyVideoAlt(productName: string | null | undefined): string {
  const name = (productName ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return name ? `${name} video` : "Product video";
}

/**
 * Uploads an approved candidate to the Shopify product: resolves a fresh
 * media URL (never stored), then the adapter streams it into a staged upload
 * and waits until the media is READY. A FAILED media is deleted and reported
 * as a retryable provider error.
 */
export async function uploadApprovedVideo(input: {
  integrations: Pick<Integrations, "shopify" | "tiktokData">;
  call: CallContext;
  creds: ShopifyCredentials;
  shopifyProductId: string;
  tiktokUrl: string;
  alt: string;
}): Promise<{ mediaId: string; fileUrl: string }> {
  const { integrations, creds, shopifyProductId } = input;
  const fresh = await resolveFreshMedia(integrations.tiktokData, input.call, input.tiktokUrl);
  const ref: ShopifyMediaRef = await integrations.shopify.attachVideoFromUrl(creds, {
    productId: shopifyProductId,
    sourceUrl: fresh.mediaUrl,
    alt: input.alt,
  });
  if (ref.status !== "READY") {
    await integrations.shopify
      .deleteProductMedia(creds, { productId: shopifyProductId, mediaIds: [ref.mediaId] })
      .catch(() => undefined);
    throw new IntegrationError("shopify", "provider_error", "Shopify could not process the video.");
  }
  return { mediaId: ref.mediaId, fileUrl: ref.fileUrl };
}

/** Deletes a rejected or removed video's media from the Shopify product. */
export async function deleteVideoMedia(input: {
  integrations: Pick<Integrations, "shopify">;
  creds: ShopifyCredentials;
  shopifyProductId: string;
  mediaId: string;
}): Promise<void> {
  try {
    await input.integrations.shopify.deleteProductMedia(input.creds, {
      productId: input.shopifyProductId,
      mediaIds: [input.mediaId],
    });
  } catch (error) {
    // Already gone on the store: the goal is reached.
    if (error instanceof IntegrationError && error.code === "not_found") return;
    throw error;
  }
}

/** Deterministic file name of a video on TikTok Ads (same video, same name). */
export function tiktokAdsFileName(videoId: string): string {
  return `trendcart-${videoId}.mp4`;
}

/**
 * The TikTok Ads video id of an approved video for one advertiser: reused
 * when already uploaded, else uploaded by URL from the Shopify file URL.
 * Returns the id and the map to store (unchanged when reused).
 */
export async function ensureTikTokAdsVideo(input: {
  integrations: Pick<Integrations, "tiktokAds">;
  creds: TikTokAdsCredentials;
  video: { id: string; shopifyFileUrl: string | null; tiktokVideoIds: TikTokVideoIds };
}): Promise<{ videoId: string; tiktokVideoIds: TikTokVideoIds; uploaded: boolean }> {
  const { creds, video } = input;
  const existing = video.tiktokVideoIds[creds.advertiserId];
  if (existing) return { videoId: existing, tiktokVideoIds: video.tiktokVideoIds, uploaded: false };
  if (!video.shopifyFileUrl) {
    throw new IntegrationError(
      "workflow",
      "invalid_input",
      "An approved video has no Shopify file yet. Approve it again.",
      { retryable: false },
    );
  }
  const { videoId } = await input.integrations.tiktokAds.uploadVideoByUrl(creds, {
    videoUrl: video.shopifyFileUrl,
    fileName: tiktokAdsFileName(video.id),
  });
  return {
    videoId,
    tiktokVideoIds: { ...video.tiktokVideoIds, [creds.advertiserId]: videoId },
    uploaded: true,
  };
}
