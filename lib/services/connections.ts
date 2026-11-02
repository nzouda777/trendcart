import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import { aadFor, encrypt } from "@/lib/crypto";
import {
  tiktokAdvertiserSchema,
  tiktokProfileTokenSchema,
  type TikTokAdvertiser,
  type TikTokProfileToken,
} from "@/lib/domain/contracts";
import {
  brand,
  shopifyConnection,
  tiktokAdConnection,
  tiktokProfileConnection,
} from "@/lib/db/schema";
import { hasTrendcartTemplate } from "@/lib/integrations/shopify/template-kit";
import type { WorkspaceContext } from "@/lib/tenant/context";
import type { Row } from "@/lib/tenant/scoped-db";

import { idSchema } from "./brands";
import { resolveIntegrations, type ServiceDeps } from "./deps";
import { ServiceError } from "./errors";
import { getShopifyCredentialsFor } from "./internal/credentials";
import type {
  BrandConnectionsDTO,
  ConnectionDTO,
  ConnectionHealth,
  ConnectionKind,
  ConnectionStatus,
  ShopifyConnectionDTO,
  ShopifyTemplatesDTO,
  TikTokAdConnectionDTO,
  TikTokProfileConnectionDTO,
} from "./types";

/** AAD for every encrypted connection column: `<table>:<rowId>:<column>`. */
export const connectionAad = {
  tiktokAdsAccessToken: (id: string) => aadFor("tiktok_ad_connection", id, "access_token"),
  tiktokProfileAccessToken: (id: string) => aadFor("tiktok_profile_connection", id, "access_token"),
  tiktokProfileRefreshToken: (id: string) =>
    aadFor("tiktok_profile_connection", id, "refresh_token"),
};

export const connectionKindSchema = z.enum(["shopify", "tiktok_ads", "tiktok_profile"]);

/** Audit targetType per connection kind: the table name, everywhere. */
export const CONNECTION_TARGET_TYPE = {
  shopify: "shopify_connection",
  tiktok_ads: "tiktok_ad_connection",
  tiktok_profile: "tiktok_profile_connection",
} as const satisfies Record<ConnectionKind, string>;

/* Health ------------------------------------------------------------------- */

const REFRESH_SOON_MS = 24 * 60 * 60 * 1000;

type Health = { health: ConnectionHealth; healthReason: string };

export function connectionHealth(input: {
  status: ConnectionStatus;
  hasToken: boolean;
  expiresAt?: Date | null;
  now?: Date;
}): Health {
  const now = input.now ?? new Date();
  switch (input.status) {
    case "disconnected":
      return { health: "red", healthReason: "Disconnected." };
    case "needs_reauth":
      return { health: "red", healthReason: "Access expired or was revoked. Reconnect." };
    case "revoked":
      return { health: "red", healthReason: "Access was revoked. Reconnect." };
    case "expiring":
      return {
        health: "orange",
        healthReason: "Access expires soon. Reconnect to keep it working.",
      };
    case "pending":
      return { health: "orange", healthReason: "Setup not finished." };
    case "active":
      if (!input.hasToken) return { health: "red", healthReason: "No access token. Reconnect." };
      if (input.expiresAt && input.expiresAt.getTime() - now.getTime() < REFRESH_SOON_MS) {
        return {
          health: "orange",
          healthReason:
            input.expiresAt <= now
              ? "Token expired; it will be refreshed on next use."
              : "Token expires soon.",
        };
      }
      return { health: "green", healthReason: "Connected." };
  }
}

/* Mapping ------------------------------------------------------------------ */

const iso = (d: Date) => d.toISOString();

