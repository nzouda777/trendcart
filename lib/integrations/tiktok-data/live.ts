import "server-only";

import {
  callContextSchema,
  IntegrationError,
  resolvedTikTokVideoSchema,
  videoCandidateSchema,
  type CallContext,
  type TikTokDataProvider,
} from "@/lib/domain/contracts";

import { createHttpClient, type HttpFetch } from "./http";
import { parseTikTokUrl, resolveShortLink } from "./links";
import { createScrapeCreatorsBackend } from "./scrapecreators";
import type { TikTokDataBackend, TikTokDataBackendFactory } from "./types";

/** Vendors selectable with TIKTOK_DATA_PROVIDER. */
export const backends: Record<string, TikTokDataBackendFactory> = {
  scrapecreators: createScrapeCreatorsBackend,
};
export const DEFAULT_TIKTOK_DATA_PROVIDER = "scrapecreators";

export const SEARCH_LIMIT_DEFAULT = 12;
export const SEARCH_LIMIT_MAX = 50;

export type LiveTikTokDataOptions = {
  /** Overrides the env-selected backend (tests). */
  backend?: TikTokDataBackend;
  /** Base fetch under the proxy wrapper (tests). */
  fetch?: HttpFetch;
  env?: Partial<Record<string, string | undefined>>;
};

function backendFromEnv(env: Partial<Record<string, string | undefined>>): TikTokDataBackend {
  const id = (env.TIKTOK_DATA_PROVIDER || DEFAULT_TIKTOK_DATA_PROVIDER).trim().toLowerCase();
  const factory = backends[id];
  if (!factory) {
    throw new IntegrationError(
      "tiktok-data",
      "invalid_input",
      `Unknown TIKTOK_DATA_PROVIDER "${id}".`,
      {
        retryable: false,
      },
    );
  }
  const apiKey = env.TIKTOK_DATA_PROVIDER_KEY;
  if (!apiKey) {
    throw new IntegrationError(
      "tiktok-data",
      "permission_denied",
      "TIKTOK_DATA_PROVIDER_KEY is not set.",
      {
        retryable: false,
      },
    );
  }
  return factory({ apiKey });
}

export function createLiveTikTokDataProvider(
  options: LiveTikTokDataOptions = {},
): TikTokDataProvider {
  let backend = options.backend;
  // Resolved lazily so builds and mock-mode imports never need the key.
  const getBackend = () => (backend ??= backendFromEnv(options.env ?? process.env));
  const http = (ctx: CallContext) =>
    createHttpClient(callContextSchema.parse(ctx), { fetch: options.fetch });

  return {
    async resolveVideo(ctx, url) {
      const fetch = http(ctx);
      const parsed = parseTikTokUrl(url);
      const link = parsed.kind === "short" ? await resolveShortLink(parsed, fetch) : parsed;
      const video = await getBackend().fetchVideo(fetch, link);
      return resolvedTikTokVideoSchema.parse(video);
    },

    async searchVideos(ctx, input) {
      const query = input.query.trim();
      if (!query) {
        throw new IntegrationError("tiktok-data", "invalid_input", "Search query is empty.", {
          retryable: false,
        });
      }
      const limit = Math.min(
        Math.max(1, Math.floor(input.limit ?? SEARCH_LIMIT_DEFAULT)),
        SEARCH_LIMIT_MAX,
      );
      const results = await getBackend().searchVideos(http(ctx), {
        query: query.slice(0, 200),
        country: input.country,
        limit,
      });
      return results.map((c) => videoCandidateSchema.parse(c));
    },
  };
}
