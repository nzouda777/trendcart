import "server-only";

/**
 * ScrapeCreators backend (https://docs.scrapecreators.com).
 *
 *   GET /v2/tiktok/video?url=<tiktok url>        1 credit
 *   GET /v1/tiktok/search/keyword?query=&region=&cursor=   1 credit per page
 *   Auth: header `x-api-key`.
 *
 * Both return TikTok's own "aweme" objects (aweme_detail / search_item_list[].aweme_info).
 * Media URLs are TikTok CDN links signed with `x-expires`: never persist them.
 */
import { z } from "zod";

import {
  IntegrationError,
  resolvedTikTokVideoSchema,
  videoCandidateSchema,
  type ResolvedTikTokVideo,
  type VideoCandidate,
} from "@/lib/domain/contracts";

import { httpStatusError, networkError, type HttpFetch } from "./http";
import { canonicalVideoUrl, type TikTokVideoLink } from "./links";
import type { TikTokDataBackend, TikTokDataBackendFactory } from "./types";

export const SCRAPECREATORS_BASE_URL = "https://api.scrapecreators.com";
const PROVIDER = "scrapecreators";
/** Search pages fetched at most per call (each page costs one credit). */
const MAX_SEARCH_PAGES = 3;

const urlList = z
  .looseObject({ url_list: z.array(z.string()).optional() })
  .optional()
  .nullable();

