import { NextResponse } from "next/server";

import { PENDING_IMAGE_TTL_DAYS } from "@/lib/media/images";
import { purgePendingImagesBefore } from "@/lib/tenant/system";

import { isAuthorizedCron } from "../tiktok-token-refresh/refresh";

/**
 * GET /api/cron/purge-images — Vercel Cron (daily). Deletes uploaded images
 * that waited more than PENDING_IMAGE_TTL_DAYS for a Shopify page (Trendcart
 * keeps no files). Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const before = new Date(Date.now() - PENDING_IMAGE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await purgePendingImagesBefore(before);
  return NextResponse.json({ deleted });
}
