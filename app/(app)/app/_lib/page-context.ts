import "server-only";

import { cache } from "react";

import { requireWorkspacePage } from "@/lib/auth/session";
import { listBrands } from "@/lib/services";
import type { BrandDTO } from "@/lib/services/types";
import { getActiveBrand } from "@/lib/tenant/active-brand";

/**
 * Pages: workspace context + brands (from lib/services) + the brand picked
 * in the shell's switcher. Deduplicated per request.
 */
export const getPageContext = cache(async () => {
  const ctx = await requireWorkspacePage();
  const brands = await listBrands(ctx);
  const summary = await getActiveBrand(ctx, brands);
  const activeBrand: BrandDTO | null = summary
    ? (brands.find((b) => b.id === summary.id) ?? null)
    : null;
  return { ctx, role: ctx.actor.role, brands, activeBrand };
});
