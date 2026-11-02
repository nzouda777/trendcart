import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";

import { consumeOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";
import { IntegrationError } from "@/lib/domain/contracts";

import { completeAdsConnection } from "../../_lib/connect";
import { CONNECTIONS_PATH, failureRedirect, redirectTo, tiktokAdsClient } from "../../_lib/http";

/**
 * GET /api/tiktok/ads/callback?auth_code=…&state=… — TikTok advertiser
 * authorization redirect. Verifies state (single use), exchanges the code
 * and stores one tiktok_ad_connection per granted advertiser.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    // Always consume the state first, so the cookie is single use even on errors.
    const flow = await consumeOAuthState("tiktok_ads", params.get("state"));
    const code = params.get("auth_code") ?? params.get("code");
    if (!code) {
      throw new IntegrationError("tiktok_ads", "permission_denied", "Authorization was declined.", {
        retryable: false,
      });
    }
    const ctx = await getWorkspaceContext();
    const result = await completeAdsConnection(ctx, { flow, code, client: tiktokAdsClient() });
    return redirectTo(request, CONNECTIONS_PATH, {
      tiktok_ads: "connected",
      count: String(result.connections.length),
    });
  } catch (error) {
    unstable_rethrow(error);
    return failureRedirect(request, "tiktok_ads", error);
  }
}
