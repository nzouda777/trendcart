/**
 * TikTok link parsing and normalization (pure, except `resolveShortLink`).
 *
 * Accepted video forms:
 *   https://www.tiktok.com/@user/video/7412345678901234567(?query)
 *   https://www.tiktok.com/@user/photo/7412345678901234567
 *   https://m.tiktok.com/v/7412345678901234567.html
 *   https://www.tiktok.com/embed/v2/7412345678901234567
 *   tiktok.com/@user/video/... (scheme optional)
 * Short links (resolved over HTTP in live mode):
 *   https://vm.tiktok.com/ZMabc123/  https://vt.tiktok.com/ZSabc123/
 *   https://www.tiktok.com/t/ZTabc123/
 */
import { IntegrationError } from "@/lib/domain/contracts";

import type { HttpFetch } from "./http";

export type TikTokVideoLink = {
  kind: "video";
  videoId: string;
  /** Without the leading "@"; null when the URL form does not carry it. */
  username: string | null;
  /** Stable form stored in `video.tiktok_url` / `product.source_url`. */
  canonicalUrl: string;
};

export type TikTokShortLink = {
  kind: "short";
  code: string;
  shortUrl: string;
};

export type TikTokLink = TikTokVideoLink | TikTokShortLink;

const VIDEO_ID = /^\d{15,21}$/;
const USERNAME = /^[A-Za-z0-9._]{1,64}$/;
const SHORT_CODE = /^[A-Za-z0-9]{5,20}$/;
const SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const MAX_LENGTH = 2048;

function invalid(message: string): IntegrationError {
  return new IntegrationError("tiktok-link", "invalid_input", message, { retryable: false });
}

export function isTikTokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

/** Parses user input into a URL, adding https:// when the scheme is missing. */
export function toUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

export function canonicalVideoUrl(videoId: string, username: string | null): string {
  return username
    ? `https://www.tiktok.com/@${username}/video/${videoId}`
    : `https://m.tiktok.com/v/${videoId}.html`;
}

/** Returns the parsed link, or null when the input is not a TikTok video/short link. */
export function tryParseTikTokUrl(input: string): TikTokLink | null {
  const url = toUrl(input);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  if (url.username || url.password) return null;
  if (!isTikTokHost(url.hostname)) return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (SHORT_HOSTS.has(host)) {
    const code = segments[0];
    if (segments.length !== 1 || !code || !SHORT_CODE.test(code)) return null;
    return { kind: "short", code, shortUrl: `https://${host}/${code}/` };
  }

  // www.tiktok.com/t/<code>
  if (segments[0] === "t" && segments.length === 2) {
    const code = segments[1]!;
    if (!SHORT_CODE.test(code)) return null;
    return { kind: "short", code, shortUrl: `https://www.tiktok.com/t/${code}/` };
  }

  // /@user/video/<id> or /@user/photo/<id>
  if (
    segments.length >= 3 &&
    segments[0]!.startsWith("@") &&
    /^(video|photo)$/.test(segments[1]!)
  ) {
    const username = segments[0]!.slice(1);
    const videoId = segments[2]!;
    if (!VIDEO_ID.test(videoId)) return null;
    const user = USERNAME.test(username) ? username : null;
    return {
      kind: "video",
      videoId,
      username: user,
      canonicalUrl: canonicalVideoUrl(videoId, user),
    };
  }

  // m.tiktok.com/v/<id>.html
  if (segments[0] === "v" && segments.length === 2) {
    const videoId = segments[1]!.replace(/\.html$/, "");
    if (!VIDEO_ID.test(videoId)) return null;
    return {
      kind: "video",
      videoId,
      username: null,
      canonicalUrl: canonicalVideoUrl(videoId, null),
    };
  }

  // /embed/<id> or /embed/v2/<id>
  if (segments[0] === "embed") {
    const videoId = segments[segments.length - 1]!;
    if (!VIDEO_ID.test(videoId)) return null;
    return {
      kind: "video",
      videoId,
      username: null,
      canonicalUrl: canonicalVideoUrl(videoId, null),
    };
  }

  return null;
}

/** Like tryParseTikTokUrl but throws IntegrationError("invalid_input"). */
export function parseTikTokUrl(input: string): TikTokLink {
  const parsed = tryParseTikTokUrl(input);
  if (!parsed) {
    throw invalid(
      "Expected a TikTok video link (tiktok.com/@user/video/... or vm.tiktok.com/...).",
    );
  }
  return parsed;
}

const MAX_REDIRECTS = 5;

/**
 * Follows a short link's redirects (without fetching the final page) until a
 * video URL appears. Uses the caller's (proxied) fetch.
 */
export async function resolveShortLink(
  link: TikTokShortLink,
  fetch: HttpFetch,
): Promise<TikTokVideoLink> {
  let current = link.shortUrl;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        accept: "text/html",
      },
    });
    // Never read the body: we only need the Location header.
    await res.body?.cancel().catch(() => undefined);

    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      if (res.status === 404) {
        throw new IntegrationError(
          "tiktok-link",
          "not_found",
          "This TikTok short link does not exist.",
        );
      }
      break;
    }
    const next = new URL(location, current);
    if (!isTikTokHost(next.hostname)) break;
    const parsed = tryParseTikTokUrl(next.href);
    if (parsed?.kind === "video") return parsed;
    current = next.href;
  }
  throw new IntegrationError(
    "tiktok-link",
    "not_found",
    "Could not resolve this TikTok short link to a video.",
    { retryable: false },
  );
}
