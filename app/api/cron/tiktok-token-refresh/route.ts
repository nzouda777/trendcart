import { NextResponse } from "next/server";

import { getIntegrations } from "@/lib/integrations";
import { getRateLimiter } from "@/lib/integrations/tiktok-ads/rate-limit";

import { isAuthorizedCron, refreshProfileTokens } from "./refresh";

/**
 * GET /api/cron/tiktok-token-refresh — Vercel Cron (hourly). Requires
 * `Authorization: Bearer $CRON_SECRET`; refuses everything when unset.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await refreshProfileTokens({
    client: getIntegrations().tiktokPosting,
    limiter: getRateLimiter("tiktok_posting"),
  });
  return NextResponse.json(summary);
}
