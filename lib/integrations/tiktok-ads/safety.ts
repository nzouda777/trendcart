import { IntegrationError } from "@/lib/domain/contracts";

/** Environment as read by the TikTok adapters (process.env or a test fixture). */
export type Env = Record<string, string | undefined>;

/*
 * Safety rails shared by the TikTok adapters (Ads and Posting).
 *
 * - NotImplementedIntegrationError marks live methods not built yet.
 * - assertNotUnderTest blocks anything that could spend budget or publish
 *   when running under vitest/NODE_ENV=test, even in live mode with
 *   real-looking credentials. The test check reads BOTH the injected env and
 *   the real process.env, so a test fixture env cannot switch it off.
 * - The only way through under test is an explicit opt-in on a client built
 *   with an injected, non-global fetch stub (see SideEffectGuard): such a
 *   client has no route to the network, so the request is a recording.
 *   Public posting stays impossible under test regardless (see
 *   tiktok-posting/config.ts isPostingAudited).
 * - Mocks never call it: they cannot reach TikTok in the first place.
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

function envSaysTest(env: Env): boolean {
  return env.NODE_ENV === "test" || env.VITEST === "true" || env.VITEST === "1";
}

export function isTestEnvironment(env: Env = process.env): boolean {
  return envSaysTest(env) || envSaysTest(process.env);
}

/**
 * A required app credential (env var) is missing on this server. Kept as
 * permission_denied for retry logic, but marked so OAuth routes can tell the
 * user it is a setup problem, not a refusal by TikTok.
 */
export class MissingConfigError extends IntegrationError {
  readonly missingConfig = true;

  constructor(
    provider: string,
    readonly variables: readonly string[],
  ) {
    super(provider, "permission_denied", `${variables.join(" and ")} must be set.`, {
      retryable: false,
    });
    this.name = "MissingConfigError";
  }
}

export class UnsafeActionError extends IntegrationError {
  constructor(provider: string, action: string) {
    super(provider, "permission_denied", `${action} is blocked in the test environment.`, {
      retryable: false,
    });
    this.name = "UnsafeActionError";
  }
}

/**
 * How a live client may run side-effecting calls under test: only when the
 * test injected its own fetch (never the global one) AND opted in by name.
 */
export type SideEffectGuard = {
  injectedFetch?: typeof fetch;
  /** Test-only opt-in. Ignored unless `injectedFetch` is a non-global stub. */
  allowStubbedSideEffectsUnderTest?: boolean;
};

/** Call first in every live method that can spend money or make content visible. */
export function assertNotUnderTest(
  provider: string,
  action: string,
  env: Env = process.env,
  guard: SideEffectGuard = {},
) {
  if (!isTestEnvironment(env)) return;
  const stubbed =
    guard.allowStubbedSideEffectsUnderTest === true &&
    typeof guard.injectedFetch === "function" &&
    guard.injectedFetch !== globalThis.fetch;
  if (!stubbed) throw new UnsafeActionError(provider, action);
}

/** Deterministic, cancellable-free sleep; tests inject a no-op. */
export const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
