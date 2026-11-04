import { NextResponse } from "next/server";

import { getIntegrations } from "@/lib/integrations";
import { syncAllCampaignStats } from "@/lib/services/internal/campaign-stats";
import { getSystemContext, listLaunchedCampaigns } from "@/lib/tenant/system";

import { isAuthorizedCron } from "../tiktok-token-refresh/refresh";

/** Seconds (Vercel Pro); the sync itself stops starting campaigns after 240 s. */
export const maxDuration = 300;

/**
 * GET /api/cron/tiktok-stats — Vercel Cron (hourly). Requires
 * `Authorization: Bearer $CRON_SECRET`; refuses everything when unset.
 * Syncs campaign_stats_hourly for launched campaigns, one system context per
 * workspace, least recently synced first, within a 240 s run budget
 * (STATS_RUN_BUDGET_MS) so the function ends under `maxDuration`.
 * The cross-workspace scan (ids only) is `listLaunchedCampaigns`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await syncAllCampaignStats({
    scan: (input, db) => listLaunchedCampaigns(input, db),
    ads: getIntegrations().tiktokAds,
    context: (workspaceId) => getSystemContext(workspaceId, "cron:tiktok-stats"),
  });
  return NextResponse.json(summary);
}
