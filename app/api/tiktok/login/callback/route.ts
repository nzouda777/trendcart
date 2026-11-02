import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";

import { consumeOAuthState } from "@/lib/auth/oauth-state";
import { getWorkspaceContext } from "@/lib/auth/session";
import { IntegrationError } from "@/lib/domain/contracts";

import { completeProfileConnection } from "../../_lib/connect";
import {
  callbackUrl,
  CONNECTIONS_PATH,
  failureRedirect,
  LOGIN_CALLBACK_PATH,
  redirectTo,
  tiktokPostingClient,
} from "../../_lib/http";

/**
 * GET /api/tiktok/login/callback?code=…&state=… (or error=…) — Login Kit
 * redirect. Verifies state, exchanges the code and stores the profile with
 * encrypted access/refresh tokens. Posting stays private (SELF_ONLY) until
 * TikTok audits the app.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const flow = await consumeOAuthState("tiktok_login", params.get("state"));
    const code = params.get("code");
    if (params.get("error") || !code) {
      throw new IntegrationError(
        "tiktok_posting",
        "permission_denied",
        "Authorization was declined.",
        {
          retryable: false,
        },
      );
    }
    const ctx = await getWorkspaceContext();
    const result = await completeProfileConnection(ctx, {
      flow,
      code,
      // Must equal the redirect_uri sent to the authorize page.
      redirectUri: callbackUrl(request, LOGIN_CALLBACK_PATH),
      client: tiktokPostingClient(),
    });
    return redirectTo(request, CONNECTIONS_PATH, {
      tiktok_login: "connected",
      profile: result.id,
    });
  } catch (error) {
    unstable_rethrow(error);
    return failureRedirect(request, "tiktok_login", error);
  }
}
