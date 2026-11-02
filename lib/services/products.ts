import "server-only";

import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import { IntegrationError, productStatusSchema, type ProductStatus } from "@/lib/domain/contracts";
import type { TikTokLink } from "@/lib/integrations/tiktok-data/links";
import { parseImportLink, type ImportLink } from "@/lib/sourcing/links";
import {
  gateForStatus,
  isRunningStatus,
  stepForStatus,
  type ApprovalEvidence,
} from "@/lib/domain/state-machine";
import { approval, brand, job, product, video } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";
import { LEASE_TTL_MS } from "@/lib/workflows/concurrency";
import { lockProduct, recordGateDecision } from "@/lib/workflows/gate-payloads";
import { findOpenJob, latestFailedStep } from "@/lib/workflows/jobs";
import { applyProductEventTo } from "@/lib/workflows/product-status";

import { idSchema } from "./brands";
import { resolveNow, resolvePipeline, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import { enforceImportLimit } from "./rate-limit";
import type {
  ApprovalDTO,
  ImportResultDTO,
  JobDTO,
  ProductDetailDTO,
  ProductListDTO,
  ProductListItemDTO,
  VideoDTO,
} from "./types";

/* Schemas ------------------------------------------------------------------ */

const importInputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  brandId: idSchema,
});

/**
 * Classifies and normalises an import link with lib/sourcing/links (the one
 * set of rules for both import paths, including the SSRF host guard), before
 * anything touches the database. Invalid links become ServiceError
 * "invalid_input".
 */
function parseLink(url: string): ImportLink {
  try {
    return parseImportLink(url);
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "invalid_input") {
      throw new ServiceError("invalid_input", error.message);
    }
    throw error;
  }
}

/** Stored source_url of a TikTok link: canonical video URL, or the short link to resolve. */
function tiktokSourceUrl(link: TikTokLink): string {
  return link.kind === "video" ? link.canonicalUrl : link.shortUrl;
}

