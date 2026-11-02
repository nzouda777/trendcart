import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { beginOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getIntegrationsMode } from "@/lib/integrations";
import { createShopifyClient } from "@/lib/integrations/shopify";
import { callbackUrl, connectionsRedirect, errorCode } from "@/lib/integrations/shopify/http";
import { startShopifyInstall, type StartInstallInput } from "@/lib/integrations/shopify/install";

/*
 * Starts a Shopify store connection (role: connection:create).
 *
 *   GET  /api/shopify/install?brandId=...&shop=acme            public app
 *   POST /api/shopify/install  { brandId, shop, appMode, clientId?, clientSecret? }
 *        JSON in -> JSON { url } out; form post -> 303 redirect.
 *
 * In mock mode the returned URL points straight at /api/shopify/callback.
 */

async function start(request: NextRequest, input: StartInstallInput) {
  const ctx = await getWorkspaceContext();
  return startShopifyInstall(ctx, input, {
    client: createShopifyClient(getIntegrationsMode()),
    beginState: (s) => beginOAuthState("shopify", s),
    redirectUri: callbackUrl(request.url),
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const { url } = await start(request, {
      appMode: "public",
      brandId: params.get("brandId") ?? "",
      shop: params.get("shop") ?? "",
    });
    return NextResponse.redirect(url, 302);
  } catch (error) {
    // Let Next's prerender bailout / redirect() / notFound() through.
    unstable_rethrow(error);
    const { code } = errorCode(error);
    return NextResponse.redirect(connectionsRedirect(request.url, { shopify_error: code }), 303);
  }
}

export async function POST(request: NextRequest) {
  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  try {
    const body: Record<string, unknown> = isJson
      ? await request.json()
      : Object.fromEntries((await request.formData()).entries());
    const input = {
      appMode: body.appMode === "custom" ? "custom" : "public",
      brandId: String(body.brandId ?? ""),
      shop: String(body.shop ?? ""),
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : undefined,
    } as StartInstallInput;
    const { url } = await start(request, input);
    return isJson ? NextResponse.json({ url }) : NextResponse.redirect(url, 303);
  } catch (error) {
    unstable_rethrow(error);
    const { code, status, message } = errorCode(error);
    if (isJson) return NextResponse.json({ error: code, message }, { status });
    return NextResponse.redirect(connectionsRedirect(request.url, { shopify_error: code }), 303);
  }
}
