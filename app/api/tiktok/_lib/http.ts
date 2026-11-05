import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { isAccessError, UnauthenticatedError } from "@/lib/auth/errors";
import { OAuthStateError } from "@/lib/auth/oauth-state";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { IntegrationError } from "@/lib/domain/contracts";
import { getIntegrations } from "@/lib/integrations";
import { MissingConfigError } from "@/lib/integrations/tiktok-ads/safety";
import { publicOrigin } from "@/lib/integrations/shopify/http";

/** Where the connections screen lives (built by app-ui). */
export const CONNECTIONS_PATH = "/app/connections";

export const ADS_CALLBACK_PATH = "/api/tiktok/ads/callback";
export const LOGIN_CALLBACK_PATH = "/api/tiktok/login/callback";

export const tiktokAdsClient = () => getIntegrations().tiktokAds;
export const tiktokPostingClient = () => getIntegrations().tiktokPosting;

/**
 * Absolute callback URL on the public origin (NEXT_PUBLIC_SITE_URL, else the
 * request's in dev). TikTok requires it to match a redirect URI registered
 * on the app exactly (static, https in prod).
 */
export function callbackUrl(request: Request, path: string): string {
  return new URL(path, publicOrigin(request.url)).toString();
}

export function redirectTo(request: Request, path: string, params: Record<string, string>) {
  const url = new URL(path, publicOrigin(request.url));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}

/** Stable, non-sensitive reason code for the UI. Never echoes provider messages. */
export function errorReason(error: unknown): string {
  if (error instanceof OAuthStateError) return "invalid_state";
  if (error instanceof MissingConfigError) return "not_configured";
  if (error instanceof IntegrationError) return error.code;
  if (isAccessError(error)) return error.code;
  if (error instanceof ZodError) return "invalid_input";
  return "unexpected";
}

/** Redirects back to the connections screen (or sign-in) with an error reason. */
export function failureRedirect(request: Request, provider: string, error: unknown) {
  // Let Next's own control flow through (prerender bailout, redirect, notFound).
  unstable_rethrow(error);
  if (error instanceof UnauthenticatedError) {
    return redirectTo(request, AUTH_PATHS.signIn, { next: CONNECTIONS_PATH });
  }
  const reason = errorReason(error);
  if (reason === "unexpected") console.error(`[${provider}] connect failed`, error);
  // Our own messages (never TikTok's raw text), so they are safe to log.
  else if (reason === "not_configured" || reason === "permission_denied") {
    console.warn(`[${provider}] connect refused: ${(error as Error).message}`);
  }
  return redirectTo(request, CONNECTIONS_PATH, { [provider]: "error", reason });
}
