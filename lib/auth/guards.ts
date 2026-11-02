/**
 * Role guards for services. Call one at the top of every service function.
 * They throw ForbiddenError (status 403); system actors never pass, so
 * approvals, launches and budget changes always need a human.
 *
 *   requireRole(ctx, "media_buyer");          // media_buyer or owner
 *   requirePermission(ctx, "campaign:launch"); // finer grained, preferred
 */
import type { UserWorkspaceContext, WorkspaceContext } from "@/lib/tenant/context";

import { ForbiddenError } from "./errors";
import { can, roleAtLeast, ROLE_LABELS, type Permission, type Role } from "./permissions";

function assertUser(ctx: WorkspaceContext): asserts ctx is UserWorkspaceContext {
  if (ctx.actor.kind !== "user") {
    throw new ForbiddenError("This action needs a signed-in workspace member.");
  }
}

/** Passes when the caller's role is `min` or higher (owner > media_buyer > creative > viewer). */
export function requireRole(ctx: WorkspaceContext, min: Role): asserts ctx is UserWorkspaceContext {
  assertUser(ctx);
  if (!roleAtLeast(ctx.actor.role, min)) {
    throw new ForbiddenError(`This action needs the ${ROLE_LABELS[min]} role or higher.`);
  }
}

/** Passes when the caller's role grants every listed permission. */
export function requirePermission(
  ctx: WorkspaceContext,
  ...permissions: [Permission, ...Permission[]]
): asserts ctx is UserWorkspaceContext {
  assertUser(ctx);
  const role = ctx.actor.role;
  const missing = permissions.find((p) => !can(role, p));
  if (missing) {
    throw new ForbiddenError(`Your role (${ROLE_LABELS[role]}) cannot do "${missing}".`);
  }
}

/** Non-throwing variant for conditional UI or branching. */
export function hasPermission(ctx: WorkspaceContext, permission: Permission): boolean {
  return ctx.actor.kind === "user" && can(ctx.actor.role, permission);
}
