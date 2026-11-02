/**
 * Job rows: one per (product, step), reused across attempts and retries so
 * `attempts` counts every try. Steps write their progress here and the UI
 * reads it (lib/services/products getProduct).
 */
import { and, desc, eq, ne } from "drizzle-orm";

import { productStepSchema, type ProductStep } from "@/lib/domain/state-machine";
import { job } from "@/lib/db/schema";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";

export type JobRow = Row<typeof job>;

const MAX_ERROR_LENGTH = 500;

/** The latest job of this step that has not succeeded, if any. */
export async function findOpenJob(
  db: ScopedDb,
  productId: string,
  step: ProductStep,
): Promise<JobRow | undefined> {
  return db.findFirst(
    job,
    (j) => and(eq(j.productId, productId), eq(j.step, step), ne(j.status, "succeeded")),
    { orderBy: (j) => desc(j.createdAt) },
  );
}

/** Marks the step as waiting to run (idempotent: reuses an open job). */
export async function queueJob(db: ScopedDb, productId: string, step: ProductStep) {
  const open = await findOpenJob(db, productId, step);
  if (open) {
    if (open.status === "queued") return open;
    const [row] = await db.update(job, { status: "queued", error: null }, eq(job.id, open.id));
    return row;
  }
  return db.insert(job, { productId, step, status: "queued" });
}

/** Starts one attempt: open job → running, attempts + 1. */
export async function beginAttempt(
  db: ScopedDb,
  productId: string,
  step: ProductStep,
  now: Date,
): Promise<JobRow> {
  const open = await findOpenJob(db, productId, step);
  if (!open) {
    return db.insert(job, { productId, step, status: "running", attempts: 1, startedAt: now });
  }
  const [row] = await db.update(
    job,
    {
      status: "running",
      attempts: open.attempts + 1,
      error: null,
      startedAt: open.startedAt ?? now,
      finishedAt: null,
    },
    eq(job.id, open.id),
  );
  return row;
}

export async function addJobCost(db: ScopedDb, jobRow: JobRow, costUsd: number) {
  if (costUsd <= 0) return jobRow;
  const current = await db.getById(job, jobRow.id);
  const [row] = await db.update(
    job,
    { aiCostUsd: roundCost(current.aiCostUsd + costUsd) },
    eq(job.id, jobRow.id),
  );
  return row;
}

export async function succeedJob(db: ScopedDb, jobId: string, now: Date) {
  const [row] = await db.update(
    job,
    { status: "succeeded", error: null, finishedAt: now },
    eq(job.id, jobId),
  );
  return row;
}

export async function failJob(db: ScopedDb, jobId: string, error: string, now: Date) {
  const [row] = await db.update(
    job,
    { status: "failed", error: error.slice(0, MAX_ERROR_LENGTH), finishedAt: now },
    eq(job.id, jobId),
  );
  return row;
}

/** A retryable failure the durable engine will retry later: queued again, error kept. */
export async function deferJob(db: ScopedDb, jobId: string, error: string) {
  const [row] = await db.update(
    job,
    { status: "queued", error: error.slice(0, MAX_ERROR_LENGTH) },
    eq(job.id, jobId),
  );
  return row;
}

/** The step a failed product failed in (latest failed job). */
export async function latestFailedStep(
  db: ScopedDb,
  productId: string,
): Promise<ProductStep | null> {
  const row = await db.findFirst(
    job,
    (j) => and(eq(j.productId, productId), eq(j.status, "failed")),
    { orderBy: (j) => desc(j.updatedAt) },
  );
  const parsed = productStepSchema.safeParse(row?.step);
  return parsed.success ? parsed.data : null;
}

function roundCost(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
