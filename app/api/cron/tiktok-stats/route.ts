import { NextResponse } from "next/server";

import { getIntegrations } from "@/lib/integrations";
import { syncAllCampaignStats, type CampaignScanner } from "@/lib/services/internal/campaign-stats";
import * as tenantSystem from "@/lib/tenant/system";

import { isAuthorizedCron } from "../tiktok-token-refresh/refresh";

/**
 * GET /api/cron/tiktok-stats — Vercel Cron (hourly). Requires
 * `Authorization: Bearer $CRON_SECRET`; refuses everything when unset.
 * Syncs campaign_stats_hourly for launched campaigns, one system context per
 * workspace.
 *
 * The cross-workspace scan of launched campaigns (ids only) belongs to the
 * foundation layer (`listLaunchedCampaigns` in lib/tenant/system). Until it
 * exists, the route answers 503 "not_configured" instead of guessing.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scan = (tenantSystem as unknown as { listLaunchedCampaigns?: CampaignScanner })
    .listLaunchedCampaigns;
  if (!scan) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const summary = await syncAllCampaignStats({
    scan,
    ads: getIntegrations().tiktokAds,
    context: (workspaceId) => tenantSystem.getSystemContext(workspaceId, "cron:tiktok-stats"),
  });
  return NextResponse.json(summary);
}
