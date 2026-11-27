import "server-only";

import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  campaign,
  pendingImage,
  shopifyConnection,
  shopifyPendingInstall,
  tiktokProfileConnection,
} from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

import { createSystemContext, type WorkspaceContext } from "./context";

/*
 * Sanctioned entry points for background work (workflows, crons, webhooks)
 * that cannot go through a session. The cross-workspace lookups return ids
 * only, never secrets; everything after that goes through a system context
 * scoped to the row's own workspace.
 *
 * The optional trailing `db` exists for tests (PGlite); app code omits it.
 */

export type WorkspaceConnectionRef = { workspaceId: string; connectionId: string };

/**
 * Workspace-scoped context for background work. Only pass a workspace id
 * read from a trusted record (job row, verified webhook lookup, cron scan).
 */
export function getSystemContext(
  workspaceId: string,
  name: string,
  db: Database = getDb(),
): WorkspaceContext {
  return createSystemContext(db, { workspaceId, name });
}

/**
 * Every Shopify connection for a shop domain, across workspaces. Call only
 * after the webhook HMAC was verified. Order is stable (oldest first).
 */
export async function findShopifyConnectionsByShopDomain(
  shop: string,
  db: Database = getDb(),
): Promise<WorkspaceConnectionRef[]> {
  const domain = shop.trim().toLowerCase();
  if (!domain) return [];
  return db
    .select({ workspaceId: shopifyConnection.workspaceId, connectionId: shopifyConnection.id })
    .from(shopifyConnection)
    .where(eq(shopifyConnection.shopDomain, domain))
    .orderBy(asc(shopifyConnection.createdAt), asc(shopifyConnection.id));
}

/**
 * Whether any workspace holds a working (active or expiring) connection for
 * this shop. Used by the Shopify app URL to tell "open the app" from
 * "install": call only after the launch HMAC was verified.
 */
