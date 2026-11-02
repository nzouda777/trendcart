import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { auditLog, member, session as sessionTable, user } from "@/lib/db/schema";
import { createTestDb } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import { createUserWorkspaceContext } from "@/lib/tenant/context";

import { createAuth, type Auth } from "./server";

/*
 * Runs the real Better Auth instance against PGlite: proves the Drizzle
 * schema matches what Better Auth expects and that workspaces, roles,
 * invitations and the session's active workspace work end to end.
 */

let db: Database;
let close: () => Promise<void>;
let auth: Auth;

const PASSWORD = "correct-horse-battery";

async function signUpVerified(email: string, name: string) {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
}

async function signIn(email: string): Promise<Headers> {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no session cookie");
  return new Headers({ cookie: cookie.split(";")[0] });
}

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("INTEGRATIONS_MODE", "mock");
  vi.spyOn(console, "info").mockImplementation(() => {});
  ({ db, close } = await createTestDb());
  auth = createAuth(db);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close();
});

describe("Better Auth on the Drizzle schema", () => {
  it("requires email verification before sign-in", async () => {
    await auth.api.signUpEmail({
      body: { email: "unverified@example.test", password: PASSWORD, name: "Unverified" },
    });
    await expect(
      auth.api.signInEmail({ body: { email: "unverified@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
  });

  it("creates a workspace with the creator as owner, invites and assigns roles", async () => {
    await signUpVerified("owner@example.test", "Olivia Owner");
    const ownerHeaders = await signIn("owner@example.test");

    const org = await auth.api.createOrganization({
      headers: ownerHeaders,
      body: { name: "Acme", slug: "acme" },
    });
    expect(org?.id).toBeTruthy();
    const workspaceId = org!.id;

    const owner = await db.select().from(member).where(eq(member.organizationId, workspaceId));
    expect(owner).toHaveLength(1);
    expect(owner[0].role).toBe("owner");

    // Audit entry for the new workspace.
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId));
    expect(audits.map((a) => a.action)).toContain("workspace.create");

    // Invite a creative; accept as that user.
    const invitation = await auth.api.createInvitation({
      headers: ownerHeaders,
      body: { email: "creative@example.test", role: "creative", organizationId: workspaceId },
    });
    await signUpVerified("creative@example.test", "Casey Creative");
    const creativeHeaders = await signIn("creative@example.test");
    await auth.api.acceptInvitation({
      headers: creativeHeaders,
      body: { invitationId: invitation.id },
    });

    const creativeUser = (
      await db.select().from(user).where(eq(user.email, "creative@example.test"))
    )[0];
    const ctx = await createUserWorkspaceContext(db, {
      userId: creativeUser.id,
      workspaceId,
    });
    expect(ctx.actor).toMatchObject({ kind: "user", role: "creative" });

    // A creative cannot invite (Better Auth enforces our access control).
    await expect(
      auth.api.createInvitation({
        headers: creativeHeaders,
        body: { email: "x@example.test", role: "viewer", organizationId: workspaceId },
      }),
    ).rejects.toThrow();

    // Owner promotes the creative to media_buyer; the change is audited.
    const creativeMember = (
      await db.select().from(member).where(eq(member.userId, creativeUser.id))
    )[0];
    await auth.api.updateMemberRole({
      headers: ownerHeaders,
      body: { memberId: creativeMember.id, role: "media_buyer", organizationId: workspaceId },
    });
    const promoted = await createUserWorkspaceContext(db, {
      userId: creativeUser.id,
      workspaceId,
    });
    expect(promoted.actor).toMatchObject({ role: "media_buyer" });
    const actions = (
      await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["member.invite", "member.join", "member.role_change"]),
    );

    // Unknown roles are refused, for invitations and role changes.
    await expect(
      auth.api.createInvitation({
        headers: ownerHeaders,
        body: {
          email: "admin@example.test",
          role: "admin" as "viewer",
          organizationId: workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.updateMemberRole({
        headers: ownerHeaders,
        body: { memberId: creativeMember.id, role: "admin", organizationId: workspaceId },
      }),
    ).rejects.toThrow();
  });

  it("opens the first workspace on new sessions", async () => {
    const headers = await signIn("owner@example.test");
    const current = await auth.api.getSession({ headers });
    expect(current?.session.activeOrganizationId).toBeTruthy();

    const rows = await db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, current!.user.id));
    expect(
      rows.every((r) => r.activeOrganizationId === current!.session.activeOrganizationId),
    ).toBe(true);
  });
});
