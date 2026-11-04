/**
 * Step "prepare_campaign" (preparing_campaign → ready_to_launch, GATE 4).
 *
 * 1. Reads the GATE 3 videos choice (approved videos + TikTok Ads account)
 *    and the published Shopify page (landing URL).
 * 2. Uploads each approved video to TikTok Ads by URL from its Shopify file
 *    URL, once per advertiser (`video.tiktok_video_ids`), saved after each
 *    upload so a retry only uploads what is missing.
 * 3. Builds the CampaignSpec from the brand defaults and the page copy ad
 *    texts (lib/workflows/campaign-spec), records the `campaign` row
 *    ("creating") before calling TikTok, then createPausedCampaign: the
 *    campaign, ad group and ads are all created DISABLED. Ids and config are
 *    stored and the row is "paused". Nothing spends before the GATE 4
 *    approval and the launch service.
 *
 * Idempotent: a campaign row already "paused" with TikTok ids ends the step
 * without any call. A crash between the TikTok call and the row update
 * re-runs the creation with the same spec (same deterministic name).
 */
import { and, eq, inArray } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { IntegrationError, pageCopySchema } from "@/lib/domain/contracts";
import {
  brand,
  campaign,
  shopifyConnection,
  shopifyProduct,
  tiktokAdConnection,
  video,
} from "@/lib/db/schema";
import { ensureTikTokAdsVideo } from "@/lib/media/videos";
import { ServiceError } from "@/lib/services/errors";
import {
  getTikTokAdsCredentials,
  markConnectionNeedsReauth,
} from "@/lib/services/internal/credentials";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { buildCampaignSpec } from "../campaign-spec";
import { loadSupplierChoice, loadVideosChoice } from "../gate-payloads";

import type { StepDefinition } from "./types";

function fatal(message: string): never {
  throw new IntegrationError("workflow", "invalid_input", message, { retryable: false });
}

/** TikTok Ads credentials, or a non-retryable error the user can act on. */
async function adsCredentials(ctx: WorkspaceContext, connectionId: string) {
  try {
    return await getTikTokAdsCredentials(ctx, connectionId);
  } catch (error) {
    if (error instanceof ServiceError) fatal(error.message);
    throw error;
  }
}

/** Marks the ad connection red when TikTok says the token is gone, then rethrows. */
async function onAdsError(
  ctx: WorkspaceContext,
  connectionId: string,
  error: unknown,
): Promise<never> {
  if (error instanceof IntegrationError && error.code === "auth_expired") {
    await markConnectionNeedsReauth(ctx, "tiktok_ads", connectionId, error.message);
  }
  throw error;
}

/** Published page URL of the product on the store chosen at GATE 2. */
async function landingPageUrl(ctx: WorkspaceContext, productId: string): Promise<string> {
  const choice = await loadSupplierChoice(ctx.db, productId);
  if (!choice) fatal("No store was chosen for this product (GATE 2).");
  const page = await ctx.db.findFirst(
    shopifyProduct,
    and(
      eq(shopifyProduct.productId, productId),
      eq(shopifyProduct.connectionId, choice.shopifyConnectionId),
    ),
  );
  if (!page || page.status !== "active") fatal("The product page is not published on Shopify.");
  if (page.storefrontUrl) return page.storefrontUrl;
  const store = await ctx.db.getById(shopifyConnection, choice.shopifyConnectionId);
  return `https://${store.shopDomain}/products/${page.handle}`;
}

export const prepareCampaignStep: StepDefinition = {
  step: "prepare_campaign",
  limit: "upload",

  async run(env, row) {
    const { ctx, integrations } = env;
    const choice = await loadVideosChoice(ctx.db, row.id);
    if (!choice) fatal("No videos were approved for this product (GATE 3).");
    const connection = await ctx.db.findById(tiktokAdConnection, choice.adConnectionId);
    if (!connection || connection.brandId !== row.brandId) {
      fatal("The TikTok Ads account chosen at GATE 3 is no longer connected to this brand.");
    }

    // Already prepared: nothing to do.
    const existing = await ctx.db.findFirst(
      campaign,
      and(eq(campaign.productId, row.id), eq(campaign.adConnectionId, connection.id)),
    );
    if (existing?.tiktokIds && existing.status !== "creating" && existing.status !== "draft") {
      return {};
    }

    const creds = await adsCredentials(ctx, connection.id);
    const landing = await landingPageUrl(ctx, row.id);
    const brandRow = await ctx.db.getById(brand, row.brandId);
    const copy = row.pageCopy ? pageCopySchema.parse(row.pageCopy) : null;

    // 2. Videos on TikTok Ads, in the order they were approved.
    const rows = await ctx.db.select(video, {
      where: and(
        eq(video.productId, row.id),
        inArray(video.id, choice.videoIds),
        eq(video.approval, "approved"),
      ),
    });
    const ordered = choice.videoIds
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => !!r);
    if (ordered.length === 0) fatal("The approved videos are gone. Approve videos again.");

    const videos: { id: string; tiktokVideoId: string }[] = [];
    for (const v of ordered) {
      const result = await ensureTikTokAdsVideo({ integrations, creds, video: v }).catch((e) =>
        onAdsError(ctx, connection.id, e),
      );
      if (result.uploaded) {
        await ctx.db.update(video, { tiktokVideoIds: result.tiktokVideoIds }, eq(video.id, v.id));
      }
      videos.push({ id: v.id, tiktokVideoId: result.videoId });
    }

    // 3. The paused campaign.
    const spec = buildCampaignSpec({
      productId: row.id,
      productName: row.name ?? row.analysis?.productName ?? null,
      brand: {
        name: brandRow.name,
        country: brandRow.country,
        defaultTestBudget: brandRow.defaultTestBudget,
      },
      landingPageUrl: landing,
      adTexts: copy?.adTexts ?? [],
      videos,
    });
    const record = existing
      ? (
          await ctx.db.update(
            campaign,
            { config: spec, status: "creating" },
            eq(campaign.id, existing.id),
          )
        )[0]!
      : await ctx.db.insert(campaign, {
          productId: row.id,
          adConnectionId: connection.id,
          config: spec,
          status: "creating",
        });

    const ids = await integrations.tiktokAds
      .createPausedCampaign(creds, spec)
      .catch((e) => onAdsError(ctx, connection.id, e));

    await ctx.db.transaction(async (tx) => {
      await tx.update(campaign, { tiktokIds: ids, status: "paused" }, eq(campaign.id, record.id));
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "campaign.create",
          targetType: "campaign",
          targetId: record.id,
          metadata: {
            productId: row.id,
            adConnectionId: connection.id,
            advertiserId: connection.advertiserId,
            campaignId: ids.campaignId,
            ads: videos.length,
            budget: spec.budget,
            status: "paused",
          },
        },
      );
    });
    return {};
  },
};
