import "server-only";

import { cookies } from "next/headers";

import { brand } from "@/lib/db/schema";

import type { WorkspaceContext } from "./context";
import type { Row } from "./scoped-db";

/*
 * The brand picked in the shell's brand switcher, remembered per browser in
 * a cookie and always re-validated against the scoped db (a stale or forged
 * cookie can never select another workspace's brand).
 */

export const ACTIVE_BRAND_COOKIE = "tc_active_brand";

export type BrandSummary = Pick<Row<typeof brand>, "id" | "name" | "country" | "currency">;

export async function listBrands(ctx: WorkspaceContext): Promise<BrandSummary[]> {
  const rows = await ctx.db.select(brand, { orderBy: (t) => [t.name, t.createdAt] });
  return rows.map(({ id, name, country, currency }) => ({ id, name, country, currency }));
}

/** Cookie value: `<workspaceId>:<brandId>`, so switching workspace resets it. */
export function encodeActiveBrand(workspaceId: string, brandId: string) {
  return `${workspaceId}:${brandId}`;
}

/** The active brand, or the first brand, or null when the workspace has none. */
export async function getActiveBrand(
  ctx: WorkspaceContext,
  brands?: BrandSummary[],
): Promise<BrandSummary | null> {
  const list = brands ?? (await listBrands(ctx));
  const raw = (await cookies()).get(ACTIVE_BRAND_COOKIE)?.value;
  const [workspaceId, brandId] = raw?.split(":") ?? [];
  const picked = workspaceId === ctx.workspaceId ? list.find((b) => b.id === brandId) : undefined;
  return picked ?? list[0] ?? null;
}
