"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import type { PlanInput } from "@/lib/domain/billing";
import { createPlan, deletePlan, syncPlanToStripe, updatePlan } from "@/lib/platform/plans";

import { PRICING_TAG } from "@/lib/platform/public-pricing";

import { runAdminAction } from "../_lib/action";

/** The landing page shows published plans: refresh it on every change. */
function refreshPricing() {
  updateTag(PRICING_TAG);
}

export async function createPlanAction(input: PlanInput): Promise<ActionResult<{ id: string }>> {
  const result = await runAdminAction(async (admin) => ({
    id: (await createPlan(admin, input)).id,
  }));
  if (!result.ok) return result;
  refreshPricing();
  redirect(`/admin/plans/${result.data.id}?saved=1`);
}

export async function updatePlanAction(
  planId: string,
  input: PlanInput,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAdminAction(async (admin) => ({
    id: (await updatePlan(admin, planId, input)).id,
  }));
  if (result.ok) {
    refreshPricing();
    refresh();
  }
  return result;
}

export async function syncPlanAction(planId: string): Promise<ActionResult> {
  const result = await runAdminAction(async (admin) => {
    await syncPlanToStripe(admin, planId);
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

export async function deletePlanAction(planId: string): Promise<ActionResult> {
  const result = await runAdminAction(async (admin) => {
    await deletePlan(admin, planId);
    return undefined;
  });
  if (!result.ok) return result;
  refreshPricing();
  redirect("/admin/plans");
}
