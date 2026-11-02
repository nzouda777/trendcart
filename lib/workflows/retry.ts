/**
 * Retry policy shared by the inline runner (M1) and the durable workflow.
 *
 * Under Vercel Workflow the engine owns retries: a step throws
 * `RetryableError({ retryAfter: backoffDelay(attempt) })` for retryable
 * errors and `FatalError` otherwise, with `step.maxRetries = MAX_ATTEMPTS - 1`.
 * The inline runner applies the same policy in-process with short delays.
 */
import { IntegrationError } from "@/lib/domain/contracts";

export const MAX_ATTEMPTS = 3;
export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 4_000;

/** Thrown when the per-workspace concurrency limit is reached. Always retryable. */
export class ConcurrencyLimitError extends Error {
  readonly retryable = true;

  constructor(message = "Too many steps are running in this workspace right now.") {
    super(message);
    this.name = "ConcurrencyLimitError";
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof IntegrationError) return error.retryable;
  if (error instanceof ConcurrencyLimitError) return true;
  return false;
}

/** Exponential backoff with full jitter: random in [0, min(max, base·2^(attempt-1))]. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(cap * random());
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn(attempt)` up to `maxAttempts` times, waiting `backoffDelay` between
 * retryable failures. Non-retryable errors and the last failure are rethrown.
 */
export async function withBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: { maxAttempts?: number; sleep?: Sleep; random?: () => number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      await sleep(backoffDelay(attempt, options.random));
    }
  }
}

/** Safe, short message for job.error (never a stack trace or a secret). */
export function describeError(error: unknown): string {
  if (error instanceof IntegrationError)
    return `${error.provider} (${error.code}): ${error.message}`;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}
