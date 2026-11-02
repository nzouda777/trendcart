/**
 * Business errors thrown by services and workflow steps (pure: no server
 * imports, safe to import anywhere).
 *
 * Access problems use lib/auth/errors (401/403/404); invalid input surfaces as
 * a ZodError; an illegal state change is an InvalidTransitionError
 * (lib/domain/state-machine). `toServiceFailure` maps all of them to a
 * message a server action can return to the UI.
 */
import { z } from "zod";

import { isAccessError } from "@/lib/auth/errors";
import { IntegrationError } from "@/lib/domain/contracts";
import { InvalidTransitionError } from "@/lib/domain/state-machine";

export type ServiceErrorCode =
  /** Someone else changed the row first (optimistic check failed). */
  | "conflict"
  /** The action does not apply to the current state (e.g. gate already passed). */
  | "invalid_state"
  /** Something must be done first (e.g. connect a store, remove campaigns). */
  | "precondition_failed"
  /** Input passed the schema but was refused by a business rule (e.g. internal link). */
  | "invalid_input"
  /** A per-workspace rate limit was hit. */
  | "rate_limited";

/**
 * Machine-readable detail of a ServiceError, stable across message wording,
 * for callers (UI, MCP) that react to one specific refusal.
 */
export type ServiceErrorReason =
  /** approvePage: the stored page copy no longer has the version the reviewer loaded. */
  "copy_changed";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: 409 | 422 | 429;
  readonly reason?: ServiceErrorReason;

  constructor(
    code: ServiceErrorCode,
    message: string,
    options: { reason?: ServiceErrorReason } = {},
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = code === "conflict" ? 409 : code === "rate_limited" ? 429 : 422;
    if (options.reason) this.reason = options.reason;
  }
}

export type ServiceFailure = {
  ok: false;
  code:
    | ServiceErrorCode
    | "unauthenticated"
    | "no_workspace"
    | "forbidden"
    | "not_found"
    | "invalid_input"
    | "integration";
  error: string;
  /** Set only for a ServiceError that carries one (see ServiceErrorReason). */
  reason?: ServiceErrorReason;
  /** Field errors for forms (zod), keyed by dotted path. */
  fieldErrors?: Record<string, string[]>;
};

/**
 * For server actions: turns a known error into a serialisable failure,
 * rethrows anything unexpected (so Sentry sees it).
 */
export function toServiceFailure(error: unknown): ServiceFailure {
  if (isAccessError(error)) return { ok: false, code: error.code, error: error.message };
  if (error instanceof ServiceError) {
    return {
      ok: false,
      code: error.code,
      error: error.message,
      ...(error.reason ? { reason: error.reason } : {}),
    };
  }
  if (error instanceof InvalidTransitionError) {
    return { ok: false, code: "invalid_state", error: error.message };
  }
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: "invalid_input",
      error: "Please check the highlighted fields.",
      fieldErrors,
    };
  }
  if (error instanceof IntegrationError) {
    return { ok: false, code: "integration", error: `${error.provider}: ${error.message}` };
  }
  throw error;
}
