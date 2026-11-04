import { IntegrationError } from "@/lib/domain/contracts";

import { realSleep } from "../tiktok-ads/safety";

import { contentRange, type ChunkPlan, type ChunkRange } from "./chunks";
import { TIKTOK_POSTING_PROVIDER } from "./config";

/*
 * FILE_UPLOAD transfer, streamed from the source URL (the Shopify file URL).
 * Nothing touches disk: each chunk is fetched with an HTTP Range request
 * into memory (10 MB, at most ~20 MB for the last one) and PUT to TikTok's
 * upload_url, then dropped. A whole chunk is buffered so Content-Length is
 * exact, as the Media Transfer Guide requires.
 *
 * TikTok answers 206 (more chunks expected) or 201 (all received); 5xx means
 * "retry the same chunk"; 403 = upload_url expired (one hour), 416 = range
 * out of sync, 404 = no upload task: those end the publish.
 */

export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type VideoContentType = (typeof ALLOWED_VIDEO_TYPES)[number];

const CHUNK_ATTEMPTS = 3;
const TIMEOUT_MS = 60_000;

const fail = (
  code: "invalid_input" | "provider_error" | "not_found",
  message: string,
  retryable?: boolean,
) => new IntegrationError(TIKTOK_POSTING_PROVIDER, code, message, { retryable });

function contentTypeFrom(header: string | null, url: string): VideoContentType {
  const ct = (header ?? "").split(";")[0]!.trim().toLowerCase();
  if ((ALLOWED_VIDEO_TYPES as readonly string[]).includes(ct)) return ct as VideoContentType;
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".mov")) return "video/quicktime";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mp4") || ct === "" || ct === "application/octet-stream") return "video/mp4";
  throw fail("invalid_input", `Unsupported video type "${ct}" (mp4, mov or webm only).`, false);
}

async function get(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    throw new IntegrationError(
      TIKTOK_POSTING_PROVIDER,
      "provider_error",
      "Video source unreachable.",
      {
        cause,
      },
    );
  }
}

/**
 * The source must be a plain https URL (the stored Shopify file URL): no
 * other scheme and no credentials. Checked before any request; the fetch
 * itself goes through the SSRF-guarded client (see live.ts), which refuses
 * non-public addresses on every connection and redirect hop.
 */
export function assertSafeSourceUrl(sourceUrl: string): URL {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw fail("invalid_input", "The video source is not a valid URL.", false);
  }
  if (url.protocol !== "https:") {
    throw fail("invalid_input", "The video source must use https.", false);
  }
  if (url.username || url.password) {
    throw fail("invalid_input", "The video source must not carry credentials.", false);
  }
  return url;
}

/** Size and type of the source video, without downloading it. */
export async function probeSource(
  fetchImpl: typeof fetch,
  sourceUrl: string,
): Promise<{ size: number; contentType: VideoContentType }> {
  assertSafeSourceUrl(sourceUrl);
  const head = await get(fetchImpl, sourceUrl, { method: "HEAD" });
  const len = Number(head.headers.get("content-length"));
  if (head.ok && Number.isSafeInteger(len) && len > 0) {
    return { size: len, contentType: contentTypeFrom(head.headers.get("content-type"), sourceUrl) };
  }
  // Some CDNs do not answer HEAD: ask for one byte and read the total.
  const probe = await get(fetchImpl, sourceUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
  await probe.body?.cancel().catch(() => {});
  const total = Number(/\/(\d+)$/.exec(probe.headers.get("content-range") ?? "")?.[1]);
  if (probe.status === 206 && Number.isSafeInteger(total) && total > 0) {
    return {
      size: total,
      contentType: contentTypeFrom(probe.headers.get("content-type"), sourceUrl),
    };
  }
  if (probe.status === 404 || head.status === 404)
    throw fail("not_found", "The video file is gone.", false);
  throw fail("provider_error", `Could not read the video size (HTTP ${probe.status}).`);
}

/** Exactly the bytes of `chunk` from the source. */
async function readChunk(
  fetchImpl: typeof fetch,
  sourceUrl: string,
  chunk: ChunkRange,
  plan: ChunkPlan,
): Promise<ArrayBuffer> {
  const whole = plan.totalChunkCount === 1;
  const res = await get(fetchImpl, sourceUrl, {
    method: "GET",
    headers: whole ? {} : { Range: `bytes=${chunk.first}-${chunk.last}` },
  });
  if (!res.ok) throw fail("provider_error", `Video source HTTP ${res.status}.`);
  if (!whole && res.status !== 206) {
    await res.body?.cancel().catch(() => {});
    throw fail("invalid_input", "The video host does not support range requests.", false);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== chunk.size) {
    throw fail(
      "provider_error",
      `Video source returned ${bytes.byteLength} bytes, expected ${chunk.size}.`,
    );
  }
  return bytes;
}

export async function transferChunks(input: {
  /** TikTok upload_url PUTs. */
  fetchImpl: typeof fetch;
  /** Source Range GETs: the SSRF-guarded client in production. */
  sourceFetch: typeof fetch;
  sourceUrl: string;
  uploadUrl: string;
  plan: ChunkPlan;
  contentType: VideoContentType;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { fetchImpl, sourceFetch, sourceUrl, uploadUrl, plan, contentType } = input;
  const sleep = input.sleep ?? realSleep;
  assertSafeSourceUrl(sourceUrl);
  for (const chunk of plan.chunks) {
    const bytes = await readChunk(sourceFetch, sourceUrl, chunk, plan);
    const isLast = chunk.index === plan.totalChunkCount - 1;
    for (let attempt = 1; ; attempt++) {
      const res = await get(fetchImpl, uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunk.size),
          "Content-Range": contentRange(chunk, plan.videoSize),
        },
        body: bytes,
      }).catch((e: unknown) => e as IntegrationError);
      if (res instanceof Response) {
        if (res.status === 201 || (res.status === 206 && !isLast)) break;
        if (res.status < 500) {
          if (res.status === 403)
            throw fail("provider_error", "TikTok upload URL expired; publish again.", false);
          throw fail(
            "provider_error",
            `TikTok rejected chunk ${chunk.index + 1}/${plan.totalChunkCount} (HTTP ${res.status}).`,
            false,
          );
        }
      }
      if (attempt >= CHUNK_ATTEMPTS) {
        throw res instanceof IntegrationError
          ? res
          : fail("provider_error", `TikTok upload failed (HTTP ${(res as Response).status}).`);
      }
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}
