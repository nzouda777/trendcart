/**
 * QA test world: a PGlite database with two workspaces that belong to two
 * different people (each owns a Shopify store from a different Shopify
 * account), wired with the real INTEGRATIONS_MODE=mock adapters.
 *
 * Tests only. Never import from app code.
 */
import { randomBytes } from "node:crypto";

import { openOAuthState, sealOAuthState, type OAuthFlow } from "@/lib/auth/oauth-state";
import { member } from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import type { Integrations, Role } from "@/lib/domain/contracts";
import { createIntegrations } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import {
  completeShopifyInstall,
  startShopifyInstall,
  type StartInstallInput,
} from "@/lib/integrations/shopify/install";
import type { ShopifyAdapter } from "@/lib/integrations/shopify/types";
import type { ServiceDeps } from "@/lib/services";
import { createBrand } from "@/lib/services/brands";
import {
  createSystemContext,
  createUserWorkspaceContext,
  type UserWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/tenant/context";
import { createMemoryLimiter } from "@/lib/workflows/concurrency";
import { completeAdsConnection } from "@/app/api/tiktok/_lib/connect";

// lib/crypto reads ENCRYPTION_KEY lazily; a throwaway key per test process.
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

export const SHOPIFY_REDIRECT_URI = "http://localhost:3000/api/shopify/callback";
export const ADS_REDIRECT_URI = "http://localhost:3000/api/tiktok/ads/callback";

export async function addMember(
  db: Database,
  workspaceId: string,
  role: Role,
  name = `${role}-${workspaceId.slice(0, 4)}`,
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

export function mockDeps(
  integrations: Integrations,
  extra: Partial<ServiceDeps> = {},
): ServiceDeps {
  return {
    integrations,
    limiter: createMemoryLimiter(),
    sleep: async () => undefined,
    ...extra,
  };
}

/** Start + (mock) Shopify redirect + callback, exactly like the two routes do. */
export async function connectShopifyMock(
  ctx: UserWorkspaceContext,
  shopify: ShopifyAdapter,
  input: StartInstallInput,
) {
  let sealed = "";
  const { url } = await startShopifyInstall(ctx, input, {
    client: shopify,
    redirectUri: SHOPIFY_REDIRECT_URI,
    beginState: async (s) => {
      const out = sealOAuthState("shopify", s);
      sealed = out.sealed;
      return out.state;
    },
  });
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  const flow = openOAuthState("shopify", sealed, query.state);
  const result = await completeShopifyInstall(ctx, { query, flow }, { client: shopify });
  return { url, query, flow, sealed, result };
}

/** A sealed + opened TikTok Ads flow, as the connect and callback routes produce it. */
export function adsFlow(ctx: UserWorkspaceContext, brandId: string): OAuthFlow {
  const { state, sealed } = sealOAuthState("tiktok_ads", {
    workspaceId: ctx.workspaceId,
    userId: ctx.actor.userId,
    data: { brandId },
  });
  return openOAuthState("tiktok_ads", sealed, state);
}

/** Start + (mock) TikTok redirect + callback for the Ads connection. */
export async function connectTikTokAdsMock(
  ctx: UserWorkspaceContext,
  integrations: Integrations,
  brandId: string,
) {
  const flow = adsFlow(ctx, brandId);
  const authUrl = integrations.tiktokAds.buildAuthUrl({
    state: flow.state,
    redirectUri: ADS_REDIRECT_URI,
  });
  const params = new URL(authUrl).searchParams;
  const code = params.get("auth_code") ?? params.get("code") ?? "";
  return completeAdsConnection(ctx, { flow, code, client: integrations.tiktokAds });
}

export type Tenant = {
  workspaceId: string;
  owner: UserWorkspaceContext;
  mediaBuyer: UserWorkspaceContext;
  creative: UserWorkspaceContext;
  viewer: UserWorkspaceContext;
  brandId: string;
};

export type TwoTenantWorld = {
  db: Database;
  close: () => Promise<void>;
  integrations: Integrations;
  /** The mock Shopify adapter (install/webhook surface, used by the routes). */
  shopify: ShopifyAdapter;
  a: Tenant;
  b: Tenant;
  system: (workspaceId: string) => WorkspaceContext;
};

async function tenant(db: Database, name: string): Promise<Tenant> {
  const workspaceId = await insertWorkspace(db, name);
  const owner = await addMember(db, workspaceId, "owner", `${name} owner`);
  const mediaBuyer = await addMember(db, workspaceId, "media_buyer", `${name} buyer`);
  const creative = await addMember(db, workspaceId, "creative", `${name} creative`);
  const viewer = await addMember(db, workspaceId, "viewer", `${name} viewer`);
  const brandId = (
    await createBrand(owner, { name: `${name} brand`, country: "FR", language: "fr" })
  ).id;
  return { workspaceId, owner, mediaBuyer, creative, viewer, brandId };
}

export async function createTwoTenantWorld(): Promise<TwoTenantWorld> {
  const { db, close } = await createTestDb();
  const integrations = createIntegrations("mock");
  const a = await tenant(db, "Alpha");
  const b = await tenant(db, "Bravo");
  return {
    db,
    close,
    integrations,
    shopify: createShopifyClient("mock"),
    a,
    b,
    system: (workspaceId) => createSystemContext(db, { workspaceId, name: "qa:test" }),
  };
}
