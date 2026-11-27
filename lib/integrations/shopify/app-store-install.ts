import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/guards";
import { aadFor, decrypt, encrypt } from "@/lib/crypto";
import { brand, shopifyConnection } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import {
  deletePendingShopifyInstall,
  findPendingShopifyInstall,
  savePendingShopifyInstall,
  type PendingInstallRow,
} from "@/lib/tenant/system";
import { assertWithinLimit } from "@/lib/services/internal/entitlements";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { shopifyError } from "./errors";
import { isValidShopDomain } from "./hmac";
import { saveShopifyConnection, type CompleteInstallResult } from "./install";
import { shopifyInstallTokenSchema, type ShopifyAdapter, type ShopifyInstallToken } from "./types";

/*
 * Public app installs started from Shopify (App Store listing, install link,
 * or reinstall). App Store requirements 2.3.1 to 2.3.4: the install starts on
 * a Shopify surface (no shop domain typed in Trendcart), OAuth runs right away
 * before any app UI, then the merchant lands in the app.
 *
 * 1. Shopify opens the app URL (/api/shopify/launch) with ?shop&hmac&timestamp.
 *    The HMAC is verified, then OAuth starts at once: an encrypted, short-lived
 *    cookie binds the random `state` and the shop to this browser.
 * 2. /api/shopify/callback recognises that cookie, verifies HMAC + state,
 *    exchanges the code and parks the (expiring) offline token, encrypted, in
 *    `shopify_pending_install`. No workspace exists for it yet. The browser
 *    gets a claim cookie holding a random secret (only its hash is stored).
 * 3. The merchant signs in or signs up (normal Trendcart auth), then on
 *    /app/connections/shopify-claim picks the brand. `claimShopifyInstall`
 *    checks `connection:create`, the plan's store limit and the claim secret,
 *    stores the connection like an in-app install, and deletes the pending row.
 *
 * Pending rows expire after PENDING_INSTALL_TTL_MS; app/uninstalled and
 * shop/redact webhooks drop them too.
 */

const INSTALL_COOKIE = "tc_shopify_install";
const CLAIM_COOKIE = "tc_shopify_claim";
const INSTALL_TTL_SEC = 10 * 60;
export const PENDING_INSTALL_TTL_MS = 24 * 60 * 60 * 1000;
/** Launch links older than this are refused (limits replay of a captured URL). */
const LAUNCH_MAX_AGE_SEC = 24 * 60 * 60;

const installCookieSchema = z.object({
  state: z.string().min(32),
  shop: z.string().min(1),
  expiresAt: z.number().int(),
});
const claimCookieSchema = z.object({ shop: z.string().min(1), secret: z.string().min(32) });

const tokenAad = (shop: string, column: string) => aadFor("shopify_pending_install", shop, column);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/* --------------------------------- Launch --------------------------------- */

/** Whether Shopify signed this app URL request and it is recent. */
export function verifyLaunch(
  query: Record<string, string>,
  client: ShopifyAdapter,
  now: number = Date.now(),
): boolean {
  if (!isValidShopDomain(query.shop) || !client.verifyLaunchQuery(query)) return false;
  const timestamp = Number(query.timestamp);
  return Number.isFinite(timestamp) && Math.abs(now / 1000 - timestamp) <= LAUNCH_MAX_AGE_SEC;
}

/** Starts OAuth for a store opened from Shopify; returns the authorize URL. */
export async function beginAppStoreInstall(
  shop: string,
  deps: { client: ShopifyAdapter; redirectUri: string; now?: number },
): Promise<string> {
  if (!isValidShopDomain(shop)) throw shopifyError("invalid_input", "Invalid shop.");
  const state = randomBytes(32).toString("base64url");
  const sealed = encrypt(
    JSON.stringify({
      state,
      shop,
      expiresAt: (deps.now ?? Date.now()) + INSTALL_TTL_SEC * 1000,
    }),
    { aad: INSTALL_COOKIE },
  );
  (await cookies()).set(INSTALL_COOKIE, sealed, cookieOptions(INSTALL_TTL_SEC));
  return deps.client.buildInstallUrl({
    shopDomain: shop,
    oauth: { state, redirectUri: deps.redirectUri },
  });
}

/** Whether this callback belongs to a Shopify-started install (state matches our cookie). */
export async function isAppStoreCallback(query: Record<string, string>): Promise<boolean> {
  const sealed = (await cookies()).get(INSTALL_COOKIE)?.value;
  if (!sealed || !query.state) return false;
  try {
    const flow = installCookieSchema.parse(JSON.parse(decrypt(sealed, { aad: INSTALL_COOKIE })));
    return safeEqual(flow.state, query.state);
  } catch {
    return false;
  }
}

/**
 * Callback of a Shopify-started install: verifies the flow, exchanges the
 * code and parks the token until a workspace claims it. Sets the claim cookie.
 */
