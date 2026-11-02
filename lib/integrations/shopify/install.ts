import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/guards";
import type { OAuthFlow } from "@/lib/auth/oauth-state";
import { encrypt } from "@/lib/crypto";
import { brand, shopifyConnection } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { appCredentialsFor, clientSecretAad, tokenColumns } from "./credentials";
import { shopifyError } from "./errors";
import { normalizeShopDomain } from "./hmac";
import type { ShopifyAdapter } from "./types";

/*
 * Shopify connection install flow. Route handlers in app/api/shopify/* only
 * parse the request and call these; they take the WorkspaceContext first like
 * any service (could move to lib/services/connections later unchanged).
 */

export const startInstallInputSchema = z.discriminatedUnion("appMode", [
  z.object({
    appMode: z.literal("public"),
    brandId: z.string().min(1).max(200),
    shop: z.string().min(1).max(255),
  }),
  z.object({
    appMode: z.literal("custom"),
    brandId: z.string().min(1).max(200),
    shop: z.string().min(1).max(255),
    clientId: z.string().trim().min(1).max(255),
    clientSecret: z.string().trim().min(1).max(255),
  }),
]);
export type StartInstallInput = z.input<typeof startInstallInputSchema>;

/** What the OAuth state cookie carries between start and callback. */
export const installFlowDataSchema = z.object({
  brandId: z.string().min(1),
  shopDomain: z.string().min(1),
  appMode: z.enum(["public", "custom"]),
  connectionId: z.string().min(1).optional(),
});
export type InstallFlowData = z.infer<typeof installFlowDataSchema>;

export type StartInstallDeps = {
  client: ShopifyAdapter;
  /** beginOAuthState("shopify", ...) in routes; a fake in tests. */
  beginState: (input: {
    workspaceId: string;
    userId: string;
    data: InstallFlowData;
  }) => Promise<string>;
  redirectUri: string;
};

export async function startShopifyInstall(
  ctx: WorkspaceContext,
  rawInput: StartInstallInput,
  deps: StartInstallDeps,
): Promise<{ url: string }> {
  requirePermission(ctx, "connection:create");
  const input = startInstallInputSchema.parse(rawInput);
  const shopDomain = normalizeShopDomain(input.shop);
  if (!shopDomain)
    throw shopifyError("invalid_input", "Enter a valid <shop>.myshopify.com domain.");
  await ctx.db.getById(brand, input.brandId);

  let connectionId: string | undefined;
  let app: { clientId: string; clientSecret: string } | undefined;

  if (input.appMode === "custom") {
    // The per-store secret must survive the redirect: keep it encrypted on the
    // (possibly pending) connection row, never in the state cookie.
    app = { clientId: input.clientId, clientSecret: input.clientSecret };
    const existing = await ctx.db.findFirst(shopifyConnection, (t) => eq(t.shopDomain, shopDomain));
    connectionId = existing?.id ?? crypto.randomUUID();
    const clientSecretEnc = encrypt(input.clientSecret, { aad: clientSecretAad(connectionId) });
    if (existing) {
      // Do not flip app_mode of a working connection before OAuth succeeds.
      await ctx.db.update(
        shopifyConnection,
        { clientId: input.clientId, clientSecretEnc },
        eq(shopifyConnection.id, existing.id),
      );
    } else {
      await ctx.db.insert(shopifyConnection, {
        id: connectionId,
        brandId: input.brandId,
        shopDomain,
        appMode: "custom",
        clientId: input.clientId,
        clientSecretEnc,
        status: "pending",
      });
    }
    await writeAudit(ctx, {
      action: "connection.update",
      targetType: "shopify_connection",
      targetId: connectionId,
      metadata: { shopDomain, change: "custom_app_credentials_saved" },
    });
  }

  const state = await deps.beginState({
    workspaceId: ctx.workspaceId,
    userId: ctx.actor.userId,
    data: { brandId: input.brandId, shopDomain, appMode: input.appMode, connectionId },
  });
  const url = deps.client.buildInstallUrl({
    shopDomain,
    oauth: { state, redirectUri: deps.redirectUri },
    app,
  });
  return { url };
}

