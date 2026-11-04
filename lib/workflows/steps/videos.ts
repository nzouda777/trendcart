/**
 * Step "build", videos part (runs after the page draft):
 *
 * 1. Gather: related TikTok videos of the same product (findRelatedVideos
 *    from lib/integrations/tiktok-data: several keyword searches in the brand
 *    country, ranked against the imported video), the best ones stored as `video` candidates (origin "related_search")
 *    next to the imported one: URL, author, thumbnail URL and metadata only,
 *    never a media URL (lib/media/candidates). Searched once per product:
 *    a re-run (page rejection, retry) keeps the stored candidates.
 * 2. Check: ComplianceChecker on each pending or approved video, with a
 *    fresh media URL resolved just in time for its size and duration (never
 *    stored), the page claims (ad texts and highlights) and the brand country.
 *    Only the JSON report is stored. A video is checked again when the claims
 *    changed (new copy): approved ones too, report only (their decision
 *    stands; approveVideos refuses an approved video whose new report fails).
 *    A report whose AI policy review was incomplete (`policy.ai_review` fail)
 *    is re-run once automatically. A video that can no longer be resolved is
 *    marked `checkError` and skipped.
 *
 * Bounded fan-out: at most MAX_RELATED_VIDEOS candidates per search,
 * MAX_CHECKS_PER_RUN checks per run, CHECK_CONCURRENCY at a time, and no new
 * wave once CHECK_WAVES_BUDGET_MS has elapsed. Idempotent:
 * candidates are upserted on (product, tiktok_url) and each check is saved as
 * soon as it is done, so a retry only redoes what is missing. Skipped once the
 * GATE 3 videos part is approved (the choice is closed).
 */
import { and, eq, ne } from "drizzle-orm";

import {
  IntegrationError,
  type CallContext,
  type ComplianceReport,
  type PageCopy,
} from "@/lib/domain/contracts";
import { brand, product, video } from "@/lib/db/schema";
import {
  assertNoMediaUrl,
  candidateMetadata,
  candidateVideoFields,
  MAX_RELATED_VIDEOS,
  newCandidates,
  relatedVideoQuery,
  resolveFreshMedia,
} from "@/lib/media/candidates";
import { findRelatedVideos } from "@/lib/integrations/tiktok-data";
import type { Row } from "@/lib/tenant/scoped-db";

import { buildCallContext } from "../call-context";
import { TIKTOK_MEDIA_PROVIDER } from "./analyze";
import { claimsVersion, complianceClaims } from "../compliance-claims";
import { gatePartStates } from "../gate-payloads";

import type { StepEnv } from "./types";

type ProductRow = Row<typeof product>;
type VideoRow = Row<typeof video>;
type BrandRow = Row<typeof brand>;

export const MAX_CHECKS_PER_RUN = 8;
export const CHECK_CONCURRENCY = 3;
/**
 * No new wave of checks starts after this much time in one run (a wave can
 * take up to the compliance timeout, about 120 s): the rest is left for the
 * next run, so a step or a server action stays well under its limit.
 */
export const CHECK_WAVES_BUDGET_MS = 150_000;
/** Extra results asked from the provider, to make up for duplicates. */
const SEARCH_SLACK = 4;

export { claimsVersion, complianceClaims };

/** What the compliance check of one video ran against (stored in video.metadata). */
export type VideoCheckMetadata = {
  /** Version of the claims (ad texts + highlights) the report was made with. */
  claimsVersion?: string;
  /** Set when the video could not be resolved or checked (no report then). */
  checkError?: string;
  /**
   * Claims version for which an incomplete AI review (`policy.ai_review`
   * fail) was already re-run automatically (once per version).
   */
  aiReviewRetried?: string;
};

function metaOf(row: VideoRow): Record<string, unknown> & VideoCheckMetadata {
  return (row.metadata ?? {}) as Record<string, unknown> & VideoCheckMetadata;
}

/** The report's AI policy review was incomplete (a model glitch, not a verdict). */
export function hasIncompleteAiReview(report: ComplianceReport | null): boolean {
  const rules: unknown = report?.rules;
  return (
    Array.isArray(rules) &&
    rules.some(
      (r: ComplianceReport["rules"][number]) =>
        r.ruleId === "policy.ai_review" && r.verdict === "fail",
    )
  );
}

