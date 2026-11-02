import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { consumeOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getIntegrationsMode } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { connectionsRedirect, errorCode } from "@/lib/integrations/shopify/http";
import { completeShopifyInstall } from "@/lib/integrations/shopify/install";

/*
 * Shopify OAuth callback: ?code&hmac&shop&state&timestamp[&host].
 * Session first (the merchant's browser started the flow), then the single-use
 * state cookie, then HMAC + state + code exchange inside completeShopifyInstall.
 * Always redirects to /app/connections with ?shopify=connected or ?shopify_error=<code>.
 */
export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
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
