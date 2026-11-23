import "server-only";

import { platformAuditLog } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

/** Platform admin actions (plans, workspaces, users, settings, impersonation). */
export const PLATFORM_ACTIONS = [
  "plan.create",
  "plan.update",
  "plan.delete",
  "plan.stripe_sync",
  "settings.update",
  "workspace.suspend",
  "workspace.unsuspend",
  "workspace.ai_cap",
  "workspace.grant_plan",
  "workspace.extend_trial",
  "workspace.end_access",
  "workspace.cancel_subscription",
  "workspace.delete",
  "user.ban",
  "user.unban",
  "user.revoke_sessions",
  "user.set_password",
  "user.verify_email",
  "user.disable_2fa",
  "user.impersonate",
  "user.set_admin",
  "user.delete",
  "admin.password_change",
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export async function writePlatformAudit(
  db: Database,
  entry: {
    adminUserId: string;
    action: PlatformAction;
    targetType?: string;
    targetId?: string;
    workspaceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(platformAuditLog).values({
    adminUserId: entry.adminUserId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    workspaceId: entry.workspaceId ?? null,
    metadata: entry.metadata ?? null,
  });
}
