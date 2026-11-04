/**
 * M3 QA helpers: recording wrappers around the mock TikTok Ads and TikTok
 * Posting adapters, TikTok profile connection through the real callback
 * helper, and shortcuts to drive a product to GATE 3 (page approved), GATE 4
 * and "launched" through the real services in INTEGRATIONS_MODE=mock.
 *
 * Tests only. Never import from app code.
 */
import { openOAuthState, sealOAuthState } from "@/lib/auth/oauth-state";
import type { Integrations, TikTokAdsClient, TikTokPostingClient } from "@/lib/domain/contracts";
import type { MockTikTokAdsClient } from "@/lib/integrations/tiktok-ads/mock";
import {
  approvePage,
  approveVideo,
  approveVideos,
  getProductPipeline,
  launchCampaign,
  type ServiceDeps,
} from "@/lib/services";
import { updateBrand } from "@/lib/services/brands";
import type { UserWorkspaceContext } from "@/lib/tenant/context";
import { completeProfileConnection } from "@/app/api/tiktok/_lib/connect";

import { copyVersionOf, toGate3 } from "./m2";
import { connectTikTokAdsMock, type Tenant } from "./world";

export const LOGIN_REDIRECT_URI = "http://localhost:3000/api/tiktok/login/callback";

export type AdsCall = { method: string; advertiserId: string | null; args: unknown[] };
export type PostingCall = { method: string; args: unknown[] };

type Hook = (original: (...a: unknown[]) => unknown, ...args: unknown[]) => unknown;

function recorder<T extends object>(
  target: T,
  push: (name: string, args: unknown[]) => void,
  hooks: Partial<Record<string, Hook>>,
): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const name = String(prop);
      return (...args: unknown[]) => {
        push(name, args);
        const original = (value as (...a: unknown[]) => unknown).bind(t);
        const hook = hooks[name];
        return hook ? hook(original, ...args) : original(...args);
      };
    },
  });
}

/**
 * Same integrations, with tiktokAds and tiktokPosting wrapped: every call is
 * recorded (Ads calls with the advertiser id of their credentials). `hooks`
 * can intercept a method (races, failures).
 */
export function recordTikTok(
  base: Integrations,
  hooks: {
    ads?: Partial<Record<keyof TikTokAdsClient, Hook>>;
    posting?: Partial<Record<keyof TikTokPostingClient, Hook>>;
  } = {},
) {
  const adsCalls: AdsCall[] = [];
  const postingCalls: PostingCall[] = [];
  const tiktokAds = recorder(
    base.tiktokAds,
    (method, args) => {
      const creds = args[0] as { advertiserId?: unknown } | undefined;
      adsCalls.push({
        method,
        advertiserId: typeof creds?.advertiserId === "string" ? creds.advertiserId : null,
        args,
      });
    },
    hooks.ads ?? {},
  );
  const tiktokPosting = recorder(
    base.tiktokPosting,
    (method, args) => postingCalls.push({ method, args }),
    hooks.posting ?? {},
  );
  const integrations: Integrations = { ...base, tiktokAds, tiktokPosting };
  return {
    integrations,
    adsCalls,
    postingCalls,
    /** Operation status of a mock entity (DISABLE / ENABLE). */
    statusOf: (id: string) => (base.tiktokAds as MockTikTokAdsClient).statusOf(id),
  };
}

/** Login Kit start + (mock) TikTok redirect + callback, like the two routes. */
export async function connectTikTokProfileMock(
  ctx: UserWorkspaceContext,
  integrations: Integrations,
  brandId: string,
) {
  const { state, sealed } = sealOAuthState("tiktok_login", {
    workspaceId: ctx.workspaceId,
    userId: ctx.actor.userId,
    data: { brandId },
  });
  const flow = openOAuthState("tiktok_login", sealed, state);
  const authUrl = integrations.tiktokPosting.buildAuthUrl({
    state: flow.state,
    redirectUri: LOGIN_REDIRECT_URI,
  });
  const code = new URL(authUrl).searchParams.get("code") ?? "";
  return completeProfileConnection(ctx, {
    flow,
    code,
    redirectUri: LOGIN_REDIRECT_URI,
    client: integrations.tiktokPosting,
  });
}

/** Brand budget + both mock ad accounts + one TikTok profile for a tenant. */
export async function connectTikTok(t: Tenant, integrations: Integrations, budget = 30) {
  await updateBrand(t.owner, t.brandId, { defaultTestBudget: budget });
  const ads = await connectTikTokAdsMock(t.owner, integrations, t.brandId);
  const profile = await connectTikTokProfileMock(t.owner, integrations, t.brandId);
  return { ads: ads.connections, profile };
}

/** Import → GATE 1 → GATE 2 → build → GATE 3 with the page approved (published). */
export async function toGate3PageApproved(t: Tenant, url: string, deps: ServiceDeps) {
  const at3 = await toGate3(t, url, deps);
  await approvePage(
    t.creative,
    { productId: at3.id, copyVersion: await copyVersionOf(t.viewer, at3.id) },
    deps,
  );
  return getProductPipeline(t.viewer, at3.id);
}

/** Videos a reviewer may approve (checked, not failing). */
export function usableVideos(p: Awaited<ReturnType<typeof getProductPipeline>>) {
  return p.videos.filter(
    (v) => v.approval !== "rejected" && v.compliance && v.compliance.overall !== "fail",
  );
}

/** ... → GATE 3 (one video approved, videos part approved on `adConnectionId`) → GATE 4. */
export async function toGate4(t: Tenant, url: string, deps: ServiceDeps, adConnectionId: string) {
  const at3 = await toGate3PageApproved(t, url, deps);
  const [first] = usableVideos(at3);
  if (!first) throw new Error("No usable video at GATE 3.");
  await approveVideo(t.creative, { productId: at3.id, videoId: first.id }, deps);
  return approveVideos(t.mediaBuyer, { productId: at3.id, adConnectionId }, deps);
}

/** ... → GATE 4 → launched (media buyer). */
export async function toLaunched(
  t: Tenant,
  url: string,
  deps: ServiceDeps,
  adConnectionId: string,
) {
  const at4 = await toGate4(t, url, deps, adConnectionId);
  return launchCampaign(t.mediaBuyer, { productId: at4.id }, deps);
}
