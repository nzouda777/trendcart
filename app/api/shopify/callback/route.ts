import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { consumeOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getIntegrationsMode } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { connectionsRedirect, errorCode, publicOrigin } from "@/lib/integrations/shopify/http";
import {
  completeAppStoreInstall,
  isAppStoreCallback,
} from "@/lib/integrations/shopify/app-store-install";
import { completeShopifyInstall } from "@/lib/integrations/shopify/install";

/** Where a store installed from Shopify is attached to a workspace (after sign-in). */
const CLAIM_PATH = "/app/connections/shopify-claim";

/*
 * Shopify OAuth callback: ?code&hmac&shop&state&timestamp[&host].
 * Session first (the merchant's browser started the flow), then the single-use
 * state cookie, then HMAC + state + code exchange inside completeShopifyInstall.
 * Always redirects to /app/connections with ?shopify=connected or ?shopify_error=<code>.
 *
 * Installs started from Shopify (/api/shopify/launch) have no session yet:
 * their own state cookie routes them to completeAppStoreInstall, which parks
 * the token, then the merchant signs in and claims the store on CLAIM_PATH.
 */
export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (await isAppStoreCallback(query)) {
    try {
      await completeAppStoreInstall(query, { client: createShopifyClient(getIntegrationsMode()) });
      return NextResponse.redirect(new URL(CLAIM_PATH, publicOrigin(request.url)), 303);
    } catch (error) {
      unstable_rethrow(error);
      const { code } = errorCode(error);
      return NextResponse.redirect(connectionsRedirect(request.url, { shopify_error: code }), 303);
    }
  }
  try {
    const ctx = await getWorkspaceContext();
    const flow = await consumeOAuthState("shopify", query.state);
    const result = await completeShopifyInstall(
      ctx,
      { query, flow },
      { client: createShopifyClient(getIntegrationsMode()) },
    );
    return NextResponse.redirect(
      connectionsRedirect(request.url, {
        shopify: "connected",
        connection: result.connectionId,
        ...(result.metafieldsReady ? {} : { shopify_warning: "metafields_pending" }),
      }),
      303,
    );
  } catch (error) {
    // Let Next's prerender bailout / redirect() / notFound() through.
    unstable_rethrow(error);
    const { code } = errorCode(error);
    return NextResponse.redirect(connectionsRedirect(request.url, { shopify_error: code }), 303);
  }
}
