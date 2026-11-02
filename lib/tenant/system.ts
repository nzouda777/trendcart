import "server-only";

import { and, asc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { shopifyConnection, tiktokProfileConnection } from "@/lib/db/schema";
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
