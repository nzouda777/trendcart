import "server-only";

import type { ActionResult } from "@/components/app/action-result";
import { getWorkspaceContext } from "@/lib/auth/session";
import { toServiceFailure } from "@/lib/services";
import type { UserWorkspaceContext } from "@/lib/tenant/context";

/**
 * Runs a service call for a server action: resolves the session workspace,
 * maps known errors to a ServiceFailure (unknown errors are rethrown so
 * Sentry sees them). Call redirect()/refresh() outside of `fn`.
 */
export async function runAction<T>(
  fn: (ctx: UserWorkspaceContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await getWorkspaceContext();
    return { ok: true, data: await fn(ctx) };
  } catch (error) {
    const failure = toServiceFailure(error);
    if (failure.code === "integration") {
      // Shown to the user as a result, so log it: otherwise it never reaches the runtime logs.
      const cause = error instanceof Error ? error.cause : undefined;
      console.error("[action] integration failure:", failure.error, cause ?? "");
    }
    return failure;
  }
}