function toShopifyDTO(r: Row<typeof shopifyConnection>, now?: Date): ShopifyConnectionDTO {
  return {
    kind: "shopify",
    id: r.id,
    brandId: r.brandId,
    shopDomain: r.shopDomain,
    scopes: r.scopes,
    appMode: r.appMode,
    templateSuffix: r.templateSuffix,
    status: r.status,
    ...connectionHealth({
      status: r.status,
      hasToken: !!r.accessTokenEnc,
      // The refresh token keeps the connection alive; without one, the access token's expiry.
      expiresAt: r.refreshTokenExpiresAt ?? r.tokenExpiresAt,
      now,
    }),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toTikTokAdDTO(r: Row<typeof tiktokAdConnection>, now?: Date): TikTokAdConnectionDTO {
  return {
    kind: "tiktok_ads",
    id: r.id,
    brandId: r.brandId,
    advertiserId: r.advertiserId,
    name: r.name,
    status: r.status,
    ...connectionHealth({ status: r.status, hasToken: !!r.accessTokenEnc, now }),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toTikTokProfileDTO(
  r: Row<typeof tiktokProfileConnection>,
  now?: Date,
): TikTokProfileConnectionDTO {
  return {
    kind: "tiktok_profile",
    id: r.id,
    brandId: r.brandId,
    openId: r.openId,
    displayName: r.displayName,
    postingMode: r.postingMode,
    expiresAt: r.expiresAt ? iso(r.expiresAt) : null,
    status: r.status,
    ...connectionHealth({
      status: r.status,
      // A refresh token keeps an expired access token recoverable.
      hasToken: !!r.accessTokenEnc || !!r.refreshTokenEnc,
      expiresAt: r.refreshTokenEnc ? null : r.expiresAt,
      now,
    }),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

/* Reads -------------------------------------------------------------------- */

export async function listConnections(
  ctx: WorkspaceContext,
  brandId: string,
): Promise<BrandConnectionsDTO> {
  requirePermission(ctx, "connection:read");
  const id = idSchema.parse(brandId);
  await ctx.db.getById(brand, id);
  const [shops, ads, profiles] = await Promise.all([
    ctx.db.select(shopifyConnection, {
      where: eq(shopifyConnection.brandId, id),
      orderBy: (t) => t.createdAt,
    }),
    ctx.db.select(tiktokAdConnection, {
      where: eq(tiktokAdConnection.brandId, id),
      orderBy: (t) => t.createdAt,
    }),
    ctx.db.select(tiktokProfileConnection, {
      where: eq(tiktokProfileConnection.brandId, id),
      orderBy: (t) => t.createdAt,
    }),
  ]);
  const now = new Date();
  return {
    brandId: id,
    shopify: shops.map((r) => toShopifyDTO(r, now)),
    tiktokAds: ads.map((r) => toTikTokAdDTO(r, now)),
    tiktokProfiles: profiles.map((r) => toTikTokProfileDTO(r, now)),
  };
}

/* Disconnect --------------------------------------------------------------- */

/**
 * Owner only. Wipes the stored secrets and marks the connection
 * disconnected. The row is kept because Shopify pages, campaigns and posts
 * reference it; reconnecting the same shop/advertiser/profile reuses it.
 */
export async function disconnectConnection(
  ctx: WorkspaceContext,
  input: { kind: ConnectionKind; connectionId: string },
): Promise<ConnectionDTO> {
  requirePermission(ctx, "connection:delete");
  const { kind, connectionId } = z
    .object({ kind: connectionKindSchema, connectionId: idSchema })
    .parse(input);

  return ctx.db.transaction(async (tx) => {
    let dto: ConnectionDTO;
    let label: string;
    if (kind === "shopify") {
      await tx.getById(shopifyConnection, connectionId);
      const [row] = await tx.update(
        shopifyConnection,
        {
          status: "disconnected",
          accessTokenEnc: null,
          clientSecretEnc: null,
          refreshTokenEnc: null,
          tokenExpiresAt: null,
          refreshTokenExpiresAt: null,
        },
        eq(shopifyConnection.id, connectionId),
      );
      dto = toShopifyDTO(row);
      label = row.shopDomain;
    } else if (kind === "tiktok_ads") {
      await tx.getById(tiktokAdConnection, connectionId);
      const [row] = await tx.update(
        tiktokAdConnection,
        { status: "disconnected", accessTokenEnc: null },
        eq(tiktokAdConnection.id, connectionId),
      );
      dto = toTikTokAdDTO(row);
      label = row.advertiserId;
    } else {
      await tx.getById(tiktokProfileConnection, connectionId);
      const [row] = await tx.update(
        tiktokProfileConnection,
        {
          status: "disconnected",
          accessTokenEnc: null,
          refreshTokenEnc: null,
          expiresAt: null,
          refreshExpiresAt: null,
        },
        eq(tiktokProfileConnection.id, connectionId),
      );
      dto = toTikTokProfileDTO(row);
      label = row.displayName;
    }
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "connection.delete",
        targetType: CONNECTION_TARGET_TYPE[kind],
        targetId: connectionId,
        metadata: { kind, label, brandId: dto.brandId },
      },
    );
    return dto;
  });
}

/* Helpers for OAuth callbacks (integration routes) ------------------------- */

// Shopify connections are written by lib/integrations/shopify (completeShopifyInstall),
// which owns the encrypted token bundle (access + refresh token, expiries).

/**
 * Stores TikTok Ads advertisers granted in one OAuth exchange (one token
 * covers all of them). Upserts on advertiser id.
 *
 * Reconnecting an advertiser that is already linked refreshes its token and
 * name but KEEPS the brand it was first linked to (it is never moved to
 * `brandId`); `created: false` tells the caller so.
 */
export async function saveTikTokAdConnections(
  ctx: WorkspaceContext,
  input: {
    brandId: string;
    accessToken: string;
    advertisers: TikTokAdvertiser[];
    /** Granted OAuth scopes, recorded in the audit entry. */
    scopes?: string[];
  },
): Promise<(TikTokAdConnectionDTO & { created: boolean })[]> {
  requirePermission(ctx, "connection:create");
  const v = z
    .object({
      brandId: idSchema,
      accessToken: z.string().min(1),
      advertisers: z.array(tiktokAdvertiserSchema).min(1),
      scopes: z.array(z.string()).default([]),
    })
    .parse(input);
  await ctx.db.getById(brand, v.brandId);

  return ctx.db.transaction(async (tx) => {
    const saved: (TikTokAdConnectionDTO & { created: boolean })[] = [];
    for (const adv of v.advertisers) {
      const existing = await tx.findFirst(
        tiktokAdConnection,
        eq(tiktokAdConnection.advertiserId, adv.advertiserId),
      );
      const id = existing?.id ?? crypto.randomUUID();
      const secrets = {
        name: adv.name,
        accessTokenEnc: encrypt(v.accessToken, { aad: connectionAad.tiktokAdsAccessToken(id) }),
        status: "active" as const,
      };
      const row = existing
        ? (await tx.update(tiktokAdConnection, secrets, eq(tiktokAdConnection.id, id)))[0]
        : await tx.insert(tiktokAdConnection, {
            id,
            brandId: v.brandId,
            advertiserId: adv.advertiserId,
            ...secrets,
          });
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: existing ? "connection.update" : "connection.create",
          targetType: CONNECTION_TARGET_TYPE.tiktok_ads,
          targetId: id,
          metadata: {
            provider: "tiktok_ads",
            advertiserId: adv.advertiserId,
            brandId: row.brandId,
            scopes: v.scopes,
          },
        },
      );
      saved.push({ ...toTikTokAdDTO(row), created: !existing });
    }
    return saved;
  });
}

/**
 * Stores a TikTok profile (Login Kit) token. Upserts on open_id; like
 * advertisers, a reconnected profile keeps its original brand and posting
 * mode. New profiles default to Direct Post (private until the app audit).
 */
export async function saveTikTokProfileConnection(
  ctx: WorkspaceContext,
  input: {
    brandId: string;
    token: TikTokProfileToken;
    displayName: string;
    postingMode?: "direct" | "inbox";
  },
): Promise<TikTokProfileConnectionDTO & { created: boolean }> {
  requirePermission(ctx, "connection:create");
  const v = z
    .object({
      brandId: idSchema,
      token: tiktokProfileTokenSchema,
      displayName: z.string().min(1).max(200),
      postingMode: z.enum(["direct", "inbox"]).optional(),
    })
    .parse(input);
  await ctx.db.getById(brand, v.brandId);

  return ctx.db.transaction(async (tx) => {
    const existing = await tx.findFirst(
      tiktokProfileConnection,
      eq(tiktokProfileConnection.openId, v.token.openId),
    );
    const id = existing?.id ?? crypto.randomUUID();
    const secrets = {
      displayName: v.displayName,
      accessTokenEnc: encrypt(v.token.accessToken, {
        aad: connectionAad.tiktokProfileAccessToken(id),
      }),
      refreshTokenEnc: encrypt(v.token.refreshToken, {
        aad: connectionAad.tiktokProfileRefreshToken(id),
      }),
      expiresAt: new Date(v.token.expiresAt),
      status: "active" as const,
    };
    const row = existing
      ? (await tx.update(tiktokProfileConnection, secrets, eq(tiktokProfileConnection.id, id)))[0]
      : await tx.insert(tiktokProfileConnection, {
          id,
          brandId: v.brandId,
          openId: v.token.openId,
          postingMode: v.postingMode ?? "direct",
          ...secrets,
        });
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: existing ? "connection.update" : "connection.create",
        targetType: CONNECTION_TARGET_TYPE.tiktok_profile,
        targetId: id,
        metadata: {
          provider: "tiktok_login",
          openId: v.token.openId,
          brandId: row.brandId,
          scopes: v.token.scopes,
        },
      },
    );
    return { ...toTikTokProfileDTO(row), created: !existing };
  });
}

