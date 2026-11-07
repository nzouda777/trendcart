/**
 * Test helpers for services: a PGlite database with two workspaces, one user
 * context per role in workspace A, an owner in workspace B, and fake
 * Integrations built from the contract types (unset methods throw).
 */
import { randomBytes } from "node:crypto";

import type { Integrations, Role } from "@/lib/domain/contracts";
import { member } from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import {
  createSystemContext,
  createUserWorkspaceContext,
  type UserWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/tenant/context";
import { createMemoryLimiter } from "@/lib/workflows/concurrency";

import type { ServiceDeps } from "../deps";
import { createMemoryRateLimiter } from "../rate-limit";

// lib/crypto reads this lazily on first use.
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

export type TestEnv = {
  db: Database;
  close: () => Promise<void>;
  wsA: string;
  wsB: string;
  /** Workspace A, one context per role. */
  a: Record<Role, UserWorkspaceContext>;
  /** Workspace B owner. */
  bOwner: UserWorkspaceContext;
  system: (workspaceId: string) => WorkspaceContext;
};

async function addMember(db: Database, workspaceId: string, role: Role) {
  const userId = await insertUser(db, `${role} ${workspaceId.slice(0, 4)}`);
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: workspaceId,
    userId,
    role,
    createdAt: new Date(),
  });
  return createUserWorkspaceContext(db, { userId, workspaceId });
}

export async function setupTestEnv(): Promise<TestEnv> {
  const { db, close } = await createTestDb();
  const wsA = await insertWorkspace(db, "Workspace A");
  const wsB = await insertWorkspace(db, "Workspace B");
  const a = {
    owner: await addMember(db, wsA, "owner"),
    media_buyer: await addMember(db, wsA, "media_buyer"),
    creative: await addMember(db, wsA, "creative"),
    viewer: await addMember(db, wsA, "viewer"),
  };
  const bOwner = await addMember(db, wsB, "owner");
  return {
    db,
    close,
    wsA,
    wsB,
    a,
    bOwner,
    system: (workspaceId) => createSystemContext(db, { workspaceId, name: "workflow:test" }),
  };
}

export const ROLES_ASC: Role[] = ["viewer", "creative", "media_buyer", "owner"];

/** Every adapter method throws unless overridden. */
function strict<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl as T, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof T];
      if (prop === "then") return undefined;
      return () => {
        throw new Error(`fake ${name}.${String(prop)} was not expected to be called`);
      };
    },
  });
}

export type FakeIntegrationsInput = {
  [K in Exclude<keyof Integrations, "mode">]?: Partial<Integrations[K]>;
};

export function fakeIntegrations(overrides: FakeIntegrationsInput = {}): Integrations {
  return {
    mode: "mock",
    shopify: strict("shopify", overrides.shopify),
    tiktokAds: strict("tiktokAds", overrides.tiktokAds),
    tiktokPosting: strict("tiktokPosting", overrides.tiktokPosting),
    tiktokData: strict("tiktokData", overrides.tiktokData),
    productAnalyzer: strict("productAnalyzer", overrides.productAnalyzer),
    supplierFinder: strict("supplierFinder", overrides.supplierFinder),
    complianceChecker: strict("complianceChecker", overrides.complianceChecker),
    copywriter: strict("copywriter", overrides.copywriter),
    proxyChecker: strict("proxyChecker", overrides.proxyChecker),
  };
}

/** Deps with fakes, no real sleeping, a fresh in-memory limiter. */
export function testDeps(
  integrations: Integrations,
  extra: Partial<ServiceDeps> = {},
): ServiceDeps {
  return {
    integrations,
    limiter: createMemoryLimiter(),
    importLimiter: createMemoryRateLimiter(1000, 3_600_000),
    sleep: async () => undefined,
    ...extra,
  };
}

export const newBrandInput = (name = "Acme") => ({
  name,
  country: "FR",
  language: "fr",
  currency: "EUR",
});
