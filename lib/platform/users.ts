import "server-only";

import { count, desc, eq, ilike, inArray, max, or } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";

import { getAuth } from "@/lib/auth/session";
import { member, organization, session, twoFactor, user } from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";

import { writePlatformAudit } from "./audit";
import type { AdminContext } from "./guard";

/*
 * Users seen by platform admins. Bans, session revocation, passwords, role and
 * removal go through Better Auth's admin plugin endpoints (auth.api.*, with
 * the admin's own session headers), so its checks and hooks apply. Email
 * verification and 2FA reset are direct updates. Every action is audited.
 */

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  workspaces: { id: string; name: string; role: string }[];
};

export async function listUsers(
  db: AdminContext["db"],
  input: { q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const q = input.q?.trim();
  const where = q ? or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`)) : undefined;
  const [users, [total]] = await Promise.all([
    db
      .select()
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(input.limit ?? 50)
      .offset(input.offset ?? 0),
    db.select({ c: count() }).from(user).where(where),
  ]);
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return { rows: [], total: Number(total?.c ?? 0) };
  const [memberships, lastSeen] = await Promise.all([
    db
      .select({
        userId: member.userId,
        id: organization.id,
        name: organization.name,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(inArray(member.userId, ids)),
    db
      .select({ userId: session.userId, at: max(session.updatedAt) })
      .from(session)
      .where(inArray(session.userId, ids))
      .groupBy(session.userId),
  ]);
  return {
    total: Number(total?.c ?? 0),
    rows: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? null,
      emailVerified: u.emailVerified,
      twoFactorEnabled: !!u.twoFactorEnabled,
      banned: !!u.banned,
      banReason: u.banReason ?? null,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: lastSeen.find((s) => s.userId === u.id)?.at?.toISOString() ?? null,
      workspaces: memberships
        .filter((m) => m.userId === u.id)
        .map((m) => ({ id: m.id, name: m.name, role: m.role })),
    })),
  };
}

async function target(admin: AdminContext, userId: string) {
  if (admin.impersonating) {
    throw new ServiceError("invalid_state", "Stop impersonating before using admin actions.");
  }
  const [row] = await admin.db.select().from(user).where(eq(user.id, userId));
  if (!row) throw new ServiceError("invalid_input", "This user does not exist.");
  return row;
}

function notSelf(admin: AdminContext, userId: string, what: string) {
  if (admin.adminUserId === userId) {
    throw new ServiceError("invalid_input", `You cannot ${what} your own account.`);
  }
}

const api = () => getAuth().api;

export async function banUser(
  admin: AdminContext,
  userId: string,
  input: { reason?: string; days?: number | null },
): Promise<void> {
  const u = await target(admin, userId);
  notSelf(admin, userId, "ban");
  const v = z
    .object({
      reason: z.string().trim().max(300).optional(),
      days: z.number().int().min(1).max(3650).nullable().optional(),
    })
    .parse(input);
  await api().banUser({
    headers: await headers(),
    body: {
      userId,
      ...(v.reason ? { banReason: v.reason } : {}),
      ...(v.days ? { banExpiresIn: v.days * 86_400 } : {}),
    },
  });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.ban",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email, reason: v.reason ?? null, days: v.days ?? null },
  });
}

export async function unbanUser(admin: AdminContext, userId: string): Promise<void> {
  const u = await target(admin, userId);
  await api().unbanUser({ headers: await headers(), body: { userId } });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.unban",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
}

export async function revokeSessions(admin: AdminContext, userId: string): Promise<void> {
  const u = await target(admin, userId);
  await api().revokeUserSessions({ headers: await headers(), body: { userId } });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.revoke_sessions",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
}

export async function setUserPassword(
  admin: AdminContext,
  userId: string,
  newPassword: string,
): Promise<void> {
  const u = await target(admin, userId);
  const password = z.string().min(10, "Use at least 10 characters.").max(128).parse(newPassword);
  await api().setUserPassword({
    headers: await headers(),
    body: { userId, newPassword: password },
  });
  // Existing sessions end so the new password applies everywhere.
  if (userId !== admin.adminUserId) {
    await api().revokeUserSessions({ headers: await headers(), body: { userId } });
  }
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: userId === admin.adminUserId ? "admin.password_change" : "user.set_password",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
}

export async function verifyEmail(admin: AdminContext, userId: string): Promise<void> {
  const u = await target(admin, userId);
  await admin.db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.verify_email",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
}

/** Turns off two-factor for a user who lost their authenticator. */
export async function disableTwoFactor(admin: AdminContext, userId: string): Promise<void> {
  const u = await target(admin, userId);
  await admin.db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
  });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.disable_2fa",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
}

export async function setPlatformAdmin(
  admin: AdminContext,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const u = await target(admin, userId);
  notSelf(admin, userId, "change the role of");
  await api().setRole({
    headers: await headers(),
    body: { userId, role: isAdmin ? "admin" : "user" },
  });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.set_admin",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email, admin: isAdmin },
  });
}

/** Deletes a user account (their workspaces stay; a sole owner should be replaced first). */
export async function deleteUser(admin: AdminContext, userId: string): Promise<void> {
  const u = await target(admin, userId);
  notSelf(admin, userId, "delete");
  await api().removeUser({ headers: await headers(), body: { userId } });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.delete",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
}

/**
 * Signs the admin in as the user (1 hour, Better Auth impersonation), to see
 * what they see. Audited; admin actions are refused until it stops.
 */
export async function impersonate(admin: AdminContext, userId: string): Promise<void> {
  const u = await target(admin, userId);
  notSelf(admin, userId, "impersonate");
  if (u.role === "admin") throw new ServiceError("invalid_input", "Admins cannot be impersonated.");
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "user.impersonate",
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
  });
  await api().impersonateUser({ headers: await headers(), body: { userId } });
}
