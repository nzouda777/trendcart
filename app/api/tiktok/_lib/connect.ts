import "server-only";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/guards";
import { OAuthStateError, type OAuthFlow } from "@/lib/auth/oauth-state";
import { brand, tiktokAdConnection, tiktokProfileConnection } from "@/lib/db/schema";
import {
  IntegrationError,
  type TikTokAdsClient,
  type TikTokPostingClient,
} from "@/lib/domain/contracts";
import { saveTikTokAdConnections, saveTikTokProfileConnection } from "@/lib/services/connections";
import type { UserWorkspaceContext, WorkspaceContext } from "@/lib/tenant/context";

/*
 * Core of the TikTok connect callbacks, kept free of Next.js request APIs so
 * it can be tested against a real (PGlite) database. It verifies the flow,
 * talks to TikTok, then persists through lib/services/connections (the one
 * save path: encryption, upsert and audit live there).
 */

const flowDataSchema = z.object({ brandId: z.string().min(1).max(200) });

/** The flow must have been started by this user in this workspace. */
function assertFlowBelongsTo(ctx: UserWorkspaceContext, flow: OAuthFlow): { brandId: string } {
  if (flow.workspaceId !== ctx.workspaceId || flow.userId !== ctx.actor.userId) {
    throw new OAuthStateError("This connection was started from another session.");
  }
  const data = flowDataSchema.safeParse(flow.data);
  if (!data.success) throw new OAuthStateError("Invalid OAuth flow.");
  return data.data;
}

/** Start routes: role and brand checks before redirecting to TikTok. */
export async function assertCanConnect(ctx: WorkspaceContext, brandId: string): Promise<void> {
  requirePermission(ctx, "connection:create");
  await ctx.db.getById(brand, brandId);
}

export type AdsConnectionResult = {
  brandId: string;
  connections: { id: string; advertiserId: string; name: string; created: boolean }[];
};

/** Ads callback: exchanges the code and stores one connection per granted advertiser. */
export async function completeAdsConnection(
  ctx: WorkspaceContext,
  input: { flow: OAuthFlow; code: string; client: TikTokAdsClient },
): Promise<AdsConnectionResult> {
  requirePermission(ctx, "connection:create");
  const { brandId } = assertFlowBelongsTo(ctx, input.flow);
  // Before any TikTok call: a smuggled brand id of another workspace is a 404.
  await ctx.db.getById(brand, brandId);

  const token = await input.client.exchangeAuthCode({ code: input.code });
  const listed = await input.client.listAdvertisers({ accessToken: token.accessToken });
  const granted = new Set(token.advertiserIds);
  const advertisers = granted.size > 0 ? listed.filter((a) => granted.has(a.advertiserId)) : listed;
  if (advertisers.length === 0) {
    throw new IntegrationError("tiktok_ads", "permission_denied", "No advertiser was granted.", {
      retryable: false,
    });
  }
  // B1: budgets are read in the advertiser's currency, so it must be known
  // (stored by saveTikTokAdConnections, compared with the brand's currency
  // before a campaign is prepared). Both adapters always return it.
  const noCurrency = advertisers.find((a) => !a.currency);
  if (noCurrency) {
    throw new IntegrationError(
      "tiktok_ads",
      "provider_error",
      `TikTok did not return the currency of advertiser ${noCurrency.advertiserId}; try connecting again.`,
    );
  }

  const known = new Set(
    (
      await ctx.db.select(tiktokAdConnection, {
        where: (t) =>
          inArray(
            t.advertiserId,
            advertisers.map((a) => a.advertiserId),
          ),
      })
    ).map((r) => r.advertiserId),
  );
  const saved = await saveTikTokAdConnections(ctx, {
    brandId,
    accessToken: token.accessToken,
    advertisers,
  });
  return {
    brandId,
    connections: saved.map((c) => ({
      id: c.id,
      advertiserId: c.advertiserId,
      name: c.name,
      created: !known.has(c.advertiserId),
    })),
  };
}

export type ProfileConnectionResult = {
  id: string;
  openId: string;
  displayName: string;
  created: boolean;
};

/** Login Kit callback: stores the profile with encrypted tokens, private posting by default. */
export async function completeProfileConnection(
  ctx: WorkspaceContext,
  input: { flow: OAuthFlow; code: string; redirectUri: string; client: TikTokPostingClient },
): Promise<ProfileConnectionResult> {
  requirePermission(ctx, "connection:create");
  const { brandId } = assertFlowBelongsTo(ctx, input.flow);
  await ctx.db.getById(brand, brandId);

  const token = await input.client.exchangeAuthCode({
    code: input.code,
    redirectUri: input.redirectUri,
  });
  if (!token.scopes.includes("video.publish")) {
    throw new IntegrationError(
      "tiktok_posting",
      "permission_denied",
      "The publishing permission (video.publish) was not granted.",
      { retryable: false },
    );
  }
  const creator = await input.client.getCreatorInfo({ accessToken: token.accessToken });

  const existed =
    (await ctx.db.count(tiktokProfileConnection, (t) => eq(t.openId, token.openId))) > 0;
  // Direct Post is the schema default; TikTok keeps it private (SELF_ONLY)
  // until the app is audited. Not passed, so a reconnect keeps the chosen mode.
  const saved = await saveTikTokProfileConnection(ctx, {
    brandId,
    token,
    displayName: creator.displayName,
  });
  return {
    id: saved.id,
    openId: saved.openId,
    displayName: saved.displayName,
    created: !existed,
  };
}