/**
 * Videos due a check (rejected ones never are):
 * - no report yet (and no check error), or a report made with other claims
 *   (approved videos included: report only);
 * - an incomplete AI review, re-run once per claims version.
 */
export function videosToCheck(rows: readonly VideoRow[], version: string): VideoRow[] {
  return rows.filter((r) => {
    if (r.approval === "rejected") return false;
    const meta = metaOf(r);
    if (meta.claimsVersion !== version) return true;
    if (!r.compliance) return !meta.checkError;
    return hasIncompleteAiReview(r.compliance) && meta.aiReviewRetried !== version;
  });
}

/** 1. Related videos, searched once per product. Returns how many were added. */
export async function gatherRelatedVideos(
  env: Pick<StepEnv, "ctx" | "integrations">,
  row: ProductRow,
  brandRow: BrandRow,
  call: CallContext,
): Promise<number> {
  const { db } = env.ctx;
  const searched = await db.count(
    video,
    and(eq(video.productId, row.id), eq(video.origin, "related_search")),
  );
  if (searched > 0) return 0;
  if (!relatedVideoQuery(row.analysis)) return 0;

  const stored = await db.select(video, { where: eq(video.productId, row.id) });
  const imported = stored.find((v) => v.origin === "imported");
  const importedId = (imported?.metadata as { tiktokVideoId?: unknown } | null)?.tiktokVideoId;

  let found;
  try {
    found = await findRelatedVideos(env.integrations.tiktokData, call, {
      analysis: { productName: row.analysis!.productName, keywords: row.analysis!.keywords },
      ...(imported
        ? {
            imported: {
              tiktokUrl: imported.tiktokUrl,
              ...(typeof importedId === "string" ? { tiktokVideoId: importedId } : {}),
            },
          }
        : {}),
      excludeVideoIds: stored
        .map((v) => (v.metadata as { tiktokVideoId?: unknown } | null)?.tiktokVideoId)
        .filter((id): id is string => typeof id === "string"),
      country: brandRow.country,
      limit: MAX_RELATED_VIDEOS + SEARCH_SLACK,
    });
  } catch (error) {
    // Every search refused: not worth a retry, the product keeps its own video.
    if (error instanceof IntegrationError && !error.retryable) return 0;
    throw error;
  }

  const fresh = newCandidates(
    found.ranked.map((r) => r.candidate),
    new Set(stored.map((v) => v.tiktokUrl)),
  );
  for (const candidate of fresh) {
    const fields = candidateVideoFields(candidate);
    assertNoMediaUrl(fields.metadata);
    await db.upsert(
      video,
      { productId: row.id, tiktokUrl: candidate.tiktokUrl, origin: "related_search", ...fields },
      // Already there (race with another run): keep its origin and its check.
      { target: (t) => [t.productId, t.tiktokUrl], set: { thumbnailUrl: fields.thumbnailUrl } },
    );
  }
  return fresh.length;
}

function isExpiredMedia(error: unknown): boolean {
  return (
    error instanceof IntegrationError && error.provider === TIKTOK_MEDIA_PROVIDER && error.retryable
  );
}

const UNAVAILABLE = "This video is no longer available on TikTok.";

/** Checks one video and saves the report (or the reason it could not be checked). */
async function checkOne(
  env: Pick<StepEnv, "ctx" | "integrations" | "metered">,
  call: CallContext,
  target: VideoRow,
  input: { claims: string[]; version: string; category: string; countries: string[] },
): Promise<void> {
  const { db } = env.ctx;
  let metadata: Record<string, unknown>;
  let compliance: ComplianceReport | null = null;
  try {
    // The media URL expires quickly: resolved just in time, once more if the
    // checker reports it expired (403/410), never stored.
    let fresh = await resolveFreshMedia(env.integrations.tiktokData, call, target.tiktokUrl);
    const run = () =>
      env.metered(() =>
        env.integrations.complianceChecker.check(call, {
          durationSec: fresh.durationSec,
          width: fresh.width,
          height: fresh.height,
          caption: fresh.caption,
          claims: input.claims,
          productCategory: input.category,
          countries: input.countries,
          mediaUrl: fresh.mediaUrl,
        }),
      );
    let result;
    try {
      result = await run();
    } catch (error) {
      if (!isExpiredMedia(error)) throw error;
      fresh = await resolveFreshMedia(env.integrations.tiktokData, call, target.tiktokUrl);
      result = await run();
    }
    compliance = result.data;
    metadata = { ...candidateMetadata(fresh), claimsVersion: input.version };
    // The automatic re-run of an incomplete review happens once per version.
    const prior = metaOf(target);
    if (
      prior.aiReviewRetried === input.version ||
      (prior.claimsVersion === input.version && hasIncompleteAiReview(target.compliance))
    ) {
      metadata.aiReviewRetried = input.version;
    }
  } catch (error) {
    // Gone, private or refused by the provider: nothing a retry can fix.
    const gone =
      error instanceof IntegrationError &&
      error.provider !== "workflow" &&
      error.code !== "quota_exceeded" &&
      !error.retryable;
    if (!gone) throw error;
    const checkError =
      error.code === "not_found" ? UNAVAILABLE : `This video could not be checked (${error.code}).`;
    metadata = { ...metaOf(target), claimsVersion: input.version, checkError };
  }
  assertNoMediaUrl(metadata);
  // Pending and approved videos get the new report (an approved one keeps
  // its decision: report only); a rejection taken meanwhile keeps the old
  // one. An approved video that could not be checked keeps its last report.
  await db.update(
    video,
    target.approval === "approved" && !compliance ? { metadata } : { compliance, metadata },
    (v) => and(eq(v.id, target.id), ne(v.approval, "rejected")),
  );
}

