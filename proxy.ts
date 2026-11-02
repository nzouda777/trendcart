import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/*
 * Optimistic auth gate for the product app (Next 16 "proxy", formerly
 * middleware.ts). It only checks that a session cookie exists, so signed-out
 * visitors are redirected before any rendering. The real check (session
 * validity, workspace membership, role) happens server-side in
 * requireWorkspacePage() / getWorkspaceContext() and in every service.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/sign-in";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Marketing pages, auth pages and /api/auth stay public.
  matcher: ["/app", "/app/:path*"],
};
