import "server-only";

import type { ActionResult } from "@/components/app/action-result";
import { requireAdmin, type AdminContext } from "@/lib/platform/guard";
import { toServiceFailure } from "@/lib/services";

/**
 * Runs an admin service call for a server action: checks the platform admin,
 * maps known errors to a failure shown in the UI (and logged), rethrows the rest.
 */
export async function runAdminAction<T>(
  fn: (admin: AdminContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const admin = await requireAdmin();
    return { ok: true, data: await fn(admin) };
  } catch (error) {
    const failure = toServiceFailure(error);
    console.error("[admin] action failed:", failure.error);
    return failure;
  }
}
