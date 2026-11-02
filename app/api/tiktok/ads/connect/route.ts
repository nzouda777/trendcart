import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { beginOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";

import { assertCanConnect } from "../../_lib/connect";
import { ADS_CALLBACK_PATH, callbackUrl, failureRedirect, tiktokAdsClient } from "../../_lib/http";

/**
 * GET /api/tiktok/ads/connect?brandId=… — starts TikTok advertiser
 * authorization for a brand (connection:create). In mock mode the
 * "authorization page" is our own callback, so the flow completes locally.
 */
export async function GET(request: NextRequest) {
  try {
    const brandId = z.string().min(1).max(200).parse(request.nextUrl.searchParams.get("brandId"));
    const ctx = await getWorkspaceContext();
    await assertCanConnect(ctx, brandId);

    const state = await beginOAuthState("tiktok_ads", {
      workspaceId: ctx.workspaceId,
      userId: ctx.actor.userId,
      data: { brandId },
    });
    const url = tiktokAdsClient().buildAuthUrl({
      state,
      redirectUri: callbackUrl(request, ADS_CALLBACK_PATH),
    });
    return NextResponse.redirect(url, { status: 303 });
  } catch (error) {
    unstable_rethrow(error);
    return failureRedirect(request, "tiktok_ads", error);
  }
}
