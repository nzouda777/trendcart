/** Auth-related routes. Safe for client and proxy imports. */
/** Request header the proxy sets with the path (the app layout reads it for the billing wall). */
export const PATH_HEADER = "x-trendcart-path";

/** App pages a workspace without access can still open (billing, account security). */
export const OPEN_WITHOUT_PLAN = ["/app/billing", "/app/account/security", "/app/guide"] as const;

export const AUTH_PATHS = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  twoFactor: "/sign-in/two-factor",
  createWorkspace: "/sign-up/workspace",
  invite: (id: string) => `/sign-up/invite/${id}`,
  /** Where signed-in users land. */
  home: "/app",
  security: "/app/account/security",
  billing: "/app/billing",
  /** In-app user guide, opened in a new tab. */
  guide: "/app/guide",
} as const;

/** Path prefix of the authenticated product app. */
export const APP_PREFIX = "/app";

const PROBE_ORIGIN = "https://same-origin.invalid";

/**
 * Only same-origin relative paths are allowed as post-auth redirects
 * (prevents open redirects through ?next=). Control characters and
 * backslashes are refused outright, because browsers strip `\t\n\r` and read
 * `\` as `/`, which turns "/\t/evil.example" into "//evil.example". The
 * remaining value is resolved against a probe origin and must stay on it;
 * the normalised path + query + hash is returned.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = AUTH_PATHS.home,
): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
