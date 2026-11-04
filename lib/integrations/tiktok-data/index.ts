import type { IntegrationsMode, TikTokDataProvider } from "@/lib/domain/contracts";

import { createLiveTikTokDataProvider, type LiveTikTokDataOptions } from "./live";
import { createMockTikTokDataProvider } from "./mock";

export {
  canonicalVideoUrl,
  isTikTokHost,
  parseTikTokUrl,
  resolveShortLink,
  tryParseTikTokUrl,
  type TikTokLink,
  type TikTokShortLink,
  type TikTokVideoLink,
} from "./links";
export { createHttpClient, selectDispatcher, type HttpFetch } from "./http";
export { DEFAULT_TIKTOK_DATA_PROVIDER, backends as tiktokDataBackends } from "./live";
export type { TikTokDataBackend } from "./types";
/** Expiry of a signed TikTok CDN URL (media or thumbnail), from its x-expires param. */
export { mediaExpiry as signedUrlExpiresAt } from "./scrapecreators";
export {
  assertPublicHostname,
  assertPublicHostResolves,
  BlockedAddressError,
  isPublicHostname,
  isPublicIp,
} from "./net-guard";
export { PROXY_SCHEMES, proxyKind } from "./http";
export {
  buildRelatedSearchQueries,
  durationFitScore,
  engagementScore,
  findRelatedVideos,
  rankRelatedCandidates,
  recencyScore,
  relevanceScore,
  RANK_WEIGHTS,
  RELATED_DEFAULTS,
  type FindRelatedInput,
  type FindRelatedResult,
  type RankedCandidate,
  type SearchResult,
} from "./related";

/** Registry factory (see lib/integrations/index.ts). */
export function createTikTokDataProvider(
  mode: IntegrationsMode,
  options?: LiveTikTokDataOptions,
): TikTokDataProvider {
  return mode === "live" ? createLiveTikTokDataProvider(options) : createMockTikTokDataProvider();
}