/**
 * Product templates of the store's active theme (templates/product*.json), so
 * the UI can offer a picker instead of a free-text suffix (M1 open question 7).
 */
export async function listShopifyTemplates(
  ctx: WorkspaceContext,
  connectionId: string,
  deps: ServiceDeps = {},
): Promise<ShopifyTemplatesDTO> {
  requirePermission(ctx, "connection:read");
  const id = idSchema.parse(connectionId);
  await ctx.db.getById(shopifyConnection, id);
  const integrations = resolveIntegrations(deps);
  const { creds } = await getShopifyCredentialsFor(ctx, integrations, id);
  const suffixes = await integrations.shopify.listProductTemplates(creds);
  return { connectionId: id, suffixes, hasTrendcartTemplate: hasTrendcartTemplate(suffixes) };
}

/**
 * Sets the Shopify theme template suffix used for generated pages. A suffix
 * must exist in the active theme (listShopifyTemplates); null = default.
 */
export async function setShopifyTemplate(
  ctx: WorkspaceContext,
  input: { connectionId: string; templateSuffix: string | null },
  deps: ServiceDeps = {},
): Promise<ShopifyConnectionDTO> {
  requirePermission(ctx, "connection:update");
  const v = z
    .object({ connectionId: idSchema, templateSuffix: z.string().min(1).max(100).nullable() })
    .parse(input);
  await ctx.db.getById(shopifyConnection, v.connectionId);
  if (v.templateSuffix !== null) {
    const { suffixes } = await listShopifyTemplates(ctx, v.connectionId, deps);
    if (!suffixes.includes(v.templateSuffix)) {
      throw new ServiceError(
        "invalid_input",
        `The store's theme has no "product.${v.templateSuffix}" template.`,
      );
    }
  }
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(
      shopifyConnection,
      { templateSuffix: v.templateSuffix },
      eq(shopifyConnection.id, v.connectionId),
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "connection.update",
        targetType: "shopify_connection",
        targetId: row.id,
        metadata: { templateSuffix: v.templateSuffix },
      },
    );
    return toShopifyDTO(row);
  });
}
