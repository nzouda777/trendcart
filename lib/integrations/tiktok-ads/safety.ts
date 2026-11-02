import { IntegrationError } from "@/lib/domain/contracts";

/** Environment as read by the TikTok adapters (process.env or a test fixture). */
export type Env = Record<string, string | undefined>;

/*
 * Safety rails shared by the TikTok adapters (Ads and Posting).
 *
 * - NotImplementedIntegrationError marks live methods scheduled for M3.
 * - assertNotUnderTest blocks anything that could spend budget or publish
 *   publicly when running under vitest/NODE_ENV=test, even in live mode
 *   with real-looking credentials. Mocks never call it: they cannot reach
 *   TikTok in the first place.
 */

export class NotImplementedIntegrationError extends IntegrationError {
  readonly notImplemented = true;

  constructor(provider: string, method: string, milestone = "M3") {
    super(
      provider,
      "provider_error",
      `${provider}.${method} is not implemented yet (${milestone}).`,
      {
        retryable: false,
      },
    );
    this.name = "NotImplementedIntegrationError";
  }
}

export function isTestEnvironment(env: Env = process.env): boolean {
  return env.NODE_ENV === "test" || env.VITEST === "true" || env.VITEST === "1";
}

export class UnsafeActionError extends IntegrationError {
  constructor(provider: string, action: string) {
    super(provider, "permission_denied", `${action} is blocked in the test environment.`, {
      retryable: false,
    });
    this.name = "UnsafeActionError";
  }
}

/** Call first in every live method that can spend money or make content public. */
export function assertNotUnderTest(provider: string, action: string, env: Env = process.env) {
  if (isTestEnvironment(env)) throw new UnsafeActionError(provider, action);
}
