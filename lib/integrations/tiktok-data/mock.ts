import {
  IntegrationError,
  resolvedTikTokVideoSchema,
  videoCandidateSchema,
  type ResolvedTikTokVideo,
  type TikTokDataProvider,
  type VideoCandidate,
} from "@/lib/domain/contracts";
import {
  fnv1a,
  matchSampleProduct,
  pickSampleProduct,
  SAMPLE_PRODUCTS,
  SAMPLE_VIDEO_URL,
  sampleImageUrl,
  type SampleProduct,
} from "@/lib/ai/sample-products";

import { canonicalVideoUrl, parseTikTokUrl } from "./links";

/**
 * Deterministic TikTok data: any valid TikTok link resolves to one of the
 * sample products (picked from the video id), search returns candidates for
 * the sample product the query matches best. No network.
 *
 * The mock media URL carries `tc_mock=<product key>` so the mock analyzer
 * identifies the same product.
 */
export const MOCK_CREATORS = [
  { username: "homefinds.daily", displayName: "Home Finds Daily" },
  { username: "gadget.unboxed", displayName: "Gadget Unboxed" },
  { username: "mia.kitchen", displayName: "Mia in the Kitchen" },
  { username: "carsetup.club", displayName: "Car Setup Club" },
  { username: "dealsbyleo", displayName: "Deals by Leo" },
];

const DIMENSIONS: [number, number][] = [
  [1080, 1920],
  [720, 1280],
  [1080, 1920],
  [1080, 1080],
];

/** 19-digit TikTok-like id from a seed. */
export function mockVideoId(seed: string): string {
  const a = fnv1a(seed).toString().padStart(10, "0");
  const b = fnv1a(`${seed}:b`).toString().padStart(10, "0").slice(0, 7);
  return `74${a}${b}`.slice(0, 19);
}

export function productForVideoId(videoId: string): SampleProduct {
  return pickSampleProduct(videoId);
}

function candidateFor(product: SampleProduct, videoId: string, username?: string): VideoCandidate {
  const h = fnv1a(videoId);
  const creator = MOCK_CREATORS[h % MOCK_CREATORS.length]!;
  const user = username ?? creator.username;
  const views = 20_000 + (h % 4_800_000);
  return videoCandidateSchema.parse({
    tiktokUrl: canonicalVideoUrl(videoId, user),
    tiktokVideoId: videoId,
    author: { username: user, displayName: username ? undefined : creator.displayName },
    caption: product.captions[h % product.captions.length]!,
    thumbnailUrl: sampleImageUrl(`tc-${videoId}`, 540, 960),
    stats: {
      views,
      likes: Math.floor(views * 0.08),
      comments: Math.floor(views * 0.004),
      shares: Math.floor(views * 0.012),
    },
    durationSec: 9 + (h % 52),
    postedAt: new Date(Date.UTC(2026, 8, 1) + (h % 50) * 86_400_000).toISOString(),
  });
}

export type MockTikTokDataOptions = { now?: () => Date };

export function createMockTikTokDataProvider(
  options: MockTikTokDataOptions = {},
): TikTokDataProvider {
  const now = options.now ?? (() => new Date());

  return {
    async resolveVideo(_ctx, url): Promise<ResolvedTikTokVideo> {
      const link = parseTikTokUrl(url);
      const videoId = link.kind === "video" ? link.videoId : mockVideoId(link.code);
      const username = link.kind === "video" ? (link.username ?? undefined) : undefined;
      if (videoId.endsWith("0000000")) {
        // Lets the UI and workflow exercise the "not found" path.
        throw new IntegrationError("tiktok-data", "not_found", "Video not found or not public.", {
          retryable: false,
        });
      }
      const product = productForVideoId(videoId);
      const candidate = candidateFor(product, videoId, username);
      const [width, height] = DIMENSIONS[fnv1a(videoId) % DIMENSIONS.length]!;
      return resolvedTikTokVideoSchema.parse({
        ...candidate,
        mediaUrl: `${SAMPLE_VIDEO_URL}?tc_mock=${product.key}&id=${videoId}`,
        mediaUrlExpiresAt: new Date(now().getTime() + 6 * 3_600_000).toISOString(),
        width,
        height,
      });
    },

    async searchVideos(_ctx, input) {
      const query = input.query.trim();
      if (!query) {
        throw new IntegrationError("tiktok-data", "invalid_input", "Search query is empty.", {
          retryable: false,
        });
      }
      const product = matchSampleProduct(query);
      const limit = Math.min(Math.max(1, input.limit ?? 12), 50);
      // Only ids whose product matches, so every candidate shows the same product.
      const out: VideoCandidate[] = [];
      for (let i = 0; out.length < limit && i < limit * SAMPLE_PRODUCTS.length * 4; i++) {
        const id = mockVideoId(`${product.key}:${input.country ?? "any"}:${i}`);
        if (productForVideoId(id).key === product.key) out.push(candidateFor(product, id));
      }
      return out;
    },
  };
}
