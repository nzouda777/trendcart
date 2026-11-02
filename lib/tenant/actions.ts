"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { isAccessError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceContext } from "@/lib/auth/session";
import { brand } from "@/lib/db/schema";

import { ACTIVE_BRAND_COOKIE, encodeActiveBrand } from "./active-brand";

export type ActionResult = { ok: true } | { ok: false; error: string };

const brandIdSchema = z.string().min(1).max(200);

/** Brand switcher: remembers the brand for this browser after checking it is in the workspace. */
export async function setActiveBrandAction(brandId: string): Promise<ActionResult> {
  try {
    const id = brandIdSchema.parse(brandId);
    const ctx = await getWorkspaceContext();
    requirePermission(ctx, "brand:read");
    await ctx.db.getById(brand, id);

    (await cookies()).set(ACTIVE_BRAND_COOKIE, encodeActiveBrand(ctx.workspaceId, id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true };
  } catch (error) {
    if (isAccessError(error)) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Invalid brand." };
    throw error;
  }
}
