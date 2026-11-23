import "server-only";

import { redirect } from "next/navigation";

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";

/*
 * Platform admin access (/admin). A platform admin is a user whose
 * `user.role` is "admin" (set only by `pnpm admin:create`). Every admin page,
 * action and service starts with one of these guards. Admin services get the
 * unscoped database: they work across workspaces by design.
 */

export type AdminContext = {
  adminUserId: string;
  name: string;
  email: string;
  /** Impersonating someone: admin actions are refused until it stops. */
  impersonating: boolean;
  db: Database;
};

export const ADMIN_HOME = "/admin";

async function resolveAdmin(): Promise<AdminContext | "signin" | "forbidden"> {
  const session = await getSession();
  if (!session) return "signin";
  const u = session.user as typeof session.user & { role?: string | null };
  if (u.role !== "admin") return "forbidden";
  const impersonatedBy = (session.session as { impersonatedBy?: string | null }).impersonatedBy;
  return {
    adminUserId: u.id,
    name: u.name,
    email: u.email,
    impersonating: !!impersonatedBy,
    db: getDb(),
  };
}

/** Pages and layouts: the admin, or redirect (sign-in / app). */
export async function requireAdminPage(): Promise<AdminContext> {
  const admin = await resolveAdmin();
  if (admin === "signin") redirect(`${AUTH_PATHS.signIn}?next=${encodeURIComponent(ADMIN_HOME)}`);
  if (admin === "forbidden") redirect(AUTH_PATHS.home);
  return admin;
}

/** Server actions and services: the admin, or an AccessError. */
export async function requireAdmin(): Promise<AdminContext> {
  const admin = await resolveAdmin();
  if (admin === "signin") throw new UnauthenticatedError();
  if (admin === "forbidden") throw new ForbiddenError("Platform admins only.");
  return admin;
}
