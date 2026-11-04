import { z } from "zod";

import {
  campaignSpecSchema,
  IntegrationError,
  type CampaignSpec,
  type TikTokIdentity,
} from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";
import { locationIdFor } from "./geo";
import { requestIdFor } from "./http";

/*
 * CampaignSpec → Marketing API v1.3 payloads (campaign/create,
 * adgroup/create, ad/create). Shared by live and mock so both reject the
 * same specs. Mapping (TikTok enums as documented for v1.3):
 *
 * - objective WEB_CONVERSIONS: optimization_goal CONVERT, billing OCPM,
 *   pixel_id + optimization_event required. TRAFFIC: CLICK, billing CPC.
 * - bid lowest_cost: BID_TYPE_NO_BID. cost_cap: BID_TYPE_CUSTOM with
 *   conversion_bid_price (CONVERT) or bid_price (CLICK).
 * - budget level "campaign": campaign budget + budget_optimize_on (CBO);
 *   level "ad_group": campaign BUDGET_MODE_INFINITE, budget per ad group.
 *   Daily: SCHEDULE_FROM_NOW. Total: SCHEDULE_START_END over
 *   TOTAL_BUDGET_DAYS (the spec has no end date yet).
 * - placements: TikTok only (PLACEMENT_TYPE_NORMAL + PLACEMENT_TIKTOK),
 *   promotion_type WEBSITE, countries → location_ids (geo.ts).
 *
 * THE INVARIANT: every create payload carries operation_status DISABLE.
 * TikTok defaults operation_status to ENABLE when it is omitted, so
 * assertCreatesDisabled() runs on every payload right before it is sent.
 */

export const DISABLED = "DISABLE" as const;
export const TOTAL_BUDGET_DAYS = 7;

export type ParsedCampaignSpec = z.output<typeof campaignSpecSchema>;
type ParsedAdGroup = ParsedCampaignSpec["adGroups"][number];
type ParsedAd = ParsedAdGroup["ads"][number];

function invalid(message: string): never {
  throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", message, { retryable: false });
}

const AGE_GROUP = /^AGE_[0-9A-Z_]+$/;
const CTA = /^[A-Z][A-Z_]*$/;

/** Contract parse plus the rules TikTok enforces; throws invalid_input. */
export function validateSpecForTikTok(raw: CampaignSpec): ParsedCampaignSpec {
  const parsed = campaignSpecSchema.safeParse(raw);
  if (!parsed.success) invalid(`Invalid campaign spec: ${parsed.error.issues[0]?.message ?? ""}`);
  const spec = parsed.data;

  if (!spec.landingPageUrl.startsWith("https://")) invalid("The landing page must use https.");
  if (spec.objective === "WEB_CONVERSIONS" && (!spec.pixelId || !spec.optimizationEvent)) {
    invalid("Website conversion campaigns need a pixel and an optimization event.");
  }
  const groupNames = new Set<string>();
  for (const g of spec.adGroups) {
    if (groupNames.has(g.name)) invalid(`Duplicate ad group name "${g.name}".`);
    groupNames.add(g.name);
    for (const c of g.countries) {
      if (!locationIdFor(c)) invalid(`Country ${c} is not supported for TikTok targeting yet.`);
    }
    for (const a of g.ageGroups ?? []) {
      if (!AGE_GROUP.test(a)) invalid(`Unknown age group "${a}" (expected AGE_18_24 style).`);
    }
    if (g.bidStrategy === "cost_cap" && !g.bidAmount) {
      invalid(`Ad group "${g.name}" uses cost cap bidding without a bid amount.`);
    }
    const adNames = new Set<string>();
    for (const ad of g.ads) {
      if (adNames.has(ad.name)) invalid(`Duplicate ad name "${ad.name}" in "${g.name}".`);
      adNames.add(ad.name);
      if (!CTA.test(ad.callToAction)) invalid(`Unknown call to action "${ad.callToAction}".`);
    }
  }
  return spec;
}

/** "YYYY-MM-DD HH:MM:SS" in UTC, the Marketing API datetime format. */
export function tiktokDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function budgetMode(mode: "daily" | "total") {
  return mode === "daily" ? "BUDGET_MODE_DAY" : "BUDGET_MODE_TOTAL";
}

export function campaignCreateBody(advertiserId: string, spec: ParsedCampaignSpec) {
  const cbo = spec.budget.level === "campaign";
  return {
    advertiser_id: advertiserId,
    campaign_name: spec.name,
    objective_type: spec.objective,
    operation_status: DISABLED,
    request_id: requestIdFor("campaign", advertiserId, spec.name),
    budget_optimize_on: cbo,
    budget_mode: cbo ? budgetMode(spec.budget.mode) : "BUDGET_MODE_INFINITE",
    ...(cbo ? { budget: spec.budget.amount } : {}),
  };
}