export type CheckVideosOptions = {
  /** Check only these videos (e.g. the one a user just added). */
  only?: readonly string[];
  /** Check them even when their report is current (a reviewer's re-check). */
  force?: boolean;
  /** Wall clock in ms (tests). */
  clock?: () => number;
  /** No new wave after this much time (default CHECK_WAVES_BUDGET_MS). */
  budgetMs?: number;
};

/** 2. Compliance checks of the due videos, bounded in count and time, and resumable. */
export async function checkVideos(
  env: Pick<StepEnv, "ctx" | "integrations" | "metered">,
  row: ProductRow,
  brandRow: BrandRow,
  copy: PageCopy | null,
  call: CallContext,
  options: CheckVideosOptions = {},
): Promise<{ checked: number; remaining: number }> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const budgetMs = options.budgetMs ?? CHECK_WAVES_BUDGET_MS;
  const claims = complianceClaims(copy);
  const version = claimsVersion(claims);
  const rows = await env.ctx.db.select(video, {
    where: and(eq(video.productId, row.id), ne(video.approval, "rejected")),
    orderBy: (t) => t.createdAt,
  });
  const only = options.only;
  const scoped = only ? rows.filter((r) => only.includes(r.id)) : rows;
  const due = options.force ? scoped : videosToCheck(scoped, version);
  const batch = due.slice(0, MAX_CHECKS_PER_RUN);
  const input = {
    claims,
    version,
    category: row.analysis?.category ?? "general",
    countries: [brandRow.country],
  };

  let failure: unknown = null;
  let checked = 0;
  for (let i = 0; i < batch.length; i += CHECK_CONCURRENCY) {
    // Out of time: the rest is left for the next run.
    if (i > 0 && clock() - started >= budgetMs) break;
    const wave = batch.slice(i, i + CHECK_CONCURRENCY);
    const results = await Promise.allSettled(wave.map((v) => checkOne(env, call, v, input)));
    checked += wave.length;
    for (const r of results) if (r.status === "rejected") failure ??= r.reason;
    // Saved so far stays saved; the retry picks up the rest.
    if (failure) throw failure;
  }
  return { checked, remaining: due.length - checked };
}

/**
 * The videos part of the build step. Throws a retryable error when checks
 * remain beyond this run's budget, so the engine runs the step again (the
 * page part is idempotent and costs nothing on a re-run).
 */
export async function buildVideos(
  env: Pick<StepEnv, "ctx" | "integrations" | "metered">,
  row: ProductRow,
  copy: PageCopy | null,
): Promise<void> {
  const parts = await gatePartStates(env.ctx.db, row.id, "content_approval");
  if (parts.videos === "approved") return;
  const brandRow = await env.ctx.db.getById(brand, row.brandId);
  const call = await buildCallContext(env.ctx.db, row.brandId);
  await gatherRelatedVideos(env, row, brandRow, call);
  const { remaining } = await checkVideos(env, row, brandRow, copy, call);
  if (remaining > 0) {
    throw new IntegrationError(
      "workflow",
      "provider_error",
      `${remaining} video checks left for the next run.`,
      { retryable: true },
    );
  }
}