const playAddr = z
  .looseObject({
    url_list: z.array(z.string()).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .optional()
  .nullable();

const awemeSchema = z.looseObject({
  aweme_id: z.string(),
  desc: z.string().optional().nullable(),
  create_time: z.number().optional().nullable(),
  author: z
    .looseObject({ unique_id: z.string().optional(), nickname: z.string().optional().nullable() })
    .optional()
    .nullable(),
  statistics: z
    .looseObject({
      play_count: z.number().optional(),
      digg_count: z.number().optional(),
      comment_count: z.number().optional(),
      share_count: z.number().optional(),
    })
    .optional()
    .nullable(),
  video: z
    .looseObject({
      duration: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      has_watermark: z.boolean().optional(),
      cover: urlList,
      origin_cover: urlList,
      dynamic_cover: urlList,
      play_addr: playAddr,
      download_addr: playAddr,
      download_no_watermark_addr: playAddr,
      bit_rate: z
        .array(z.looseObject({ bit_rate: z.number().optional(), play_addr: playAddr }))
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
});
type Aweme = z.infer<typeof awemeSchema>;

const videoResponseSchema = z.looseObject({
  success: z.boolean().optional(),
  aweme_detail: awemeSchema.optional().nullable(),
});

const searchResponseSchema = z.looseObject({
  success: z.boolean().optional(),
  search_item_list: z
    .array(z.looseObject({ aweme_info: awemeSchema.optional().nullable() }))
    .optional()
    .nullable(),
  cursor: z.number().optional().nullable(),
  has_more: z.union([z.boolean(), z.number()]).optional().nullable(),
});

const first = (list: { url_list?: string[] } | null | undefined) =>
  list?.url_list?.find((u) => /^https:\/\//.test(u));

const count = (n: number | undefined) => (Number.isFinite(n) && n! > 0 ? Math.floor(n!) : 0);

/** HEIC/HEIF covers: Chrome, Firefox and most image tools (reverse image search) cannot read them. */
const isHeic = (url: string) => /\.hei[cf](?:[?#~]|$)/i.test(url);

/**
 * Best cover URL: the first https JPEG/WebP/PNG across cover, origin_cover
 * and dynamic_cover (TikTok lists a .heic and a .jpeg variant of each), else
 * the first https URL at all. Pure: exported for tests.
 */
export function pickCoverUrl(video: Aweme["video"]): string | undefined {
  const lists = [video?.cover, video?.origin_cover, video?.dynamic_cover];
  const urls = lists.flatMap((l) => l?.url_list ?? []).filter((u) => /^https:\/\//.test(u));
  return urls.find((u) => !isHeic(u)) ?? urls[0];
}

function toCandidate(aweme: Aweme): VideoCandidate | null {
  const username = aweme.author?.unique_id;
  const thumbnailUrl = pickCoverUrl(aweme.video);
  if (!username || !thumbnailUrl) return null;

  const candidate = {
    tiktokUrl: canonicalVideoUrl(aweme.aweme_id, username),
    tiktokVideoId: aweme.aweme_id,
    author: { username, displayName: aweme.author?.nickname ?? undefined },
    caption: aweme.desc ?? "",
    thumbnailUrl,
    stats: {
      views: count(aweme.statistics?.play_count),
      likes: count(aweme.statistics?.digg_count),
      comments: count(aweme.statistics?.comment_count),
      shares: count(aweme.statistics?.share_count),
    },
    // aweme `video.duration` is in milliseconds.
    durationSec: Math.max(0, (aweme.video?.duration ?? 0) / 1000),
    postedAt: aweme.create_time ? new Date(aweme.create_time * 1000).toISOString() : undefined,
  };
  const parsed = videoCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Picks a playable rendition, preferring no watermark, then the highest bitrate. */
export function pickRendition(
  video: NonNullable<Aweme["video"]>,
): { url: string; width?: number; height?: number } | null {
  const noWatermark = video.download_no_watermark_addr;
  const nw = first(noWatermark);
  if (nw) return { url: nw, width: noWatermark?.width, height: noWatermark?.height };

  const renditions = [...(video.bit_rate ?? [])].sort(
    (a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0),
  );
  for (const r of renditions) {
    const u = first(r.play_addr);
    if (u) return { url: u, width: r.play_addr?.width, height: r.play_addr?.height };
  }
  const play = first(video.play_addr);
  if (play) return { url: play, width: video.play_addr?.width, height: video.play_addr?.height };
  const dl = first(video.download_addr);
  if (dl)
    return { url: dl, width: video.download_addr?.width, height: video.download_addr?.height };
  return null;
}

/** TikTok CDN links carry `x-expires=<unix seconds>`. */
export function mediaExpiry(mediaUrl: string): string | undefined {
  try {
    const raw = new URL(mediaUrl).searchParams.get("x-expires");
    const seconds = raw ? Number(raw) : NaN;
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toISOString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function mapResolvedVideo(aweme: Aweme): ResolvedTikTokVideo {
  const candidate = toCandidate(aweme);
  const rendition = aweme.video ? pickRendition(aweme.video) : null;
  if (!candidate || !rendition) {
    throw new IntegrationError(
      PROVIDER,
      "not_found",
      "The provider returned no playable video for this link.",
      {
        retryable: false,
      },
    );
  }
  const width = rendition.width || aweme.video?.width;
  const height = rendition.height || aweme.video?.height;
  const parsed = resolvedTikTokVideoSchema.safeParse({
    ...candidate,
    mediaUrl: rendition.url,
    mediaUrlExpiresAt: mediaExpiry(rendition.url),
    width,
    height,
  });
  if (!parsed.success) {
    throw new IntegrationError(
      PROVIDER,
      "provider_error",
      "Unexpected video payload from the provider.",
      {
        cause: parsed.error,
        retryable: false,
      },
    );
  }
  return parsed.data;
}

export const createScrapeCreatorsBackend: TikTokDataBackendFactory = ({ apiKey, baseUrl }) => {
  const root = (baseUrl ?? SCRAPECREATORS_BASE_URL).replace(/\/$/, "");

  async function get<T>(
    http: HttpFetch,
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ) {
    const url = new URL(`${root}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res;
    try {
      res = await http(url, { headers: { "x-api-key": apiKey, accept: "application/json" } });
    } catch (error) {
      throw networkError(PROVIDER, error);
    }
    if (!res.ok) throw httpStatusError(PROVIDER, res.status, await res.text().catch(() => ""));
    const body = schema.safeParse(await res.json().catch(() => null));
    if (!body.success) {
      throw new IntegrationError(
        PROVIDER,
        "provider_error",
        "Unreadable response from the provider.",
        {
          cause: body.error,
        },
      );
    }
    return body.data;
  }

  const backend: TikTokDataBackend = {
    id: PROVIDER,

    async fetchVideo(http, link: TikTokVideoLink) {
      const body = await get(
        http,
        "/v2/tiktok/video",
        { url: link.canonicalUrl },
        videoResponseSchema,
      );
      if (!body.aweme_detail) {
        throw new IntegrationError(PROVIDER, "not_found", "Video not found or not public.", {
          retryable: false,
        });
      }
      return mapResolvedVideo(body.aweme_detail);
    },

    async searchVideos(http, { query, country, limit }) {
      const out = new Map<string, VideoCandidate>();
      let cursor: number | undefined;
      for (let page = 0; page < MAX_SEARCH_PAGES && out.size < limit; page++) {
        const params: Record<string, string> = { query };
        if (country) params.region = country.toUpperCase();
        if (cursor !== undefined) params.cursor = String(cursor);
        const body = await get(http, "/v1/tiktok/search/keyword", params, searchResponseSchema);
        const items = body.search_item_list ?? [];
        if (items.length === 0) break;
        // TikTok may return duplicates across pages: dedupe by video id.
        for (const item of items) {
          const c = item.aweme_info ? toCandidate(item.aweme_info) : null;
          if (c && !out.has(c.tiktokVideoId)) out.set(c.tiktokVideoId, c);
        }
        const more =
          body.has_more === undefined || body.has_more === null ? true : Boolean(body.has_more);
        if (!more || body.cursor == null || body.cursor === cursor) break;
        cursor = body.cursor;
      }
      return [...out.values()].slice(0, limit);
    },
  };
  return backend;
};
