import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import {
  auditLog,
  job,
  organization,
  platformAuditLog,
  product,
  shopifyConnection,
  stripeEvent,
  tiktokAdConnection,
  tiktokProfileConnection,
  user,
} from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

/** Read-only activity lists for /admin (most recent first). */

const BAD = ["needs_reauth", "revoked", "expiring"] as const;

export async function listPlatformAudit(db: Database, limit = 100) {
  return db
    .select({
      id: platformAuditLog.id,
      action: platformAuditLog.action,
      targetType: platformAuditLog.targetType,
      targetId: platformAuditLog.targetId,
      workspaceId: platformAuditLog.workspaceId,
      metadata: platformAuditLog.metadata,
      createdAt: platformAuditLog.createdAt,
      adminEmail: user.email,
    })
    .from(platformAuditLog)
    .leftJoin(user, eq(user.id, platformAuditLog.adminUserId))
    .orderBy(desc(platformAuditLog.createdAt))
    .limit(limit);
}

export async function listWorkspaceAudit(db: Database, limit = 100, action?: string) {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      workspaceId: auditLog.workspaceId,
      workspaceName: organization.name,
      actorEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(organization, eq(organization.id, auditLog.workspaceId))
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .where(action ? eq(auditLog.action, action) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

export async function listFailedJobs(db: Database, limit = 100) {
  return db
    .select({
      id: job.id,
      step: job.step,
      error: job.error,
      attempts: job.attempts,
      updatedAt: job.updatedAt,
      productId: job.productId,
      productName: product.name,
      workspaceId: job.workspaceId,
      workspaceName: organization.name,
    })
    .from(job)
    .leftJoin(product, eq(product.id, job.productId))
    .leftJoin(organization, eq(organization.id, job.workspaceId))
    .where(eq(job.status, "failed"))
    .orderBy(desc(job.updatedAt))
    .limit(limit);
}

export async function listStripeEvents(db: Database, limit = 100) {
  return db.select().from(stripeEvent).orderBy(desc(stripeEvent.receivedAt)).limit(limit);
}

export async function listConnectionIssues(db: Database) {
  const [stores, ads, profiles] = await Promise.all([
    db
      .select({
        id: shopifyConnection.id,
        name: shopifyConnection.shopDomain,
        status: shopifyConnection.status,
        workspaceId: shopifyConnection.workspaceId,
        updatedAt: shopifyConnection.updatedAt,
      })
      .from(shopifyConnection)
      .where(inArray(shopifyConnection.status, [...BAD])),
    db
      .select({
        id: tiktokAdConnection.id,
        name: tiktokAdConnection.name,
        status: tiktokAdConnection.status,
        workspaceId: tiktokAdConnection.workspaceId,
        updatedAt: tiktokAdConnection.updatedAt,
      })
      .from(tiktokAdConnection)
      .where(inArray(tiktokAdConnection.status, [...BAD])),
    db
      .select({
        id: tiktokProfileConnection.id,
        name: tiktokProfileConnection.displayName,
        status: tiktokProfileConnection.status,
        workspaceId: tiktokProfileConnection.workspaceId,
        updatedAt: tiktokProfileConnection.updatedAt,
      })
      .from(tiktokProfileConnection)
      .where(and(inArray(tiktokProfileConnection.status, [...BAD]))),
  ]);
  const ids = [...new Set([...stores, ...ads, ...profiles].map((r) => r.workspaceId))];
  const orgs = ids.length
    ? await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(inArray(organization.id, ids))
    : [];
  const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;
  return [
    ...stores.map((r) => ({ ...r, kind: "Shopify store", workspaceName: name(r.workspaceId) })),
    ...ads.map((r) => ({ ...r, kind: "TikTok Ads", workspaceName: name(r.workspaceId) })),
    ...profiles.map((r) => ({ ...r, kind: "TikTok profile", workspaceName: name(r.workspaceId) })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
