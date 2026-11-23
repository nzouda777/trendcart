"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import type { AdminContext } from "@/lib/platform/guard";
import {
  banUser,
  deleteUser,
  disableTwoFactor,
  impersonate,
  revokeSessions,
  setPlatformAdmin,
  setUserPassword,
  unbanUser,
  verifyEmail,
} from "@/lib/platform/users";

import { runAdminAction } from "../_lib/action";

async function run(fn: (admin: AdminContext) => Promise<void>): Promise<ActionResult> {
  const result = await runAdminAction(async (admin) => {
    await fn(admin);
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

export async function banAction(userId: string, reason: string): Promise<ActionResult> {
  return run((a) => banUser(a, userId, { reason: reason || undefined }));
}
export async function unbanAction(userId: string): Promise<ActionResult> {
  return run((a) => unbanUser(a, userId));
}
export async function revokeAction(userId: string): Promise<ActionResult> {
  return run((a) => revokeSessions(a, userId));
}
export async function passwordAction(userId: string, password: string): Promise<ActionResult> {
  return run((a) => setUserPassword(a, userId, password));
}
export async function verifyAction(userId: string): Promise<ActionResult> {
  return run((a) => verifyEmail(a, userId));
}
export async function disable2faAction(userId: string): Promise<ActionResult> {
  return run((a) => disableTwoFactor(a, userId));
}
export async function setAdminAction(userId: string, isAdmin: boolean): Promise<ActionResult> {
  return run((a) => setPlatformAdmin(a, userId, isAdmin));
}
export async function deleteUserAction(userId: string): Promise<ActionResult> {
  return run((a) => deleteUser(a, userId));
}
export async function impersonateAction(userId: string): Promise<ActionResult> {
  const result = await runAdminAction(async (a) => {
    await impersonate(a, userId);
    return undefined;
  });
  if (!result.ok) return result;
  redirect("/app");
}