export type CompleteInstallDeps = {
  client: ShopifyAdapter;
};

export type CompleteInstallResult = {
  connectionId: string;
  shopDomain: string;
  created: boolean;
  /** False when the metafield definitions could not be ensured (retry later). */
  metafieldsReady: boolean;
};

/**
 * Callback: `flow` is the already-consumed OAuth state (consumeOAuthState),
 * `query` the raw callback query. Verifies HMAC + state through the client,
 * stores the offline token encrypted and upserts the connection.
 */
export async function completeShopifyInstall(
  ctx: WorkspaceContext,
  input: { query: Record<string, string>; flow: OAuthFlow },
  deps: CompleteInstallDeps,
): Promise<CompleteInstallResult> {
  requirePermission(ctx, "connection:create");
  const { flow, query } = input;
  if (flow.provider !== "shopify") throw new ForbiddenError("Wrong OAuth flow.");
  if (flow.workspaceId !== ctx.workspaceId || flow.userId !== ctx.actor.userId) {
    throw new ForbiddenError("This Shopify install was started by another session.");
  }
  const data = installFlowDataSchema.parse(flow.data);
  // The shop in the callback must be the one the user asked to connect.
  if (query.shop !== data.shopDomain) {
    throw shopifyError("invalid_input", "The callback shop does not match the requested store.");
  }
  await ctx.db.getById(brand, data.brandId);

  let app: ReturnType<typeof appCredentialsFor>;
  if (data.appMode === "custom") {
    if (!data.connectionId) throw shopifyError("invalid_input", "Missing custom app connection.");
    const pending = await ctx.db.getById(shopifyConnection, data.connectionId);
    // Read the custom secret regardless of the row's current app_mode.
    app = appCredentialsFor({ ...pending, appMode: "custom" });
  }

  const token = await deps.client.completeInstall({ query, expectedState: flow.state, app });

  const existing = await ctx.db.findFirst(shopifyConnection, (t) =>
    eq(t.shopDomain, data.shopDomain),
  );
  const connectionId = existing?.id ?? data.connectionId ?? crypto.randomUUID();
  const tokenValues = tokenColumns(connectionId, token);
  const wasActive = existing?.status === "active";

  await ctx.db.transaction(async (tx) => {
    const txCtx = { ...ctx, db: tx };
    const values = {
      brandId: data.brandId,
      ...tokenValues,
      scopes: token.scopes,
      appMode: data.appMode,
      clientId: data.appMode === "custom" ? app!.clientId : null,
      // Public installs drop any stale custom secret; custom keeps the one just saved.
      ...(data.appMode === "public" ? { clientSecretEnc: null } : {}),
      status: "active" as const,
    };
    if (existing) {
      await tx.update(shopifyConnection, values, eq(shopifyConnection.id, existing.id));
    } else {
      await tx.insert(shopifyConnection, {
        id: connectionId,
        shopDomain: data.shopDomain,
        ...values,
      });
    }
    await writeAudit(txCtx, {
      action: wasActive ? "connection.update" : "connection.create",
      targetType: "shopify_connection",
      targetId: connectionId,
      metadata: {
        provider: "shopify",
        shopDomain: data.shopDomain,
        brandId: data.brandId,
        appMode: data.appMode,
        scopes: token.scopes,
        reconnect: Boolean(existing),
      },
    });
  });

  // Best effort: the page builder re-ensures before creating products.
  let metafieldsReady = true;
  try {
    await deps.client.ensureMetafieldDefinitions({
      shopDomain: data.shopDomain,
      accessToken: token.accessToken,
    });
  } catch {
    metafieldsReady = false;
  }

  return { connectionId, shopDomain: data.shopDomain, created: !existing, metafieldsReady };
}
