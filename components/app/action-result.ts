import type { ServiceFailure } from "@/lib/services/errors";

/**
 * What every app server action returns. Failures come from
 * `toServiceFailure(error)` (lib/services/errors) and are safe to show.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | ServiceFailure;

export function failureMessage(result: ServiceFailure): string {
  return result.error;
}

/** First field error for `name`, if any. */
export function fieldError(result: ActionResult<unknown> | null, name: string): string | undefined {
  if (!result || result.ok) return undefined;
  return result.fieldErrors?.[name]?.[0];
}
