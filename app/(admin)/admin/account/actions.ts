"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";

import type { ActionResult } from "@/components/app/action-result";
import { getAuth } from "@/lib/auth/session";
import { writePlatformAudit } from "@/lib/platform/audit";
import { requireAdmin } from "@/lib/platform/guard";

const MIN = 12;

/** The admin changes their own password (current one required); audited. */
export async function changeAdminPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (input.newPassword.length < MIN) {
    return { ok: false, code: "invalid_input", error: `Use at least ${MIN} characters.` };
  }
  try {
    await getAuth().api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
    });
  } catch (error) {
    const message =
      error instanceof APIError ? error.message : "The password could not be changed.";
    return { ok: false, code: "invalid_input", error: message };
  }
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "admin.password_change",
    targetType: "user",
    targetId: admin.adminUserId,
  });
  return { ok: true, data: undefined };
}
