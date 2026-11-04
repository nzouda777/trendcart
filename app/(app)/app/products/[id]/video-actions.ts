"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/components/app/action-result";
import { DISCLOSURE_UNSUPPORTED } from "@/components/app/product/action-markers";
import {
  addVideo,
  approveVideo,
  approveVideos,
  publishToProfile,
  recheckVideo,
  refreshTikTokPosts,
  rejectVideo,
  type ServiceFailure,
} from "@/lib/services";

import { runAction } from "../../_lib/action";

/*
 * GATE 3 videos part and TikTok posting (M3). Every action calls one service
 * (which checks the role, the state and the workspace again) and refreshes
 * the route on success or on a state change.
 */

type Messages = Partial<Record<ServiceFailure["code"], string>>;

function explain<T>(result: ActionResult<T>, messages: Messages): ActionResult<T> {
  if (result.ok) return result;
  if (result.code === "invalid_state" || result.code === "conflict") refresh();
  const message = messages[result.code];
  return message ? { ...result, error: message } : result;
}

const CONFLICT =
  "Someone else changed this product in the meantime. The screen was refreshed: check it and try again.";
const VIDEO_FORBIDDEN = "Your role cannot review videos. Ask a Creative or higher.";
const optionalText = (value: string | undefined) => value?.trim() || undefined;

/**
 * GATE 3: approves one video and uploads it to the Shopify product. State
 * refusals keep the service message: it says why (not checked yet, breaks
 * the ad rules, videos already approved, or "Shopify is still processing
 * this video. Approve it again in a minute.").
 */
export async function approveVideoAction(
  productId: string,
  videoId: string,
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await approveVideo(ctx, { productId, videoId });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    conflict: CONFLICT,
    forbidden: VIDEO_FORBIDDEN,
    rate_limited: "Too many videos are uploading right now. Try again in a moment.",
  });
}

/** GATE 3: rejects one video (its Shopify media, if any, is deleted). */
export async function rejectVideoAction(
  productId: string,
  videoId: string,
  input: { note?: string },
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await rejectVideo(ctx, { productId, videoId, note: optionalText(input.note) });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, { conflict: CONFLICT, forbidden: VIDEO_FORBIDDEN });
}

/** GATE 3: adds a TikTok video by URL; it is checked against the ad rules right away. */
export async function addVideoAction(
  productId: string,
  input: { url: string },
): Promise<ActionResult> {
  const url = input.url.trim();
  if (!url) {
    return {
      ok: false,
      code: "invalid_input",
      error: "Paste a TikTok video link.",
      fieldErrors: { url: ["Paste a TikTok video link."] },
    };
  }
  const result = await runAction(async (ctx) => {
    await addVideo(ctx, { productId, url });
    return undefined;
  });
  if (result.ok) {
    refresh();
    return result;
  }
  if (result.code === "invalid_input" && result.fieldErrors?.url) {
    return {
      ...result,
      error: "This is not a TikTok video link.",
      fieldErrors: { url: ["Use a link to one TikTok video (tiktok.com/@user/video/…)."] },
    };
  }
  return explain(result, {
    conflict: CONFLICT,
    forbidden: VIDEO_FORBIDDEN,
    rate_limited: "Too many paid checks for now. Nothing was added: try again later.",
  });
}

const approveVideosInput = z.object({
  adConnectionId: z.string().trim().min(1).optional(),
  /** 1 brand unit = fxRate advertiser units (only when the currencies differ). */
  fxRate: z.number().positive().finite().max(1_000_000).optional(),
  note: z.string().max(2000).optional(),
});

/**
 * GATE 3, videos part: the approved videos become the campaign's videos on
 * the chosen TikTok Ads account. With the page approved too, the campaign is
 * prepared (paused).
 */
