/**
 * Audit log writer. Write one entry for every sensitive action: gate
 * approvals, publishing (page, video, TikTok post), campaign launch/pause,
 * budget changes, connection changes, member and role changes.
 *
 *   await writeAudit(ctx, {
 *     action: "campaign.launch",
 *     targetType: "campaign",
 *     targetId: row.id,
 *     metadata: { budget: 50 },
 *   });
 *
 * Pass `ctx.db` from inside a transaction (`ctx.db.transaction(tx => ...)`)
 * as `{ ...ctx, db: tx }` to make the entry atomic with the change.
 * Metadata is redacted: keys that look like secrets are replaced.
 */
import { z } from "zod";

import { auditLog } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { actorUserId, type WorkspaceContext } from "@/lib/tenant/context";
import { createScopedDb } from "@/lib/tenant/scoped-db";

export const auditActionSchema = z.enum([
  // Workspace and members
  "workspace.create",
  "workspace.update",
  "member.invite",
  "member.join",
  "member.role_change",
  "member.remove",
  "auth.two_factor_enable",
  "auth.two_factor_disable",
  // Brands and connections
  "brand.create",
  "brand.update",
  "brand.delete",
  "connection.create",
  "connection.update",
  "connection.delete",
  "proxy.update",
  // Gates
  "gate.approve",
  "gate.reject",
  // Publishing
  /** A user edited the generated page copy before GATE 3. */
  "page.update",
  "page.publish",
  /** A GATE 3 publish failed and was rolled back (product back to DRAFT, approval voided). */
  "page.publish_revert",
  "video.approve",
  "video.reject",
  "video.publish",
  "video.media_delete",
  // Campaigns
  "campaign.create",
  "campaign.launch",
  "campaign.pause",
  "campaign.budget_change",
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEntrySchema = z.object({
  action: auditActionSchema,
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEntry = z.input<typeof auditEntrySchema>;

const SECRET_KEY =
  /(token|secret|password|passwd|authorization|cookie|api[-_]?key|_enc$|enc$|spark|auth[-_]?code|proxy[-_]?url)/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 5;

/** Deep copy with secret-looking keys redacted. Exported for tests. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

export async function writeAudit(ctx: WorkspaceContext, entry: AuditEntry) {
  const parsed = auditEntrySchema.parse(entry);
  const metadata = redact({
    ...parsed.metadata,
    ...(ctx.actor.kind === "system" ? { system: ctx.actor.name } : {}),
  }) as Record<string, unknown>;

  return ctx.db.insert(auditLog, {
    actorUserId: actorUserId(ctx),
    action: parsed.action,
    targetType: parsed.targetType ?? null,
    targetId: parsed.targetId ?? null,
    metadata,
    ipAddress: ctx.request?.ipAddress ?? null,
    userAgent: ctx.request?.userAgent ?? null,
  });
}

/**
 * For lib/auth hooks only, where no WorkspaceContext exists yet (e.g. the
 * workspace was just created). The workspace id must come from Better Auth.
 */
export async function writeAuditForWorkspace(
  db: Database,
  input: { workspaceId: string; actorUserId: string | null; entry: AuditEntry },
) {
  const parsed = auditEntrySchema.parse(input.entry);
  return createScopedDb(db, input.workspaceId).insert(auditLog, {
    actorUserId: input.actorUserId,
    action: parsed.action,
    targetType: parsed.targetType ?? null,
    targetId: parsed.targetId ?? null,
    metadata: redact(parsed.metadata ?? {}) as Record<string, unknown>,
  });
}
