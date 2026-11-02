"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import { createBrand, deleteBrand, updateBrand } from "@/lib/services";
import type { BrandPatchInput, BrandSettingsInput } from "@/lib/services";
import { setActiveBrandAction } from "@/lib/tenant/actions";

import { runAction } from "../_lib/action";

const AFTER_CREATE = {
  onboarding: "/app/connections?welcome=1",
  brands: "/app/brands",
} as const;

/** Creates a brand, makes it the active brand, then redirects. */
export async function createBrandAction(
  next: keyof typeof AFTER_CREATE,
  input: BrandSettingsInput,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async (ctx) => {
    const brand = await createBrand(ctx, input);
    return { id: brand.id };
  });
  if (!result.ok) return result;
  await setActiveBrandAction(result.data.id);
  redirect(AFTER_CREATE[next] ?? AFTER_CREATE.brands);
}

export async function updateBrandAction(
  brandId: string,
  patch: BrandPatchInput,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async (ctx) => {
    const brand = await updateBrand(ctx, brandId, patch);
    return { id: brand.id };
  });
  if (result.ok) refresh();
  return result;
}

export async function deleteBrandAction(brandId: string): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await deleteBrand(ctx, brandId);
    return undefined;
  });
  if (!result.ok) return result;
  redirect("/app/brands");
}
