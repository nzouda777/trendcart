"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import type { AdminContext } from "@/lib/platform/guard";
import {
  cancelStripeSubscription,
  deleteWorkspace,
  endAccess,
  extendTrial,
  grantPlan,
  setWorkspaceAiCap,
  suspendWorkspace,
  unsuspendWorkspace,
} from "@/lib/platform/workspaces";

import { runAdminAction } from "../_lib/action";

async function run(fn: (admin: AdminContext) => Promise<void>): Promise<ActionResult> {
  const result = await runAdminAction(async (admin) => {
    await fn(admin);
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

function positiveInt(value: string, label: string): number {
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label}: enter a whole number above zero.`);
  return n;
}

export async function suspendAction(workspaceId: string, reason: string): Promise<ActionResult> {
  return run(async (a) => suspendWorkspace(a, workspaceId, reason));
}

export async function unsuspendAction(workspaceId: string): Promise<ActionResult> {
  return run(async (a) => unsuspendWorkspace(a, workspaceId));
}

export async function aiCapAction(workspaceId: string, value: string): Promise<ActionResult> {
  const t = value.trim().replace(",", ".");
  const cap = t === "" ? null : Number(t);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    return { ok: false, code: "invalid_input", error: "Enter an amount in USD, or leave empty." };
  }
  return run(async (a) => setWorkspaceAiCap(a, workspaceId, cap));
}

export async function grantPlanAction(
  workspaceId: string,
  input: { planId: string; days: string; note?: string },
): Promise<ActionResult> {
  const days = input.days.trim() === "" ? null : Number(input.days);
  if (days !== null && (!Number.isInteger(days) || days < 1)) {
    return {
      ok: false,
      code: "invalid_input",
      error: "Days: a whole number, or empty for no end.",
    };
  }
  return run(async (a) =>
    grantPlan(a, workspaceId, { planId: input.planId, days, note: input.note }),
  );
}

export async function extendTrialAction(workspaceId: string, days: string): Promise<ActionResult> {
  let n: number;
  try {
    n = positiveInt(days, "Days");
  } catch (e) {
    return { ok: false, code: "invalid_input", error: (e as Error).message };
  }
  return run(async (a) => extendTrial(a, workspaceId, n));
}

export async function endAccessAction(workspaceId: string): Promise<ActionResult> {
  return run(async (a) => endAccess(a, workspaceId));
}

export async function cancelSubscriptionAction(
  workspaceId: string,
  when: "now" | "period_end",
): Promise<ActionResult> {
  return run(async (a) => cancelStripeSubscription(a, workspaceId, when));
}

export async function deleteWorkspaceAction(
  workspaceId: string,
  confirmName: string,
): Promise<ActionResult> {
  const result = await runAdminAction(async (a) => {
    await deleteWorkspace(a, workspaceId, confirmName);
    return undefined;
  });
  if (!result.ok) return result;
  redirect("/admin/workspaces");
}