export async function approveVideosAction(
  productId: string,
  input: { adConnectionId?: string; fxRate?: number; note?: string },
): Promise<ActionResult> {
  const parsed = approveVideosInput.safeParse(input);
  if (!parsed.success) {
    const fxError = parsed.error.issues.some((i) => i.path[0] === "fxRate");
    return fxError
      ? {
          ok: false,
          code: "invalid_input",
          error: "Enter the exchange rate as a number above zero.",
          fieldErrors: { fxRate: ["Enter a number above zero."] },
        }
      : { ok: false, code: "invalid_input", error: "Choose a TikTok Ads account." };
  }
  const result = await runAction(async (ctx) => {
    await approveVideos(ctx, {
      productId,
      adConnectionId: parsed.data.adConnectionId,
      ...(parsed.data.fxRate !== undefined ? { fxRate: parsed.data.fxRate } : {}),
      note: optionalText(parsed.data.note),
    });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    conflict: CONFLICT,
    forbidden: "Only a Media buyer or the Owner can choose the TikTok Ads account.",
  });
}

/**
 * GATE 3: runs the ad rules check of one video again (an incomplete review,
 * or a report made against older ad texts). Decides nothing.
 */
export async function recheckVideoAction(
  productId: string,
  videoId: string,
): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await recheckVideo(ctx, { productId, videoId });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    conflict: CONFLICT,
    forbidden: VIDEO_FORBIDDEN,
    rate_limited: "Too many paid checks for now. Try again later.",
  });
}

const PRIVACY_LEVELS = [
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "PUBLIC_TO_EVERYONE",
] as const;

const publishInput = z.object({
  videoId: z.string().trim().min(1),
  profileConnectionId: z.string().trim().min(1),
  caption: z.string().trim().min(1, "Write a caption.").max(2200),
  /** Chosen by the user: TikTok's Direct Post rules forbid a default. */
  privacyLevel: z.enum(PRIVACY_LEVELS, { error: "Choose who can see this post." }),
  /** Commercial content disclosure (TikTok Direct Post UX rules). */
  disclosure: z.object({
    enabled: z.boolean(),
    yourBrand: z.boolean(),
    brandedContent: z.boolean(),
  }),
});

export type PublishInput = z.input<typeof publishInput>;

/**
 * Publishes an approved video to a TikTok profile of the brand. The privacy
 * level must be chosen explicitly; the commercial content disclosure is
 * refused while the posting service has no field to carry it, so a
 * promotional post is never published unlabelled.
 */
export async function publishToProfileAction(input: PublishInput): Promise<ActionResult> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: "invalid_input",
      error: Object.values(fieldErrors)[0]?.[0] ?? "Please check the highlighted fields.",
      fieldErrors,
    };
  }
  const v = parsed.data;
  if (v.disclosure.enabled) {
    if (!v.disclosure.yourBrand && !v.disclosure.brandedContent) {
      return {
        ok: false,
        code: "invalid_input",
        error: "Indicate whether this post promotes your brand, a third party, or both.",
        fieldErrors: { disclosure: ["required"] },
      };
    }
    if (v.disclosure.brandedContent && v.privacyLevel === "SELF_ONLY") {
      return {
        ok: false,
        code: "invalid_input",
        error: "Branded content cannot be posted with the visibility set to only you.",
        fieldErrors: { privacyLevel: ["branded_content_private"] },
      };
    }
    return { ok: false, code: "precondition_failed", error: DISCLOSURE_UNSUPPORTED };
  }
  const result = await runAction(async (ctx) => {
    await publishToProfile(ctx, {
      videoId: v.videoId,
      profileConnectionId: v.profileConnectionId,
      caption: v.caption,
      privacyLevel: v.privacyLevel,
    });
    return undefined;
  });
  // A failed publish is stored on the post: refresh so its status shows.
  refresh();
  return explain(result, {
    forbidden: "Your role cannot post to TikTok. Ask a Creative or higher.",
  });
}

/** Polls TikTok for the product's posts still processing. */
export async function refreshTikTokPostsAction(productId: string): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await refreshTikTokPosts(ctx, { productId });
    return undefined;
  });
  if (result.ok) refresh();
  return explain(result, {
    forbidden: "Your role cannot check TikTok posts.",
  });
}
