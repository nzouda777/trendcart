/**
 * Better Auth server instance.
 *
 * - Email + password, email verification required (mock mode logs the link).
 * - Organization plugin = workspaces; roles owner / media_buyer / creative /
 *   viewer from ./permissions. The creator becomes owner.
 * - Optional TOTP two-factor.
 *
 * `createAuth(db)` is pure (tests pass a PGlite db); the app uses `getAuth()`,
 * which builds the instance on first use so builds need no env vars.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";

import { writeAuditForWorkspace } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import { authSchema, member } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

import { invitationEmail, sendAuthEmail, verificationEmail } from "./mail";
import { AUTH_PATHS } from "./paths";
import { authRateLimitOptions } from "./rate-limit";
import { ac, isRole, parseRole, ROLES, roles } from "./permissions";

const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

function baseURL() {
  // `||`, not `??`: an empty BETTER_AUTH_URL= line in .env must fall back too.
  return (process.env.BETTER_AUTH_URL?.trim() || siteConfig.url).replace(/\/+$/, "");
}

async function firstWorkspaceId(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Audit failures must never break auth flows. */
async function safeAudit(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error("[audit] failed to write auth audit entry", error);
  }
}

function assertKnownRoles(raw: string | string[] | null | undefined) {
  const list = (Array.isArray(raw) ? raw : (raw ?? "").split(","))
    .map((r) => r.trim())
    .filter(Boolean);
  if (list.length === 0 || !list.every(isRole)) {
    throw new APIError("BAD_REQUEST", { message: `Role must be one of: ${ROLES.join(", ")}.` });
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function createAuth(db: Database) {
  const url = baseURL();

  return betterAuth({
    appName: siteConfig.name,
    baseURL: url,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: true }),
    // Upstash-backed when configured (shared across instances), memory otherwise.
    rateLimit: authRateLimitOptions(),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      autoSignIn: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url: link }) {
        await sendAuthEmail(verificationEmail({ to: user.email, name: user.name, url: link }));
      },
    },

    databaseHooks: {
      session: {
        create: {
          // New sessions open the user's first workspace.
          async before(session) {
            const activeOrganizationId = await firstWorkspaceId(db, session.userId);
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },

    hooks: {
      // Member changes whose org hooks do not tell us who acted.
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path !== "/organization/update-member-role" &&
          ctx.path !== "/organization/remove-member"
        ) {
          return;
        }
        const returned = record(ctx.context.returned);
        if (!returned || returned.statusCode || returned.status === "FORBIDDEN") return;
        const actor =
          (await getSessionFromCtx(ctx).catch(() => null))?.user.id ??
          ctx.context.session?.user.id ??
          null;
        const changed = record(returned?.member) ?? returned;
        const workspaceId = changed?.organizationId;
        if (!actor || typeof workspaceId !== "string" || typeof changed?.id !== "string") return;

        await safeAudit(() =>
          writeAuditForWorkspace(db, {
            workspaceId,
            actorUserId: actor,
            entry: {
              action:
                ctx.path === "/organization/remove-member" ? "member.remove" : "member.role_change",
              targetType: "member",
              targetId: changed.id as string,
              metadata: { userId: changed.userId, role: changed.role },
            },
          }),
        );
      }),
    },

    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        invitationExpiresIn: INVITATION_TTL_SECONDS,
        requireEmailVerificationOnInvitation: true,
        cancelPendingInvitationsOnReInvite: true,
        async sendInvitationEmail(data) {
          await sendAuthEmail(
            invitationEmail({
              to: data.email,
              inviterName: data.inviter.user.name,
              workspaceName: data.organization.name,
              role: parseRole(data.role),
              url: `${url}${AUTH_PATHS.invite(data.id)}`,
            }),
          );
        },
        organizationHooks: {
          // Better Auth accepts any role string; only ours are valid.
          async beforeCreateInvitation({ invitation }) {
            assertKnownRoles(invitation.role);
          },
          async beforeAddMember({ member: added }) {
            assertKnownRoles(added.role);
          },
          async beforeUpdateMemberRole({ newRole }) {
            assertKnownRoles(newRole);
          },
          async afterCreateOrganization({ organization: org, user }) {
            await safeAudit(() =>
              writeAuditForWorkspace(db, {
                workspaceId: org.id,
                actorUserId: user.id,
                entry: { action: "workspace.create", targetType: "workspace", targetId: org.id },
              }),
            );
          },
          async afterCreateInvitation({ invitation, inviter }) {
            await safeAudit(() =>
              writeAuditForWorkspace(db, {
                workspaceId: invitation.organizationId,
                actorUserId: inviter.id,
                entry: {
                  action: "member.invite",
                  targetType: "invitation",
                  targetId: invitation.id,
                  metadata: { email: invitation.email, role: invitation.role },
                },
              }),
            );
          },
          async afterAcceptInvitation({ member: joined, user }) {
            await safeAudit(() =>
              writeAuditForWorkspace(db, {
                workspaceId: joined.organizationId,
                actorUserId: user.id,
                entry: {
                  action: "member.join",
                  targetType: "member",
                  targetId: joined.id,
                  metadata: { role: joined.role },
                },
              }),
            );
          },
        },
      }),
      twoFactor({ issuer: siteConfig.name }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