export async function completeAppStoreInstall(
  query: Record<string, string>,
  deps: { client: ShopifyAdapter; db?: Database; now?: () => number },
): Promise<{ shopDomain: string }> {
  const now = deps.now ?? Date.now;
  const jar = await cookies();
  const sealed = jar.get(INSTALL_COOKIE)?.value;
  jar.delete(INSTALL_COOKIE);
  if (!sealed) throw shopifyError("invalid_input", "Install flow not found or expired.");
  let flow: z.infer<typeof installCookieSchema>;
  try {
    flow = installCookieSchema.parse(JSON.parse(decrypt(sealed, { aad: INSTALL_COOKIE })));
  } catch {
    throw shopifyError("invalid_input", "Invalid install flow.");
  }
  if (flow.expiresAt <= now()) throw shopifyError("invalid_input", "Install flow expired.");
  if (query.shop !== flow.shop) {
    throw shopifyError("invalid_input", "The callback shop does not match the installing store.");
  }

  // Verifies the callback HMAC and the state, and checks the granted scopes.
  const token = await deps.client.completeInstall({ query, expectedState: flow.state });
  const secret = randomBytes(32).toString("base64url");
  await savePendingInstall(token, sha256(secret), { db: deps.db, now: now() });
  jar.set(
    CLAIM_COOKIE,
    encrypt(JSON.stringify({ shop: token.shopDomain, secret }), { aad: CLAIM_COOKIE }),
    cookieOptions(PENDING_INSTALL_TTL_MS / 1000),
  );
  return { shopDomain: token.shopDomain };
}

async function savePendingInstall(
  token: ShopifyInstallToken,
  claimHash: string,
  opts: { db?: Database; now: number },
): Promise<void> {
  const shop = token.shopDomain;
  const values = {
    accessTokenEnc: encrypt(token.accessToken, { aad: tokenAad(shop, "access_token") }),
    refreshTokenEnc: token.refreshToken
      ? encrypt(token.refreshToken, { aad: tokenAad(shop, "refresh_token") })
      : null,
    tokenExpiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt
      ? new Date(token.refreshTokenExpiresAt)
      : null,
    scopes: token.scopes,
    claimHash,
    expiresAt: new Date(opts.now + PENDING_INSTALL_TTL_MS),
  };
  // Also drops abandoned installs that expired.
  await savePendingShopifyInstall(shop, values, new Date(opts.now), opts.db);
}

/* ---------------------------------- Claim --------------------------------- */

type PendingRow = PendingInstallRow;

/** The pending install this browser may claim, or null (no cookie, expired, wrong secret). */
async function loadClaimable(
  db: Database | undefined,
  now: number,
): Promise<{ row: PendingRow; shop: string } | null> {
  const sealed = (await cookies()).get(CLAIM_COOKIE)?.value;
  if (!sealed) return null;
  let claim: z.infer<typeof claimCookieSchema>;
  try {
    claim = claimCookieSchema.parse(JSON.parse(decrypt(sealed, { aad: CLAIM_COOKIE })));
  } catch {
    return null;
  }
  const row = await findPendingShopifyInstall(claim.shop, db);
  if (!row || row.expiresAt.getTime() <= now) return null;
  if (!safeEqual(row.claimHash, sha256(claim.secret))) return null;
  return { row, shop: claim.shop };
}

/** Shop of the store waiting to be claimed by this browser, for the claim page and banners. */
export async function pendingClaimShop(
  deps: { db?: Database; now?: number } = {},
): Promise<string | null> {
  const found = await loadClaimable(deps.db, deps.now ?? Date.now());
  return found?.shop ?? null;
}

function tokenOf(row: PendingRow): ShopifyInstallToken {
  const shop = row.shopDomain;
  return shopifyInstallTokenSchema.parse({
    shopDomain: shop,
    accessToken: decrypt(row.accessTokenEnc, { aad: tokenAad(shop, "access_token") }),
    scopes: row.scopes,
    refreshToken: row.refreshTokenEnc
      ? decrypt(row.refreshTokenEnc, { aad: tokenAad(shop, "refresh_token") })
      : null,
    expiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt?.toISOString() ?? null,
  });
}

export const claimInputSchema = z.object({ brandId: z.string().min(1).max(200) });

/**
 * Connects the store this browser installed from Shopify to a brand of the
 * session's workspace (role: connection:create). The token moves from the
 * pending row to the workspace's shopify_connection (expiring tokens keep
 * refreshing there), then the pending row and the claim cookie are deleted.
 */
export async function claimShopifyInstall(
  ctx: WorkspaceContext,
  rawInput: z.input<typeof claimInputSchema>,
  deps: { client: ShopifyAdapter; db?: Database; now?: () => number },
): Promise<CompleteInstallResult> {
  requirePermission(ctx, "connection:create");
  const input = claimInputSchema.parse(rawInput);
  const now = (deps.now ?? Date.now)();
  const found = await loadClaimable(deps.db, now);
  if (!found) {
    throw shopifyError(
      "invalid_input",
      "No Shopify store is waiting to be connected, or the link expired. Open Trendcart from your Shopify admin again.",
      { retryable: false },
    );
  }
  await ctx.db.getById(brand, input.brandId);
  await assertWithinLimit(ctx, "stores", () =>
    ctx.db.count(shopifyConnection, (t) => ne(t.shopDomain, found.shop)),
  );

  const result = await saveShopifyConnection(
    ctx,
    {
      brandId: input.brandId,
      shopDomain: found.shop,
      appMode: "public",
      token: tokenOf(found.row),
      source: "shopify_install",
    },
    { client: deps.client },
  );
  await deletePendingShopifyInstall(found.shop, found.row.id, deps.db);
  (await cookies()).delete(CLAIM_COOKIE);
  return result;
}

/** app/uninstalled, shop/redact: the parked token is dead or must go. */
export async function dropPendingInstall(shop: string, db?: Database): Promise<void> {
  await deletePendingShopifyInstall(shop, undefined, db);
}
