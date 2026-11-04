/**
 * Video lifecycle, candidate side (CLAUDE.md "Video lifecycle").
 *
 * - We store only the TikTok URL, author, thumbnail URL and metadata.
 * - Provider media URLs are short-lived and signed: resolve a fresh one just
 *   in time, hand it to the consumer (Gemini, Shopify staged upload), and
 *   never persist it.
 */
import type {
  CallContext,
  ResolvedTikTokVideo,
  TikTokDataProvider,
  VideoCandidate,
} from "@/lib/domain/contracts";
import type { video } from "@/lib/db/schema";
import type { NewRow } from "@/lib/tenant/scoped-db";

/** Metadata keys we keep. Anything else (notably `mediaUrl`) is dropped. */
export type CandidateMetadata = {
  tiktokVideoId: string;
  caption: string;
  stats: VideoCandidate["stats"];
  durationSec: number;
  postedAt?: string;
  displayName?: string;
  width?: number;
  height?: number;
};

/** Never-stored fields, checked by tests and by `assertNoMediaUrl`. */
const FORBIDDEN_KEYS = ["mediaUrl", "mediaUrlExpiresAt", "playUrl", "downloadUrl"] as const;

export function candidateMetadata(
  candidate: VideoCandidate | ResolvedTikTokVideo,
): CandidateMetadata {
  const meta: CandidateMetadata = {
    tiktokVideoId: candidate.tiktokVideoId,
    caption: candidate.caption,
    stats: candidate.stats,
    durationSec: candidate.durationSec,
  };
  if (candidate.postedAt) meta.postedAt = candidate.postedAt;
  if (candidate.author.displayName) meta.displayName = candidate.author.displayName;
  if ("width" in candidate) {
    meta.width = candidate.width;
    meta.height = candidate.height;
  }
  return meta;
}

/** Columns of a `video` row for a candidate (no media URL, ever). */
export function candidateVideoFields(
  candidate: VideoCandidate | ResolvedTikTokVideo,
): Pick<NewRow<typeof video>, "author" | "thumbnailUrl" | "metadata"> {
  return {
    author: candidate.author.username,
    thumbnailUrl: candidate.thumbnailUrl,
    metadata: candidateMetadata(candidate),
  };
}

export function assertNoMediaUrl(metadata: Record<string, unknown> | null | undefined) {
  for (const key of FORBIDDEN_KEYS) {
    if (metadata && key in metadata) {
      throw new Error(`video metadata must not contain "${key}" (provider URLs are never stored).`);
    }
  }
}

/**
 * Resolves a fresh, short-lived media URL for a stored TikTok URL. Call it
 * immediately before streaming; do not cache the result.
 */
export async function resolveFreshMedia(
  provider: TikTokDataProvider,
  ctx: CallContext,
  tiktokUrl: string,
): Promise<ResolvedTikTokVideo> {
  return provider.resolveVideo(ctx, tiktokUrl);
}

/* -------------------------------------------------------------------------- */
/* Related videos (build step, GATE 3 videos part)                            */
/* -------------------------------------------------------------------------- */

/** Related videos kept per product search (bounded fan-out for compliance checks). */
export const MAX_RELATED_VIDEOS = 6;

const MAX_QUERY_LENGTH = 100;

/**
 * Search query for videos of the same product: the first analysis keyword
 * (the most specific one), else the product name. Null when neither is usable.
 */
export function relatedVideoQuery(
  analysis: { keywords: string[]; productName: string } | null | undefined,
): string | null {
  if (!analysis) return null;
  const pick = [...analysis.keywords, analysis.productName]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .find((s) => s.length > 0);
  return pick ? pick.slice(0, MAX_QUERY_LENGTH) : null;
}

/**
 * Candidates worth storing: unique TikTok URLs, not already stored for the
 * product, at most `limit`, in the provider's order (its ranking).
 */
export function newCandidates(
  found: readonly VideoCandidate[],
  storedUrls: ReadonlySet<string>,
  limit = MAX_RELATED_VIDEOS,
): VideoCandidate[] {
  const seen = new Set(storedUrls);
  const out: VideoCandidate[] = [];
  for (const candidate of found) {
    if (out.length >= limit) break;
    if (seen.has(candidate.tiktokUrl)) continue;
    seen.add(candidate.tiktokUrl);
    out.push(candidate);
  }
  return out;
}