export const listProductsSchema = z
  .object({
    brandId: idSchema.optional(),
    status: z.union([productStatusSchema, z.array(productStatusSchema).min(1)]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .default({ limit: 50, offset: 0 });
export type ListProductsInput = z.input<typeof listProductsSchema>;

/* Mapping ------------------------------------------------------------------ */

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

function toListItem(row: Row<typeof product>, thumbnailUrl: string | null): ProductListItemDTO {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    status: row.status,
    gate: gateForStatus(row.status),
    thumbnailUrl,
    sellingPrice: row.sellingPrice,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toJobDTO(r: Row<typeof job>): JobDTO {
  return {
    id: r.id,
    step: r.step,
    status: r.status,
    attempts: r.attempts,
    error: r.error,
    aiCostUsd: r.aiCostUsd,
    startedAt: isoOrNull(r.startedAt),
    finishedAt: isoOrNull(r.finishedAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toApprovalDTO(r: Row<typeof approval>): ApprovalDTO {
  return {
    id: r.id,
    gate: r.gate,
    decision: r.decision,
    userId: r.userId,
    note: r.note,
    createdAt: iso(r.createdAt),
  };
}

function toVideoDTO(r: Row<typeof video>): VideoDTO {
  return {
    id: r.id,
    tiktokUrl: r.tiktokUrl,
    author: r.author,
    thumbnailUrl: r.thumbnailUrl,
    origin: r.origin,
    metadata: r.metadata,
    compliance: r.compliance,
    approval: r.approval,
    shopifyFileUrl: r.shopifyFileUrl,
    hasSparkCode: !!r.sparkCodeEnc,
    createdAt: iso(r.createdAt),
  };
}

function thumbnailOf(videos: Row<typeof video>[]): string | null {
  return (videos.find((v) => v.origin === "imported") ?? videos[0])?.thumbnailUrl ?? null;
}

/** Product detail DTO (no role check: callers checked product:read). */
export async function loadDetail(
  ctx: WorkspaceContext,
  productId: string,
): Promise<ProductDetailDTO> {
  const row = await ctx.db.getById(product, productId);
  const [jobs, approvals, videos] = await Promise.all([
    ctx.db.select(job, { where: eq(job.productId, row.id), orderBy: (t) => desc(t.createdAt) }),
    ctx.db.select(approval, {
      where: eq(approval.productId, row.id),
      orderBy: (t) => desc(t.createdAt),
    }),
    ctx.db.select(video, { where: eq(video.productId, row.id), orderBy: (t) => t.createdAt }),
  ]);
  const failedStep = row.status === "failed" ? await latestFailedStep(ctx.db, row.id) : null;
  const failedJob = failedStep
    ? jobs.find((j) => j.step === failedStep && j.status === "failed")
    : undefined;
  return {
    ...toListItem(row, thumbnailOf(videos)),
    analysis: row.analysis,
    compareAtPrice: row.compareAtPrice,
    margin: row.margin,
    failedStep,
    error: failedJob?.error ?? null,
    jobs: jobs.map(toJobDTO),
    approvals: approvals.map(toApprovalDTO),
    videos: videos.map(toVideoDTO),
  };
}

/* Import ------------------------------------------------------------------- */

async function importProduct(
  ctx: WorkspaceContext,
  input: { sourceType: "tiktok_video" | "product_link"; sourceUrl: string; brandId: string },
  deps: ServiceDeps,
): Promise<ImportResultDTO> {
  requirePermission(ctx, "product:create");
  await ctx.db.getById(brand, input.brandId);

  const existing = await ctx.db.findFirst(
    product,
    and(eq(product.brandId, input.brandId), eq(product.sourceUrl, input.sourceUrl)),
  );
  if (existing) return { product: await loadDetail(ctx, existing.id), created: false };

  // Only new imports count (they cost an AI analysis); re-imports are free.
  await enforceImportLimit(ctx.workspaceId, deps);

  const row = await ctx.db.insert(product, {
    brandId: input.brandId,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    status: "imported",
    createdByUserId: ctx.actor.userId,
  });

  // M1: the analyze step runs inline; with the durable engine this only starts the run.
  await resolvePipeline(deps).start(ctx, row.id);
  return { product: await loadDetail(ctx, row.id), created: true };
}

/** Imports a TikTok video link and runs the analysis (imported → analyzing → awaiting_product_confirmation | failed). */
export async function importFromTikTok(
  ctx: WorkspaceContext,
  input: { url: string; brandId: string },
  deps: ServiceDeps = {},
): Promise<ImportResultDTO> {
  requirePermission(ctx, "product:create");
  const v = importInputSchema.parse(input);
  const link = parseLink(v.url);
  if (link.sourceType !== "tiktok_video") {
    throw new ServiceError(
      "invalid_input",
      "This is not a TikTok video link. Import it as a product link instead.",
    );
  }
  return importProduct(
    ctx,
    { sourceType: "tiktok_video", sourceUrl: tiktokSourceUrl(link.tiktok), brandId: v.brandId },
    deps,
  );
}

/** Imports a product page link (store, marketplace) and runs the analysis. */
export async function importFromProductLink(
  ctx: WorkspaceContext,
  input: { url: string; brandId: string },
  deps: ServiceDeps = {},
): Promise<ImportResultDTO> {
  requirePermission(ctx, "product:create");
  const v = importInputSchema.parse(input);
  const link = parseLink(v.url);
  if (link.sourceType !== "product_link") {
    throw new ServiceError(
      "invalid_input",
      "This is a TikTok link: import it as a TikTok video instead.",
    );
  }
  return importProduct(
    ctx,
    { sourceType: "product_link", sourceUrl: link.url, brandId: v.brandId },
    deps,
  );
}

/* Reads -------------------------------------------------------------------- */

export async function listProducts(
  ctx: WorkspaceContext,
  input: ListProductsInput = {},
): Promise<ProductListDTO> {
  requirePermission(ctx, "product:read");
  const v = listProductsSchema.parse(input);
  const filters: SQL[] = [];
  if (v.brandId) filters.push(eq(product.brandId, v.brandId));
  if (v.status) {
    const statuses: ProductStatus[] = Array.isArray(v.status) ? v.status : [v.status];
    filters.push(inArray(product.status, statuses));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, total] = await Promise.all([
    ctx.db.select(product, {
      where,
      orderBy: (t) => desc(t.createdAt),
      limit: v.limit,
      offset: v.offset,
    }),
    ctx.db.count(product, where),
  ]);
  const videos = rows.length
    ? await ctx.db.select(video, {
        where: inArray(
          video.productId,
          rows.map((r) => r.id),
        ),
        orderBy: (t) => t.createdAt,
      })
    : [];
  const byProduct = new Map<string, Row<typeof video>[]>();
  for (const v2 of videos) {
    const list = byProduct.get(v2.productId) ?? [];
    list.push(v2);
    byProduct.set(v2.productId, list);
  }
  return {
    items: rows.map((r) => toListItem(r, thumbnailOf(byProduct.get(r.id) ?? []))),
    total,
  };
}

export async function getProduct(
  ctx: WorkspaceContext,
  productId: string,
): Promise<ProductDetailDTO> {
  requirePermission(ctx, "product:read");
  return loadDetail(ctx, idSchema.parse(productId));
}

/* Retry -------------------------------------------------------------------- */

/**
 * Re-runs the step a product is stuck in:
 * - `failed`: the step of the latest failed job (failed → its running status);
 *   a failed launch goes back to ready_to_launch and needs a new GATE 4.
 * - a running status whose job is not actually running (queued, or a stale
 *   lease after a crash): resumes that step.
 */
export async function retryStep(
  ctx: WorkspaceContext,
  productId: string,
  deps: ServiceDeps = {},
): Promise<ProductDetailDTO> {
  requirePermission(ctx, "product:update");
  const id = idSchema.parse(productId);
  const row = await ctx.db.getById(product, id);
  const now = resolveNow(deps)();

  if (row.status === "failed") {
    const step = await latestFailedStep(ctx.db, id);
    if (!step) throw new ServiceError("invalid_state", "No failed step to retry for this product.");
    await applyProductEventTo(ctx.db, row, { type: "retry", step });
    await resolvePipeline(deps).resumeStep(ctx, id, step);
    return loadDetail(ctx, id);
  }

  const step = stepForStatus(row.status);
  if (step && isRunningStatus(row.status)) {
    const open = await findOpenJob(ctx.db, id, step);
    const stale =
      !open || open.status !== "running" || now.getTime() - open.updatedAt.getTime() > LEASE_TTL_MS;
    if (!stale) throw new ServiceError("invalid_state", "This step is already running.");
    await resolvePipeline(deps).resumeStep(ctx, id, step);
    return loadDetail(ctx, id);
  }

  throw new ServiceError("invalid_state", "This product has nothing to retry.");
}

/* GATE 1 ------------------------------------------------------------------- */

const confirmSchema = z.object({
  productId: idSchema,
  /** Optional correction of the AI product name. */
  name: z.string().trim().min(1).max(255).optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * GATE 1: a human confirms the AI identified the right product. Records the
 * approval, moves awaiting_product_confirmation → sourcing in the same
 * transaction, audits, then wakes the pipeline.
 */
export async function confirmProduct(
  ctx: WorkspaceContext,
  input: z.input<typeof confirmSchema>,
  deps: ServiceDeps = {},
): Promise<ProductDetailDTO> {
  requirePermission(ctx, "gate:product_confirmation");
  const v = confirmSchema.parse(input);
  const userId = ctx.actor.userId;

  const approvalId = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    if (row.status !== "awaiting_product_confirmation") {
      throw new ServiceError(
        "invalid_state",
        "This product is not waiting for a product confirmation.",
      );
    }
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "product_confirmation",
      userId,
      decision: "approved",
      note: v.note ?? null,
      payload: v.name ? { name: v.name } : null,
    });
    const evidence: ApprovalEvidence = {
      id: recorded.id,
      productId: recorded.productId,
      gate: recorded.gate,
      decision: recorded.decision,
      userId: recorded.userId,
    };
    await applyProductEventTo(
      tx,
      row,
      { type: "gate_approved", productId: row.id, approval: evidence },
      v.name ? { name: v.name } : {},
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.approve",
        targetType: "product",
        targetId: row.id,
        metadata: { gate: "product_confirmation", approvalId: recorded.id, renamed: !!v.name },
      },
    );
    return recorded.id;
  });

  await resolvePipeline(deps).continueAfterGate(
    ctx,
    v.productId,
    "product_confirmation",
    approvalId,
  );
  return loadDetail(ctx, v.productId);
}

const rejectSchema = z.object({
  productId: idSchema,
  /** Why the AI got it wrong ("it's the lamp, not the stand"); shown in history. */
  note: z.string().trim().max(2000).optional(),
});

/**
 * GATE 1 rejection: the AI identified the wrong product. Records the
 * rejection, clears the previous analysis (kept in the approval payload for
 * history) and moves awaiting_product_confirmation -> analyzing in one
 * transaction, audits gate.reject, then re-runs the analyze step with the
 * same runner, limits and metering as an import. The analyzer is always
 * called again: the cleared analysis cannot be reused.
 */
export async function rejectProduct(
  ctx: WorkspaceContext,
  input: z.input<typeof rejectSchema>,
  deps: ServiceDeps = {},
): Promise<ProductDetailDTO> {
  requirePermission(ctx, "gate:product_confirmation");
  const v = rejectSchema.parse(input);
  const userId = ctx.actor.userId;

  const approvalId = await ctx.db.transaction(async (tx) => {
    const row = await lockProduct(tx, v.productId);
    if (row.status !== "awaiting_product_confirmation") {
      throw new ServiceError(
        "invalid_state",
        "This product is not waiting for a product confirmation.",
      );
    }
    const recorded = await recordGateDecision(tx, {
      productId: row.id,
      gate: "product_confirmation",
      userId,
      decision: "rejected",
      note: v.note ?? null,
      payload: { previousName: row.name, previousAnalysis: row.analysis },
    });
    const evidence: ApprovalEvidence = {
      id: recorded.id,
      productId: recorded.productId,
      gate: recorded.gate,
      decision: recorded.decision,
      userId: recorded.userId,
    };
    await applyProductEventTo(
      tx,
      row,
      { type: "gate_rejected", productId: row.id, approval: evidence },
      { analysis: null, name: null },
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "gate.reject",
        targetType: "product",
        targetId: row.id,
        metadata: {
          gate: "product_confirmation",
          approvalId: recorded.id,
          previousName: row.name,
          hasNote: !!v.note,
        },
      },
    );
    return recorded.id;
  });

  await resolvePipeline(deps).restartAfterRejection(
    ctx,
    v.productId,
    "product_confirmation",
    approvalId,
  );
  return loadDetail(ctx, v.productId);
}
