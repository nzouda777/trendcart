import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { beginOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";

import { assertCanConnect } from "../../_lib/connect";
import {
  callbackUrl,
  failureRedirect,
  LOGIN_CALLBACK_PATH,
  tiktokPostingClient,
} from "../../_lib/http";

/**
 * GET /api/tiktok/login/connect?brandId=… — starts Login Kit with the
 * publish scopes (user.info.basic, video.publish, video.upload) to connect a
 * TikTok profile to a brand (connection:create).
 */
export async function GET(request: NextRequest) {
  try {
    const brandId = z.string().min(1).max(200).parse(request.nextUrl.searchParams.get("brandId"));
    const ctx = await getWorkspaceContext();
    await assertCanConnect(ctx, brandId);

    const state = await beginOAuthState("tiktok_login", {
      workspaceId: ctx.workspaceId,
      userId: ctx.actor.userId,
      data: { brandId },
    });
    const url = tiktokPostingClient().buildAuthUrl({
      state,
      redirectUri: callbackUrl(request, LOGIN_CALLBACK_PATH),
    });
    return NextResponse.redirect(url, { status: 303 });
  } catch (error) {
    unstable_rethrow(error);
    return failureRedirect(request, "tiktok_login", error);
  }
}
