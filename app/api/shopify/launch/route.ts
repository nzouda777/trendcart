import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { AUTH_PATHS } from "@/lib/auth/paths";
import { getWorkspaceContext } from "@/lib/auth/session";
import { shopifyConnection } from "@/lib/db/schema";
import { getIntegrationsMode } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { beginAppStoreInstall, verifyLaunch } from "@/lib/integrations/shopify/app-store-install";
import { USABLE_STATUSES } from "@/lib/integrations/shopify/credentials";
import { callbackUrl, publicOrigin } from "@/lib/integrations/shopify/http";
import { shopHasUsableConnection } from "@/lib/tenant/system";

/*
 * GET /api/shopify/launch — the public app's App URL (shopify.app.toml
 * `application_url`). Shopify opens it with ?shop&hmac&timestamp[&host] when a
 * merchant installs the app (App Store, install link), reinstalls it, or opens
 * it from the admin.
 *
 * - Bad or stale signature: 400, nothing else happens.
 * - The store already works in the signed-in user's workspace: open the app.
 * - Signed out, and some workspace already has the store: sign in, then the app.
 * - Otherwise (install or reinstall): OAuth right away, before any Trendcart UI
 *   (App Store requirement 2.3.2). See lib/integrations/shopify/app-store-install.
 */
export async function GET(request: NextRequest) {
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const client = createShopifyClient(getIntegrationsMode());
  if (!verifyLaunch(query, client)) {
    return new NextResponse(
      "Invalid or expired Shopify link. Open Trendcart from your Shopify admin again.",
      {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
  const shop = query.shop!;
  const origin = publicOrigin(request.url);

  let signedIn = false;
  try {
    const ctx = await getWorkspaceContext();
    signedIn = true;
    const row = await ctx.db.findFirst(shopifyConnection, eq(shopifyConnection.shopDomain, shop));
    if (row && USABLE_STATUSES.has(row.status) && row.accessTokenEnc) {
      return NextResponse.redirect(new URL(AUTH_PATHS.home, origin), 303);
    }
  } catch (error) {
    unstable_rethrow(error);
    // No session (or no workspace yet): decided below.
  }

  if (!signedIn && (await shopHasUsableConnection(shop))) {
    const signIn = new URL(AUTH_PATHS.signIn, origin);
    signIn.searchParams.set("next", AUTH_PATHS.home);
    return NextResponse.redirect(signIn, 303);
  }

  const url = await beginAppStoreInstall(shop, { client, redirectUri: callbackUrl(request.url) });
  return NextResponse.redirect(url, 302);
}