export function adGroupCreateBody(
  advertiserId: string,
  campaignId: string,
  spec: ParsedCampaignSpec,
  group: ParsedAdGroup,
  now: Date,
) {
  const conversions = spec.objective === "WEB_CONVERSIONS";
  const perGroupBudget = spec.budget.level === "ad_group";
  const total = spec.budget.mode === "total";
  const bid =
    group.bidStrategy === "cost_cap"
      ? {
          bid_type: "BID_TYPE_CUSTOM",
          ...(conversions
            ? { conversion_bid_price: group.bidAmount }
            : { bid_price: group.bidAmount }),
        }
      : { bid_type: "BID_TYPE_NO_BID" };
  return {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: group.name,
    operation_status: DISABLED,
    request_id: requestIdFor("adgroup", advertiserId, campaignId, group.name),
    promotion_type: "WEBSITE",
    placement_type: "PLACEMENT_TYPE_NORMAL",
    placements: ["PLACEMENT_TIKTOK"],
    location_ids: group.countries.map((c) => locationIdFor(c)!),
    gender:
      group.gender === "male"
        ? "GENDER_MALE"
        : group.gender === "female"
          ? "GENDER_FEMALE"
          : "GENDER_UNLIMITED",
    ...(group.ageGroups?.length ? { age_groups: group.ageGroups } : {}),
    budget_mode: budgetMode(spec.budget.mode),
    ...(perGroupBudget ? { budget: spec.budget.amount } : {}),
    schedule_type: total ? "SCHEDULE_START_END" : "SCHEDULE_FROM_NOW",
    schedule_start_time: tiktokDateTime(now),
    ...(total
      ? {
          schedule_end_time: tiktokDateTime(
            new Date(now.getTime() + TOTAL_BUDGET_DAYS * 86_400_000),
          ),
        }
      : {}),
    pacing: "PACING_MODE_SMOOTH",
    optimization_goal: conversions ? "CONVERT" : "CLICK",
    billing_event: conversions ? "OCPM" : "CPC",
    ...(conversions ? { pixel_id: spec.pixelId, optimization_event: spec.optimizationEvent } : {}),
    ...bid,
  };
}

/** Identity resolved against the advertiser before the ad is created. */
export type ResolvedIdentity =
  | { type: "custom"; identityId: string; videoId: string; coverImageId: string }
  | { type: "spark"; identityId: string; tiktokItemId: string };

export function adCreateBody(
  advertiserId: string,
  adGroupId: string,
  spec: ParsedCampaignSpec,
  ad: ParsedAd,
  identity: ResolvedIdentity,
) {
  const media =
    identity.type === "custom"
      ? {
          identity_type: "CUSTOMIZED_USER",
          identity_id: identity.identityId,
          video_id: identity.videoId,
          image_ids: [identity.coverImageId],
        }
      : {
          identity_type: "AUTH_CODE",
          identity_id: identity.identityId,
          tiktok_item_id: identity.tiktokItemId,
        };
  return {
    advertiser_id: advertiserId,
    adgroup_id: adGroupId,
    creatives: [
      {
        ad_name: ad.name,
        ad_format: "SINGLE_VIDEO",
        ad_text: ad.adText,
        call_to_action: ad.callToAction,
        landing_page_url: spec.landingPageUrl,
        operation_status: DISABLED,
        ...media,
      },
    ],
  };
}

/** Identity key used to share one resolved identity between ads. */
export function identityKey(identity: TikTokIdentity): string {
  return identity.type === "custom"
    ? `custom:${identity.displayName}:${identity.avatarUrl ?? ""}`
    : `spark:${identity.authCode}`;
}

export class CreatedEnabledError extends IntegrationError {
  constructor(message: string) {
    super(TIKTOK_ADS_PROVIDER, "provider_error", message, { retryable: false });
    this.name = "CreatedEnabledError";
  }
}

/**
 * The never-spend guard. Throws unless a create payload (campaign, ad group
 * or ad with all its creatives) is explicitly DISABLE.
 */
export function assertCreatesDisabled(kind: "campaign" | "adgroup" | "ad", body: unknown): void {
  const b = body as { operation_status?: unknown; creatives?: { operation_status?: unknown }[] };
  const statuses =
    kind === "ad" ? (b.creatives ?? []).map((c) => c.operation_status) : [b.operation_status];
  if (statuses.length === 0 || statuses.some((s) => s !== DISABLED)) {
    throw new CreatedEnabledError(`Refusing to create a ${kind} that is not DISABLE.`);
  }
}
