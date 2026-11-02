import { ZodError } from "zod";

import { isAccessError } from "@/lib/auth/errors";
import { OAuthStateError } from "@/lib/auth/oauth-state";
import { IntegrationError } from "@/lib/domain/contracts";

/** Helpers shared by app/api/shopify/* route handlers. */

/** Page that shows the result of a connection flow (built by app-ui). */
export const CONNECTIONS_PATH = "/app/connections";

export const SHOPIFY_CALLBACK_PATH = "/api/shopify/callback";

/** Public origin: NEXT_PUBLIC_SITE_URL when set (must match the app's redirect URL), else the request's. */
export function publicOrigin(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(requestUrl).origin;
}

export function callbackUrl(requestUrl: string): string {
  return `${publicOrigin(requestUrl)}${SHOPIFY_CALLBACK_PATH}`;
}

/** Short, non-sensitive error code for redirects and JSON responses. */
export function errorCode(error: unknown): { code: string; status: number; message: string } {
  if (isAccessError(error))
    return { code: error.code, status: error.status, message: error.message };
  if (error instanceof OAuthStateError)
    return { code: "invalid_state", status: 400, message: error.message };
  if (error instanceof IntegrationError) {
    const status =
      error.code === "invalid_input" ? 400 : error.code === "permission_denied" ? 403 : 502;
    return { code: error.code, status, message: error.message };
  }
  if (error instanceof ZodError)
    return { code: "invalid_input", status: 400, message: "Invalid request." };
  return { code: "unexpected", status: 500, message: "Something went wrong." };
}

export function connectionsRedirect(requestUrl: string, params: Record<string, string>): URL {
  const url = new URL(CONNECTIONS_PATH, publicOrigin(requestUrl));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}
