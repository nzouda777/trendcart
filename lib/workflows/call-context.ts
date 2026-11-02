import "server-only";

import { eq } from "drizzle-orm";

import type { CallContext } from "@/lib/domain/contracts";
import { aadFor, decrypt } from "@/lib/crypto";
import { proxy } from "@/lib/db/schema";
import type { ScopedDb } from "@/lib/tenant/scoped-db";

/** AAD binding a proxy URL envelope to its row. */
export const proxyUrlAad = (proxyId: string) => aadFor("proxy", proxyId, "url");

/**
 * The CallContext every adapter receives: workspace, brand and the brand's
 * decrypted proxy URL when one is enabled. Build it right before the call and
 * never persist or log it.
 */
export async function buildCallContext(db: ScopedDb, brandId?: string): Promise<CallContext> {
  if (!brandId) return { workspaceId: db.workspaceId };
  const row = await db.findFirst(proxy, eq(proxy.brandId, brandId));
  const proxyUrl = row?.enabled ? decrypt(row.urlEnc, { aad: proxyUrlAad(row.id) }) : undefined;
  return { workspaceId: db.workspaceId, brandId, ...(proxyUrl ? { proxyUrl } : {}) };
}
