/**
 * Product videos (Admin GraphQL 2026-10): documents, response shapes and the
 * pure helpers behind `attachVideoFromUrl` in ./live. No network here except
 * through the fetch functions the caller passes in.
 *
 * Flow (checked against shopify.dev 2026-10: stagedUploadsCreate,
 * StagedUploadInput, productUpdate, Video, VideoSource, product-media guide):
 * 1. Look for a Trendcart video already on the product (deterministic
 *    filename `tcv-<marker>.<ext>`): a re-run resumes instead of duplicating.
 * 2. GET the source (SSRF-guarded or brand proxy). Its Content-Length is the
 *    `fileSize` stagedUploadsCreate requires for VIDEO.
 * 3. stagedUploadsCreate(resource: VIDEO, httpMethod: POST).
 * 4. POST a multipart form (Shopify's parameters, then `file`) to the staged
 *    target. The body is a pull-based stream: the source is piped chunk by
 *    chunk with backpressure, never buffered whole or written to disk.
 * 5. productUpdate(product: { id }, media: [{ originalSource: resourceUrl,
 *    mediaContentType: VIDEO }]) (productCreateMedia is deprecated in 2026-10).
 * 6. Poll node(id) until status READY (bounded), then return the best MP4
 *    rendition URL (stable cdn.shopify.com URL used for TikTok uploads).
 *
 * Shopify limits: MP4/MOV/WEBM, 1 GB, 10 minutes, 1,000 videos per store per
 * week. Trendcart caps the size lower (DEFAULT_MAX_VIDEO_BYTES) so the
 * transfer fits in one function invocation.
 */
import { createHash, randomBytes } from "node:crypto";

import { shopifyError } from "./errors";
import type { UserError } from "./graphql";

/* -------------------------------- Settings -------------------------------- */

/** Largest source accepted (Shopify allows 1 GB; ads videos are far smaller). */
export const DEFAULT_MAX_VIDEO_BYTES = 250 * 1024 * 1024;
/** Source download + staged upload, end to end. */
export const DEFAULT_VIDEO_TRANSFER_TIMEOUT_MS = 120_000;
/** How long one call waits for Shopify to process the video before giving up (retryable). */
export const DEFAULT_VIDEO_POLL_TIMEOUT_MS = 60_000;
export const VIDEO_POLL_INITIAL_MS = 2_000;
export const VIDEO_POLL_MAX_INTERVAL_MS = 5_000;

/* ------------------------------- Operations ------------------------------- */

const VIDEO_FIELDS = /* GraphQL */ `
          id
          status
          filename
          mediaErrors {
            code
            details
            message
          }
          sources {
            url
            mimeType
            format
            height
            width
          }
          originalSource {
            url
            mimeType
            format
            height
            width
          }`;

/** Product media, to find a Trendcart video from an earlier run. */
export const PRODUCT_VIDEOS_QUERY = /* GraphQL */ `
  query TrendcartProductVideos($id: ID!) {
    product(id: $id) {
      id
      media(first: 250) {
        nodes {
          id
          mediaContentType
          ... on Video {${VIDEO_FIELDS}
          }
        }
      }
    }
  }
`;

export const VIDEO_NODE_QUERY = /* GraphQL */ `
  query TrendcartVideo($id: ID!) {
    node(id: $id) {
      ... on Video {${VIDEO_FIELDS}
      }
    }
  }
`;

