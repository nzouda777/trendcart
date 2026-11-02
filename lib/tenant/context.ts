/**
 * Workspace context: who is acting, in which workspace, with which role, plus
 * a ScopedDb bound to that workspace. Every service takes one as its first
 * argument:
 *
 *   export async function launchCampaign(ctx: WorkspaceContext, input: LaunchInput) {
 *     requirePermission(ctx, "campaign:launch");
 *     const row = await ctx.db.getById(campaign, input.campaignId);
 *     ...
 *     await writeAudit(ctx, { action: "campaign.launch", targetType: "campaign", targetId: row.id });
 *   }
 *
 * Build it from the request with getWorkspaceContext() (lib/auth/session),
 * or here from trusted ids (MCP/API keys later, workflows, tests).
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { NoWorkspaceError } from "@/lib/auth/errors";
import { parseRole, type Role } from "@/lib/auth/permissions";
import { member, organization, user } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

import { createScopedDb, type ScopedDb } from "./scoped-db";

export type UserActor = {
  kind: "user";
  userId: string;
  role: Role;
  name: string;
  email: string;
};

/** Background work (workflow steps, cron, webhooks). Never passes requireRole. */
export type SystemActor = {
  kind: "system";
  /** e.g. "workflow:analyze", "cron:stats-sync", "webhook:shopify". */
  name: string;
};

export type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type WorkspaceContext = {
  readonly workspaceId: string;
  readonly db: ScopedDb;
  readonly actor: UserActor | SystemActor;
  readonly request?: RequestMeta;
};

export type UserWorkspaceContext = WorkspaceContext & { readonly actor: UserActor };

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: Role;
};

/** Loads the member row and builds a user context. Throws NoWorkspaceError if not a member. */
export async function createUserWorkspaceContext(
  db: Database,
  input: { userId: string; workspaceId: string; request?: RequestMeta },
): Promise<UserWorkspaceContext> {
  const rows = await db
    .select({ role: member.role, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.userId, input.userId), eq(member.organizationId, input.workspaceId)))
    .limit(1);

  const row = rows[0];
  const role = parseRole(row?.role);
  if (!row || !role) throw new NoWorkspaceError("You are not a member of this workspace.");

  const ctx: UserWorkspaceContext = {
    workspaceId: input.workspaceId,
    db: createScopedDb(db, input.workspaceId),
    actor: { kind: "user", userId: input.userId, role, name: row.name, email: row.email },
    request: input.request,
  };
  return Object.freeze(ctx);
}

/**
 * Context for background work. Only call with a workspace id read from a
 * trusted record (e.g. the job row), never from user input.
 */
export function createSystemContext(
  db: Database,
  input: { workspaceId: string; name: string },
): WorkspaceContext {
  const ctx: WorkspaceContext = {
    workspaceId: input.workspaceId,
    db: createScopedDb(db, input.workspaceId),
    actor: { kind: "system", name: input.name },
  };
  return Object.freeze(ctx);
}

/** Workspaces the user belongs to, oldest membership first. */
export async function listUserWorkspaces(
  db: Database,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));

  return rows.flatMap((r) => {
    const role = parseRole(r.role);
    return role ? [{ ...r, role }] : [];
  });
}

export function actorUserId(ctx: WorkspaceContext): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}
