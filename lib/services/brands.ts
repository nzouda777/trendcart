import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import { decrypt, encrypt } from "@/lib/crypto";
import { countrySchema, currencySchema, languageSchema } from "@/lib/domain/contracts";
import { brand, campaign, product, proxy, shopifyProduct } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";
import { proxyUrlAad } from "@/lib/workflows/call-context";

import { ServiceError } from "./errors";
import { isPublicHost } from "./net";
import type { BrandDTO, BrandProxyDTO } from "./types";

/* Schemas ------------------------------------------------------------------ */

export const idSchema = z.string().min(1).max(200);

export const pricingRuleSchema = z.object({
  multiplier: z.number().min(1).max(20),
  roundTo: z.number().min(0).max(0.99).optional(),
  compareAtMultiplier: z.number().min(1).max(5).optional(),
});

export const brandSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  country: countrySchema,
  language: languageSchema,
  currency: currencySchema.default("USD"),
  defaultTestBudget: z.number().positive().max(1_000_000).nullable().optional(),
  /** Margin rate 0..1 (e.g. 0.3 = 30 %). */
  minMargin: z.number().min(0).max(1).nullable().optional(),
  pricingRule: pricingRuleSchema.nullable().optional(),
});
export type BrandSettingsInput = z.input<typeof brandSettingsSchema>;

// Built without defaults: a `.partial()` of the create schema would still
// inject `currency: "USD"` into every patch.
export const brandPatchSchema = brandSettingsSchema
  .extend({ currency: currencySchema })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type BrandPatchInput = z.input<typeof brandPatchSchema>;

/**
 * Exactly the schemes the proxy dispatcher supports
 * (lib/integrations/tiktok-data/http.ts proxyKind): http, https, socks5.
 */
export const PROXY_PROTOCOLS = ["http:", "https:", "socks5:"] as const;

function parseProxyUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const proxyUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .superRefine((value, issue) => {
    const url = parseProxyUrl(value);
    if (!url || !url.hostname) {
      issue.addIssue({
        code: "custom",
        message: "Expected a proxy URL like http://user:pass@host:port.",
      });
      return;
    }
    if (!(PROXY_PROTOCOLS as readonly string[]).includes(url.protocol)) {
      issue.addIssue({ code: "custom", message: "Use an http, https or socks5 proxy." });
      return;
    }
    if (!isPublicHost(url.hostname)) {
      issue.addIssue({
        code: "custom",
        message: "The proxy host must be public (no localhost, private or link-local addresses).",
      });
    }
  });

/* Mapping ------------------------------------------------------------------ */

function proxyDisplay(url: URL) {
  return `${url.protocol}//${url.host}`;
}

function toProxyDTO(row: Row<typeof proxy> | undefined, display: string | null): BrandProxyDTO {
  if (!row) return { configured: false, enabled: false, display: null, updatedAt: null };
  return {
    configured: true,
    enabled: row.enabled,
    display,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toBrandDTO(row: Row<typeof brand>, proxyRow?: Row<typeof proxy>): BrandDTO {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    language: row.language,
    currency: row.currency,
    defaultTestBudget: row.defaultTestBudget,
    minMargin: row.minMargin,
    pricingRule: row.pricingRule,
    proxy: toProxyDTO(proxyRow, proxyRow ? proxyDisplayFromRow(proxyRow) : null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Scheme and host from the encrypted URL (credentials never leave this function). */
function proxyDisplayFromRow(row: Row<typeof proxy>): string | null {
  try {
    return proxyDisplay(new URL(decrypt(row.urlEnc, { aad: proxyUrlAad(row.id) })));
  } catch {
    return null;
  }
}

/* Reads -------------------------------------------------------------------- */

export async function listBrands(ctx: WorkspaceContext): Promise<BrandDTO[]> {
  requirePermission(ctx, "brand:read");
  const [rows, proxies] = await Promise.all([
    ctx.db.select(brand, { orderBy: (t) => [t.name, t.createdAt] }),
    ctx.db.select(proxy),
  ]);
  const byBrand = new Map(proxies.map((p) => [p.brandId, p]));
  return rows.map((r) => toBrandDTO(r, byBrand.get(r.id)));
}

export async function getBrand(ctx: WorkspaceContext, brandId: string): Promise<BrandDTO> {
  requirePermission(ctx, "brand:read");
  const id = idSchema.parse(brandId);
  const row = await ctx.db.getById(brand, id);
  const proxyRow = await ctx.db.findFirst(proxy, eq(proxy.brandId, id));
  return toBrandDTO(row, proxyRow);
}

/* Writes ------------------------------------------------------------------- */

export async function createBrand(
  ctx: WorkspaceContext,
  input: BrandSettingsInput,
): Promise<BrandDTO> {
  requirePermission(ctx, "brand:create");
  const values = brandSettingsSchema.parse(input);
  const row = await ctx.db.transaction(async (tx) => {
    const created = await tx.insert(brand, {
      name: values.name,
      country: values.country,
      language: values.language,
      currency: values.currency,
      defaultTestBudget: values.defaultTestBudget ?? null,
      minMargin: values.minMargin ?? null,
      pricingRule: values.pricingRule ?? null,
    });
    await writeAudit(
      { ...ctx, db: tx },
      { action: "brand.create", targetType: "brand", targetId: created.id, metadata: values },
    );
    return created;
  });
  return toBrandDTO(row);
}

export async function updateBrand(
  ctx: WorkspaceContext,
  brandId: string,
  patch: BrandPatchInput,
): Promise<BrandDTO> {
  requirePermission(ctx, "brand:update");
  const id = idSchema.parse(brandId);
  const values = brandPatchSchema.parse(patch);
  const before = await ctx.db.getById(brand, id);

  const row = await ctx.db.transaction(async (tx) => {
    const [updated] = await tx.update(brand, values, eq(brand.id, id));
    const changed = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        { from: before[k as keyof typeof before] ?? null, to: v ?? null },
      ]),
    );
    await writeAudit(
      { ...ctx, db: tx },
      { action: "brand.update", targetType: "brand", targetId: id, metadata: { changed } },
    );
    if ("defaultTestBudget" in values && values.defaultTestBudget !== before.defaultTestBudget) {
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "campaign.budget_change",
          targetType: "brand",
          targetId: id,
          metadata: {
            field: "default_test_budget",
            from: before.defaultTestBudget,
            to: values.defaultTestBudget ?? null,
          },
        },
      );
    }
    return updated;
  });
  const proxyRow = await ctx.db.findFirst(proxy, eq(proxy.brandId, id));
  return toBrandDTO(row, proxyRow);
}

