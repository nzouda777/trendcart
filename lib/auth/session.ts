import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getDb } from "@/lib/db/client";
import {
  createUserWorkspaceContext,
  listUserWorkspaces,
  type UserWorkspaceContext,
  type WorkspaceSummary,
} from "@/lib/tenant/context";

import { NoWorkspaceError, UnauthenticatedError } from "./errors";
import { AUTH_PATHS } from "./paths";
import { createAuth, type Auth, type AuthSession } from "./server";

/*
 * Session helpers for Server Components, Server Actions and Route Handlers.
 * With Cache Components, anything that calls these reads the request, so
 * render it inside a <Suspense> boundary (see app/(app)/layout.tsx).
 *
 * - getWorkspaceContext(): for services called from actions/handlers.
 *   Throws UnauthenticatedError / NoWorkspaceError.
 * - requireWorkspacePage(): for pages and layouts. Redirects instead.
 */

let auth: Auth | undefined;

/** The Better Auth instance (built on first use). */
export function getAuth(): Auth {
  auth ??= createAuth(getDb());
  return auth;
}

/** Current session or null. Deduplicated per request. */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  // Read the request first: during prerendering this postpones the render
  // before anything touches the database.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

async function requestMeta() {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

/** Context for the session's active workspace. Deduplicated per request. */
export const getWorkspaceContext = cache(async (): Promise<UserWorkspaceContext> => {
  const session = await requireSession();
  const workspaceId = session.session.activeOrganizationId;
  if (!workspaceId) throw new NoWorkspaceError();
  return createUserWorkspaceContext(getDb(), {
    userId: session.user.id,
    workspaceId,
    request: await requestMeta(),
  });
});

/** Workspaces of the signed-in user (for the switcher). */
export const getMyWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const session = await requireSession();
  return listUserWorkspaces(getDb(), session.user.id);
});

/** Pages: the session, or redirect to sign-in (coming back to `next`). */
export async function requireSessionPage(next?: string): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    redirect(next ? `${AUTH_PATHS.signIn}?next=${encodeURIComponent(next)}` : AUTH_PATHS.signIn);
  }
  return session;
}

/** Pages and layouts: the workspace context, or redirect to sign-in / workspace creation. */
export async function requireWorkspacePage(): Promise<UserWorkspaceContext> {
  let failure: "signin" | "workspace";
  try {
    return await getWorkspaceContext();
  } catch (error) {
    if (error instanceof UnauthenticatedError) failure = "signin";
    else if (error instanceof NoWorkspaceError) failure = "workspace";
    else throw error;
  }
  redirect(failure === "signin" ? AUTH_PATHS.signIn : AUTH_PATHS.createWorkspace);
}