export async function shopHasUsableConnection(
  shop: string,
  db: Database = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: shopifyConnection.id })
    .from(shopifyConnection)
    .where(
      and(
        eq(shopifyConnection.shopDomain, shop.trim().toLowerCase()),
        or(eq(shopifyConnection.status, "active"), eq(shopifyConnection.status, "expiring")),
        isNotNull(shopifyConnection.accessTokenEnc),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Active TikTok profile connections that hold a refresh token and whose
 * access token expires before `before` (or has no known expiry), across
 * workspaces, soonest first.
 */
export async function listDueTikTokProfileConnections(
  input: { before: Date; limit: number },
  db: Database = getDb(),
): Promise<WorkspaceConnectionRef[]> {
  const limit = Math.max(0, Math.min(Math.trunc(input.limit), 1000));
  if (limit === 0) return [];
  const t = tiktokProfileConnection;
  return db
    .select({ workspaceId: t.workspaceId, connectionId: t.id })
    .from(t)
    .where(
      and(
        eq(t.status, "active"),
        isNotNull(t.refreshTokenEnc),
        or(isNull(t.expiresAt), lt(t.expiresAt, input.before)),
      ),
    )
    .orderBy(asc(t.expiresAt), asc(t.id))
    .limit(limit);
}

export type WorkspaceCampaignRef = { workspaceId: string; campaignId: string };

/** How long a launched campaign that was paused keeps being synced (late stats). */
export const PAUSED_CAMPAIGN_SYNC_MS = 48 * 60 * 60 * 1000;

/**
 * Launched campaigns to sync hourly stats for, across workspaces (ids only):
 * every `active` campaign, plus `paused` ones that were launched and changed
 * within the last 48 hours, so their final hours land.
 *
 * Fair rotation: least recently synced first (`stats_synced_at`, never synced
 * first), then oldest launch. The sync must stamp each campaign it attempts
 * with `markCampaignStatsSynced`, success or failure, so a batch smaller than
 * the backlog still reaches every campaign.
 */
export async function listLaunchedCampaigns(
  input: { limit: number; now?: Date },
  db: Database = getDb(),
): Promise<WorkspaceCampaignRef[]> {
  const limit = Math.max(0, Math.min(Math.trunc(input.limit), 1000));
  if (limit === 0) return [];
  const since = new Date((input.now ?? new Date()).getTime() - PAUSED_CAMPAIGN_SYNC_MS);
  const c = campaign;
  return db
    .select({ workspaceId: c.workspaceId, campaignId: c.id })
    .from(c)
    .where(
      and(
        isNotNull(c.launchedAt),
        or(eq(c.status, "active"), and(eq(c.status, "paused"), gt(c.updatedAt, since))),
      ),
    )
    .orderBy(sql`${c.statsSyncedAt} asc nulls first`, asc(c.launchedAt), asc(c.id))
    .limit(limit);
}

/**
 * Records a stats sync attempt on a campaign of the context's workspace.
 * Leaves `updated_at` untouched: it dates the last real change (a pause),
 * which bounds how long a paused campaign keeps being synced.
 */
export async function markCampaignStatsSynced(
  ctx: WorkspaceContext,
  campaignId: string,
  at: Date = new Date(),
): Promise<void> {
  await ctx.db.update(
    campaign,
    {
      statsSyncedAt: at,
      // Explicit value so the $onUpdate default does not bump it.
      updatedAt: sql`${campaign.updatedAt}` as unknown as Date,
    },
    eq(campaign.id, campaignId),
  );
}

/**
 * One pending image by id, across workspaces, for the signed image route.
 * Call only after the URL signature was verified (lib/media/images): the
 * signature is what authorizes the read. Returns the bytes and type only.
 */
export async function readSignedPendingImage(
  imageId: string,
  db: Database = getDb(),
): Promise<{ mimeType: string; dataBase64: string } | null> {
  const [row] = await db
    .select({ mimeType: pendingImage.mimeType, dataBase64: pendingImage.dataBase64 })
    .from(pendingImage)
    .where(eq(pendingImage.id, imageId))
    .limit(1);
  return row ?? null;
}

/** Cron: deletes pending images created before `before` (their product never reached Shopify). */
export async function purgePendingImagesBefore(
  before: Date,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .delete(pendingImage)
    .where(lt(pendingImage.createdAt, before))
    .returning({ id: pendingImage.id });
  return rows.length;
}

/* Shopify installs not claimed by a workspace yet (lib/integrations/shopify/app-store-install). */

export type PendingInstallRow = typeof shopifyPendingInstall.$inferSelect;
export type PendingInstallValues = Omit<
  typeof shopifyPendingInstall.$inferInsert,
  "id" | "shopDomain" | "createdAt"
>;

/** Upserts the parked token of a shop (one row per shop) and drops expired rows. */
export async function savePendingShopifyInstall(
  shopDomain: string,
  values: PendingInstallValues,
  now: Date,
  db: Database = getDb(),
): Promise<void> {
  await db.delete(shopifyPendingInstall).where(lt(shopifyPendingInstall.expiresAt, now));
  await db
    .insert(shopifyPendingInstall)
    .values({ shopDomain, ...values })
    .onConflictDoUpdate({ target: shopifyPendingInstall.shopDomain, set: values });
}

export async function findPendingShopifyInstall(
  shopDomain: string,
  db: Database = getDb(),
): Promise<PendingInstallRow | null> {
  const [row] = await db
    .select()
    .from(shopifyPendingInstall)
    .where(eq(shopifyPendingInstall.shopDomain, shopDomain))
    .limit(1);
  return row ?? null;
}

/** Deletes a shop's parked token (claimed, uninstalled or redacted). `id` narrows to one row. */
export async function deletePendingShopifyInstall(
  shopDomain: string,
  id?: string,
  db: Database = getDb(),
): Promise<void> {
  await db
    .delete(shopifyPendingInstall)
    .where(
      id
        ? and(eq(shopifyPendingInstall.shopDomain, shopDomain), eq(shopifyPendingInstall.id, id))
        : eq(shopifyPendingInstall.shopDomain, shopDomain),
    );
}
