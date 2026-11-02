/**
 * Errors thrown by session helpers, guards and the scoped data layer.
 * Services let them bubble; server actions / route handlers map `status`.
 */

export type AccessErrorCode = "unauthenticated" | "no_workspace" | "forbidden" | "not_found";

export class AccessError extends Error {
  readonly code: AccessErrorCode;
  readonly status: 401 | 403 | 404;

  constructor(code: AccessErrorCode, message: string) {
    super(message);
    this.name = "AccessError";
    this.code = code;
    this.status = code === "unauthenticated" ? 401 : code === "not_found" ? 404 : 403;
  }
}

export class UnauthenticatedError extends AccessError {
  constructor(message = "Sign in required.") {
    super("unauthenticated", message);
    this.name = "UnauthenticatedError";
  }
}

/** Signed in, but no active workspace on the session (or not a member of it). */
export class NoWorkspaceError extends AccessError {
  constructor(message = "No active workspace.") {
    super("no_workspace", message);
    this.name = "NoWorkspaceError";
  }
}

export class ForbiddenError extends AccessError {
  constructor(message = "You do not have permission to do this.") {
    super("forbidden", message);
    this.name = "ForbiddenError";
  }
}

/** Also used when a row exists but belongs to another workspace. */
export class NotFoundError extends AccessError {
  constructor(message = "Not found.") {
    super("not_found", message);
    this.name = "NotFoundError";
  }
}

export function isAccessError(error: unknown): error is AccessError {
  return error instanceof AccessError;
}
