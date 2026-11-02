import "server-only";

import { requirePermission } from "@/lib/auth/guards";
import type { WorkspaceContext } from "@/lib/tenant/context";
import { listWorkspaceMembers, type WorkspaceMember } from "@/lib/tenant/members";

import type { MemberDTO } from "./types";

/*
 * Team. Invitations, role changes and removals go through Better Auth's
 * organization endpoints (authClient.organization.inviteMember /
 * updateMemberRole / removeMember); lib/auth/server.ts validates roles and
 * writes the audit entries in its hooks, so there are no wrappers here.
 *
 * Members come from lib/tenant/members (header-free, so the future MCP
 * server can call this too). Tests inject the directory.
 */

export type MemberDirectory = (ctx: WorkspaceContext) => Promise<WorkspaceMember[]>;

export async function listMembers(
  ctx: WorkspaceContext,
  deps: { directory?: MemberDirectory } = {},
): Promise<MemberDTO[]> {
  requirePermission(ctx, "workspace:read");
  const directory = deps.directory ?? ((c: WorkspaceContext) => listWorkspaceMembers(c));
  const rows = await directory(ctx);
  return rows.map((m) => ({
    memberId: m.memberId,
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    isCurrentUser: m.userId === ctx.actor.userId,
  }));
}