export const STAGED_UPLOADS_CREATE_MUTATION = /* GraphQL */ `
  mutation TrendcartStagedVideoUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Attaches staged media to a product (productCreateMedia is deprecated in 2026-10). */
export const PRODUCT_ATTACH_MEDIA_MUTATION = /* GraphQL */ `
  mutation TrendcartAttachVideo($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/* --------------------------------- Shapes --------------------------------- */

export type VideoSourceNode = {
  url: string;
  mimeType: string;
  format: string;
  height: number;
  width: number;
};

export type MediaStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED";

export type VideoNode = {
  id: string;
  status: MediaStatus;
  filename: string;
  mediaErrors: { code: string; details: string | null; message: string }[];
  sources: VideoSourceNode[];
  originalSource: VideoSourceNode | null;
};

export type ProductVideosData = {
  product: {
    id: string;
    media: { nodes: ({ id: string; mediaContentType: string } & Partial<VideoNode>)[] };
  } | null;
};

/** `node` is `{}` for a non-Video id and null for an unknown one. */
export type VideoNodeData = { node: Partial<VideoNode> | null };

export type StagedTarget = {
  url: string | null;
  resourceUrl: string | null;
  parameters: { name: string; value: string }[];
};

export type StagedUploadsData = {
  stagedUploadsCreate: { stagedTargets: StagedTarget[] | null; userErrors: UserError[] };
};

export type AttachMediaData = {
  productUpdate: { product: { id: string } | null; userErrors: UserError[] };
};

/* ------------------------------ Idempotency ------------------------------- */

/**
 * Key of the source when the caller gives no idempotency key: origin + path.
 * Provider URLs are signed and expire, so the query string is dropped; pass
 * the Trendcart video id as `idempotencyKey` whenever possible.
 */
export function sourceKey(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  return `${url.origin}${url.pathname}`;
}

/** 16 hex chars identifying one Trendcart video on one product. */
export function videoMarker(key: string): string {
  return createHash("sha256").update(`video:${key}`).digest("hex").slice(0, 16);
}

/**
 * `tcv-<marker>.<ext>`. Distinct from the image prefix `tc-<marker>` so the
 * draft sync (product-input) never mistakes a video for one of its images.
 */
export function videoFilename(marker: string, extension: string): string {
  return `tcv-${marker}.${extension}`;
}

/** Shopify may append `_<uuid>` before the extension on a name clash. */
export function filenameHasMarker(filename: string | undefined, marker: string): boolean {
  return typeof filename === "string" && filename.startsWith(`tcv-${marker}`);
}

/** Orders GIDs by their numeric id, oldest first (ids exceed 2^53, so compare as strings). */
export function compareGids(a: string, b: string): number {
  const x = /\/(\d+)$/.exec(a)?.[1] ?? "0";
  const y = /\/(\d+)$/.exec(b)?.[1] ?? "0";
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

/* --------------------------------- Source --------------------------------- */

const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const EXTENSION_MIMES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * Video type from the source Content-Type, else from the URL extension
 * (CDNs often answer octet-stream), else MP4. Throws for non-video types.
 */
export function videoTypeOf(
  contentType: string | null,
  sourceUrl: string,
): { mimeType: string; extension: string } {
  const mime = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  const fromMime = MIME_EXTENSIONS[mime];
  if (fromMime) return { mimeType: mime, extension: fromMime };
  if (!GENERIC_MIMES.has(mime)) {
    throw shopifyError(
      "invalid_input",
      `The video source is not an MP4, MOV or WEBM video (${mime.slice(0, 60)}).`,
      { retryable: false },
    );
  }
  const ext = /\.([a-z0-9]+)$/i.exec(new URL(sourceUrl).pathname)?.[1]?.toLowerCase() ?? "";
  const fromExt = EXTENSION_MIMES[ext];
  return fromExt
    ? { mimeType: fromExt, extension: ext }
    : { mimeType: "video/mp4", extension: "mp4" };
}

/** Declared size of the source; fileSize is mandatory for VIDEO staged uploads. */
export function declaredSize(contentLength: string | null, maxBytes: number): number {
  const size = contentLength && /^\d+$/.test(contentLength.trim()) ? Number(contentLength) : NaN;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw shopifyError(
      "provider_error",
      "The video source did not send a Content-Length, so it cannot be streamed to Shopify (the size is required up front).",
      { retryable: false },
    );
  }
  if (size > maxBytes) {
    throw shopifyError(
      "invalid_input",
      `The video is too large (${Math.ceil(size / 1_048_576)} MB, limit ${Math.floor(maxBytes / 1_048_576)} MB).`,
      { retryable: false },
    );
  }
  return size;
}

/* ------------------------------- Multipart -------------------------------- */

const encoder = new TextEncoder();

function quoted(value: string): string {
  return value.replace(/[\r\n"]/g, (c) => encodeURIComponent(c));
}

export type MultipartUpload = {
  contentType: string;
  /** Exact byte length of the whole body (sent as Content-Length, no chunking). */
  contentLength: number;
  body: ReadableStream<Uint8Array>;
};

/**
 * multipart/form-data body for a staged POST target: Shopify's parameters in
 * order, then the `file` part (last, as storage form POSTs require), streamed
 * from `source`. Errors the stream when the source sends more or fewer bytes
 * than `size` (the upload then fails instead of storing a truncated file).
 */
export function multipartUpload(input: {
  parameters: { name: string; value: string }[];
  filename: string;
  mimeType: string;
  size: number;
  source: ReadableStream<Uint8Array>;
  boundary?: string;
}): MultipartUpload {
  const boundary = input.boundary ?? `----trendcart${randomBytes(16).toString("hex")}`;
  const head = encoder.encode(
    input.parameters
      .map(
        (p) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(p.name)}"\r\n\r\n${p.value}\r\n`,
      )
      .join("") +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quoted(input.filename)}"\r\n` +
      `Content-Type: ${input.mimeType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const reader = input.source.getReader();
  let phase: "head" | "file" | "tail" | "done" = "head";
  let sent = 0;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "head") {
        controller.enqueue(head);
        phase = "file";
        return;
      }
      if (phase === "file") {
        const { done, value } = await reader.read();
        if (!done) {
          sent += value.byteLength;
          if (sent > input.size) {
            await reader.cancel().catch(() => undefined);
            controller.error(
              new Error("The video source sent more bytes than its Content-Length."),
            );
            return;
          }
          controller.enqueue(value);
          return;
        }
        if (sent !== input.size) {
          controller.error(new Error("The video source ended before its Content-Length."));
          return;
        }
        phase = "tail";
      }
      if (phase === "tail") {
        controller.enqueue(tail);
        phase = "done";
        return;
      }
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: head.byteLength + input.size + tail.byteLength,
    body,
  };
}

/* --------------------------------- Ready ---------------------------------- */

function isMp4(source: VideoSourceNode): boolean {
  return source.mimeType.toLowerCase() === "video/mp4" || source.format.toLowerCase() === "mp4";
}

/**
 * The URL kept for TikTok (upload by URL, posting): the highest MP4 rendition
 * up to 1080p (Shopify generates 480p/720p/1080p MP4 + HLS), else the largest
 * MP4, else the original when it is an MP4. Null when there is none.
 */
export function pickVideoUrl(video: Pick<VideoNode, "sources" | "originalSource">): string | null {
  const mp4 = video.sources.filter((s) => isMp4(s) && /^https:\/\//.test(s.url));
  const byHeight = (a: VideoSourceNode, b: VideoSourceNode) => b.height - a.height;
  const best =
    mp4.filter((s) => s.height <= 1080).sort(byHeight)[0] ?? [...mp4].sort(byHeight)[0] ?? null;
  if (best) return best.url;
  const original = video.originalSource;
  return original && isMp4(original) && /^https:\/\//.test(original.url) ? original.url : null;
}

export function mediaErrorDetail(video: Pick<VideoNode, "mediaErrors">): string {
  const detail = (video.mediaErrors ?? [])
    .map((e) => [e.code, e.details ?? e.message].filter(Boolean).join(": "))
    .join("; ");
  return detail ? ` (${detail.slice(0, 300)})` : "";
}
