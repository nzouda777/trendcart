/**
 * Step "analyze": imported product → AI analysis (analyzing →
 * awaiting_product_confirmation).
 *
 * - TikTok source: resolve the video through the data provider, store its
 *   candidate metadata on the `video` row (origin "imported"), and stream the
 *   fresh media URL to the analyzer. The media URL is never stored.
 *   If the analyzer reports a retryable "tiktok-media" error (signed CDN URL
 *   expired or refused), the video is resolved again and the analysis retried
 *   once right away; further failures go to the runner's backoff, and every
 *   runner attempt resolves a fresh URL too.
 * - Product link: the analyzer reads the page itself.
 * - The AI call goes through `metered` (monthly cap + usage_monthly + job cost).
 * - After GATE 1 rejections, the analyzer gets a `hint` (notes and the
 *   product names it got wrong, most recent first).
 *
 * Idempotent: the video row is an upsert on (product, tiktok_url); a product
 * that already has an analysis is not analysed again.
 */
import { and, eq } from "drizzle-orm";

import {
  analyzeHintSchema,
  IntegrationError,
  productAnalysisSchema,
  type AnalyzeHint,
  type AnalyzeInput,
  type CallContext,
} from "@/lib/domain/contracts";
import { approval, brand, video } from "@/lib/db/schema";
import type { ScopedDb } from "@/lib/tenant/scoped-db";
import { candidateVideoFields, resolveFreshMedia } from "@/lib/media/candidates";

import { buildCallContext } from "../call-context";
import { decisionOrder } from "../gate-payloads";

import type { StepDefinition, StepEnv } from "./types";

/** Provider name the analyzer uses for errors fetching the TikTok media URL. */
export const TIKTOK_MEDIA_PROVIDER = "tiktok-media";

function isExpiredMedia(error: unknown): boolean {
  return (
    error instanceof IntegrationError && error.provider === TIKTOK_MEDIA_PROVIDER && error.retryable
  );
}

async function resolveTikTokInput(
  { ctx, integrations }: StepEnv,
  call: CallContext,
  productId: string,
  tiktokUrl: string,
): Promise<AnalyzeInput> {
  const resolved = await resolveFreshMedia(integrations.tiktokData, call, tiktokUrl);
  await ctx.db.upsert(
    video,
    { productId, tiktokUrl, origin: "imported", ...candidateVideoFields(resolved) },
    { target: (t) => [t.productId, t.tiktokUrl], set: candidateVideoFields(resolved) },
  );
  return {
    source: "tiktok_video",
    mediaUrl: resolved.mediaUrl,
    caption: resolved.caption,
    thumbnailUrl: resolved.thumbnailUrl,
  };
}

const MAX_HINT_NOTE = 2000;
const MAX_HINT_NAMES = 20;

function previousNameOf(payload: Record<string, unknown> | null): string | null {
  const name = payload?.previousName;
  if (typeof name === "string" && name.trim()) return name.trim();
  const analysis = payload?.previousAnalysis as { productName?: unknown } | null | undefined;
  return typeof analysis?.productName === "string" && analysis.productName.trim()
    ? analysis.productName.trim()
    : null;
}

/**
 * Feedback from the product's GATE 1 rejections, most recent first: the
 * notes (joined, capped at 2000 chars) and the product names the AI got
 * wrong (deduplicated, at most 20). Null when the product was never rejected.
 */
export async function loadRejectionHint(
  db: ScopedDb,
  productId: string,
): Promise<AnalyzeHint | null> {
  const rejections = await db.select(approval, {
    where: and(
      eq(approval.productId, productId),
      eq(approval.gate, "product_confirmation"),
      eq(approval.decision, "rejected"),
    ),
    orderBy: decisionOrder,
  });
  if (rejections.length === 0) return null;

  const notes = rejections.map((r) => r.note?.trim()).filter((n): n is string => !!n);
  const names = [
    ...new Set(rejections.map((r) => previousNameOf(r.payload)).filter((n): n is string => !!n)),
  ].slice(0, MAX_HINT_NAMES);

  const hint: AnalyzeHint = {};
  if (notes.length > 0) hint.note = notes.join("\n\n").slice(0, MAX_HINT_NOTE);
  if (names.length > 0) hint.rejectedProductNames = names;
  return Object.keys(hint).length > 0 ? analyzeHintSchema.parse(hint) : null;
}

export const analyzeStep: StepDefinition = {
  step: "analyze",
  limit: "ai",

  async run(env, row) {
    if (row.analysis) {
      return { patch: { name: row.name ?? row.analysis.productName } };
    }
    const { ctx, integrations, metered } = env;

    const brandRow = await ctx.db.getById(brand, row.brandId);
    const call = await buildCallContext(ctx.db, row.brandId);
    const hint = await loadRejectionHint(ctx.db, row.id);
    const analyze = (input: AnalyzeInput) =>
      metered(() =>
        integrations.productAnalyzer.analyze(call, {
          ...input,
          language: brandRow.language,
          ...(hint ? { hint } : {}),
        }),
      );

    let result;
    if (row.sourceType === "tiktok_video") {
      const input = await resolveTikTokInput(env, call, row.id, row.sourceUrl);
      try {
        result = await analyze(input);
      } catch (error) {
        if (!isExpiredMedia(error)) throw error;
        result = await analyze(await resolveTikTokInput(env, call, row.id, row.sourceUrl));
      }
    } else {
      result = await analyze({ source: "product_link", url: row.sourceUrl });
    }

    const analysis = productAnalysisSchema.parse(result.data);
    return { patch: { analysis, name: analysis.productName } };
  },
};
