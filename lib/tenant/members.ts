import "server-only";

import { asc, eq } from "drizzle-orm";

import { parseRole, type Role } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { member, user } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

import type { WorkspaceContext } from "./context";

export type WorkspaceMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
};

/**
 * Members of the context's workspace, oldest first. No request headers
 * needed, so services and the future MCP server can call it. The workspace
 * always comes from `ctx`; members with an unknown role are left out.
 */
export async function listWorkspaceMembers(
  ctx: WorkspaceContext,
  db: Database = getDb(),
): Promise<WorkspaceMember[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.workspaceId))
    .orderBy(asc(member.createdAt), asc(member.id));

  return rows.flatMap((r) => {
    const role = parseRole(r.role);
    return role ? [{ ...r, role }] : [];
  });
}