/**
 * Deletes a brand and, by cascade, its connections, proxy and products.
 * Refused while any product has a Shopify page or a campaign, so nothing that
 * exists outside Trendcart is orphaned silently.
 */
export async function deleteBrand(ctx: WorkspaceContext, brandId: string): Promise<void> {
  requirePermission(ctx, "brand:delete");
  const id = idSchema.parse(brandId);
  const row = await ctx.db.getById(brand, id);

  const productIds = (await ctx.db.select(product, { where: eq(product.brandId, id) })).map(
    (p) => p.id,
  );
  if (productIds.length > 0) {
    const [pages, campaigns] = await Promise.all([
      ctx.db.count(shopifyProduct, inArray(shopifyProduct.productId, productIds)),
      ctx.db.count(campaign, inArray(campaign.productId, productIds)),
    ]);
    if (pages > 0 || campaigns > 0) {
      throw new ServiceError(
        "precondition_failed",
        "This brand has Shopify pages or campaigns. Archive them before deleting the brand.",
      );
    }
  }

  await ctx.db.transaction(async (tx) => {
    await tx.delete(brand, eq(brand.id, id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "brand.delete",
        targetType: "brand",
        targetId: id,
        metadata: { name: row.name, products: productIds.length },
      },
    );
  });
}

/* Proxy -------------------------------------------------------------------- */

/** Sets (or replaces) the brand proxy. The URL is encrypted; only the host is ever shown. */
export async function setBrandProxy(
  ctx: WorkspaceContext,
  brandId: string,
  input: { url: string; enabled?: boolean },
): Promise<BrandProxyDTO> {
  requirePermission(ctx, "connection:update");
  const id = idSchema.parse(brandId);
  const { url, enabled } = z
    .object({ url: proxyUrlSchema, enabled: z.boolean().default(true) })
    .parse(input);
  await ctx.db.getById(brand, id);
  const parsed = new URL(url);

  const row = await ctx.db.transaction(async (tx) => {
    const existing = await tx.findFirst(proxy, eq(proxy.brandId, id));
    const proxyId = existing?.id ?? crypto.randomUUID();
    const urlEnc = encrypt(url, { aad: proxyUrlAad(proxyId) });
    const saved = existing
      ? (await tx.update(proxy, { urlEnc, enabled }, eq(proxy.id, proxyId)))[0]
      : await tx.insert(proxy, { id: proxyId, brandId: id, urlEnc, enabled });
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "proxy.update",
        targetType: "brand",
        targetId: id,
        metadata: { change: existing ? "replace" : "set", host: proxyDisplay(parsed), enabled },
      },
    );
    return saved;
  });
  return toProxyDTO(row, proxyDisplay(parsed));
}

export async function toggleBrandProxy(
  ctx: WorkspaceContext,
  brandId: string,
  enabled: boolean,
): Promise<BrandProxyDTO> {
  requirePermission(ctx, "connection:update");
  const id = idSchema.parse(brandId);
  const on = z.boolean().parse(enabled);
  const existing = await ctx.db.findFirst(proxy, eq(proxy.brandId, id));
  if (!existing) throw new ServiceError("precondition_failed", "This brand has no proxy yet.");

  const row = await ctx.db.transaction(async (tx) => {
    const [saved] = await tx.update(
      proxy,
      { enabled: on },
      and(eq(proxy.id, existing.id), eq(proxy.brandId, id)),
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "proxy.update",
        targetType: "brand",
        targetId: id,
        metadata: { change: on ? "enable" : "disable" },
      },
    );
    return saved;
  });
  return toProxyDTO(row, proxyDisplayFromRow(row));
}

export async function clearBrandProxy(ctx: WorkspaceContext, brandId: string): Promise<void> {
  requirePermission(ctx, "connection:update");
  const id = idSchema.parse(brandId);
  await ctx.db.getById(brand, id);
  await ctx.db.transaction(async (tx) => {
    const removed = await tx.delete(proxy, eq(proxy.brandId, id));
    if (removed.length > 0) {
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "proxy.update",
          targetType: "brand",
          targetId: id,
          metadata: { change: "clear" },
        },
      );
    }
  });
}
