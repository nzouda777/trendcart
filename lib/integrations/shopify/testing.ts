/**
 * Test helpers for the Shopify flow tests (PGlite). Tests only.
 */
import { randomBytes } from "node:crypto";

import { member } from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import type { Role } from "@/lib/domain/contracts";
import { createUserWorkspaceContext, type UserWorkspaceContext } from "@/lib/tenant/context";

/** lib/crypto reads ENCRYPTION_KEY lazily; set a throwaway key once per test file. */
export function ensureTestEncryptionKey() {
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
}

export async function createShopifyTestWorld() {
  ensureTestEncryptionKey();
  const { db, close } = await createTestDb();
  return { db, close };
}

export async function memberContext(
  db: Database,
  workspaceId: string,
  role: Role,
  name = `${role}-user`,
): Promise<UserWorkspaceContext> {
  const userId = await insertUser(db, name);
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: workspaceId,
    userId,
    role,
    createdAt: new Date(),
  });
  return createUserWorkspaceContext(db, { userId, workspaceId });
}

export { insertWorkspace };
