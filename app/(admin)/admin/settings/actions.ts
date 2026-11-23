"use server";

import { refresh, updateTag } from "next/cache";

import type { ActionResult } from "@/components/app/action-result";
import { updateBillingSettings } from "@/lib/platform/plans";

import { PRICING_TAG } from "@/lib/platform/public-pricing";

import { runAdminAction } from "../_lib/action";

export async function updateMultiplierAction(
  value: string,
): Promise<ActionResult<{ resynced: number }>> {
  const n = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 1 || n > 24) {
    return { ok: false, code: "invalid_input", error: "Enter a number between 1 and 24." };
  }
  const result = await runAdminAction((admin) =>
    updateBillingSettings(admin, { yearlyMultiplier: n }),
  );
  if (result.ok) {
    updateTag(PRICING_TAG);
    refresh();
  }
  return result;
}
