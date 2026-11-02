import type { ResolvedTikTokVideo, VideoCandidate } from "@/lib/domain/contracts";

import type { HttpFetch } from "./http";
import type { TikTokVideoLink } from "./links";

/**
 * One third-party TikTok data vendor. The live TikTokDataProvider handles
 * link parsing, short-link resolution, proxy routing and contract validation;
 * a backend only talks to its vendor and maps the payload.
 *
 * Add a vendor: implement this, register it in `backends` (./live.ts) and set
 * TIKTOK_DATA_PROVIDER to its id.
 */
export interface TikTokDataBackend {
  readonly id: string;
  fetchVideo(http: HttpFetch, link: TikTokVideoLink): Promise<ResolvedTikTokVideo>;
  searchVideos(
    http: HttpFetch,
    input: { query: string; country?: string; limit: number },
  ): Promise<VideoCandidate[]>;
}

export type TikTokDataBackendFactory = (config: {
  apiKey: string;
  baseUrl?: string;
}) => TikTokDataBackend;
