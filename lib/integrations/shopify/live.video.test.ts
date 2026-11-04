import { describe, expect, it } from "vitest";

import { IntegrationError, shopifyMediaRefSchema } from "@/lib/domain/contracts";

import fx from "./__fixtures__/admin-graphql-video.json";
import { ShopifyMediaProcessingError } from "./errors";
import type { FetchLike } from "./graphql";
import { createLiveShopifyClient, type LiveShopifyOptions } from "./live";
import { createMockShopifyClient } from "./mock";
import {
  declaredSize,
  multipartUpload,
  pickVideoUrl,
  sourceKey,
  videoFilename,
  videoMarker,
  videoTypeOf,
} from "./video";

/*
 * Live attachVideoFromUrl / deleteProductMedia / template cache against
 * recorded-shape 2026-10 responses (no network). GraphQL calls replay in
 * order; the staged upload target and the video source are fakes that check
 * the request (multipart layout, exact Content-Length, streamed body).
 */

const creds = { shopDomain: "some-shop.myshopify.com", accessToken: "shpat_test" };
const PRODUCT = "gid://shopify/Product/9001";
const STAGED_URL = fx.stagedTarget.data.stagedUploadsCreate.stagedTargets[0]!.url;
const SOURCE = "https://v16.tiktokcdn.example/obj/video.mp4?x-expires=1&sig=abc";
const KEY = "vid_01JTRENDCART";
const FILENAME = videoFilename(videoMarker(KEY), "mp4");

type GqlCall = { query: string; variables: Record<string, unknown> };
type Upload = { headers: Headers; body: Uint8Array; init: RequestInit };

function video(name: keyof typeof fx & `video${string}`, filename = FILENAME) {
  return { ...(fx[name] as Record<string, unknown>), filename };
}

function productWith(...videos: Record<string, unknown>[]) {
  const base = fx.productNoVideo.data.product;
  return {
    data: {
      product: {
        ...base,
        media: {
          nodes: [...base.media.nodes, ...videos.map((v) => ({ mediaContentType: "VIDEO", ...v }))],
        },
      },
    },
  };
}

const node = (v: Record<string, unknown>) => ({ data: { node: v } });

function bytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * seed) & 255;
  return out;
}

/** A source whose body is produced chunk by chunk, on demand. */
function chunkedSource(payload: Uint8Array, chunk = 1024) {
  const state = { pulls: 0, cancelled: false };
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++;
      if (offset >= payload.length) return controller.close();
      controller.enqueue(payload.slice(offset, offset + chunk));
      offset += chunk;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { body, state };
}

type SourceSpec = {
  status?: number;
  payload?: Uint8Array;
  headers?: Record<string, string>;
};

function harness(
  gql: unknown[],
  opts: {
    source?: SourceSpec;
    uploadStatus?: number;
    client?: Partial<LiveShopifyOptions>;
  } = {},
) {
  const calls: GqlCall[] = [];
  const uploads: Upload[] = [];
  const sourceRequests: { url: string; proxyUrl: string | undefined }[] = [];
  const sleeps: number[] = [];
  let clock = Date.parse("2026-11-04T10:00:00Z");
  const queue = [...gql];
  const payload = opts.source?.payload ?? bytes(5000);
  const src = chunkedSource(payload);

  const fetch: FetchLike = async (url, init) => {
    if (url === STAGED_URL) {
      expect(init?.body).toBeInstanceOf(ReadableStream);
      const reader = (init!.body as ReadableStream<Uint8Array>).getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) {
        body.set(p, o);
        o += p.length;
      }
      uploads.push({ headers: new Headers(init!.headers), body, init: init! });
      return new Response(null, { status: opts.uploadStatus ?? 204 });
    }
    expect(url).toBe("https://some-shop.myshopify.com/admin/api/2026-10/graphql.json");
    const parsed = JSON.parse(String(init?.body)) as GqlCall;
    calls.push({ query: parsed.query, variables: parsed.variables ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected GraphQL call: ${parsed.query.slice(0, 80)}`);
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = createLiveShopifyClient({
    apiKey: "k",
    apiSecret: "s",
    apiVersion: "2026-10",
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    sourceFetch: (proxyUrl) => async (url) => {
      sourceRequests.push({ url, proxyUrl });
      return new Response(opts.source?.status && opts.source.status >= 300 ? null : src.body, {
        status: opts.source?.status ?? 200,
        headers: opts.source?.headers ?? {
          "Content-Type": "video/mp4",
          "Content-Length": String(payload.length),
        },
      });
    },
    ...opts.client,
  });
  return { client, calls, uploads, sourceRequests, sleeps, src, payload, queue };
}

async function rejection(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

const input = {
  productId: PRODUCT,
  sourceUrl: SOURCE,
  alt: "LED Sunset Lamp video",
  idempotencyKey: KEY,
};

const opName = (q: string) => /(?:query|mutation) (\w+)/.exec(q)?.[1];

describe("live attachVideoFromUrl", () => {
  it("stages, streams, attaches and polls until READY", async () => {
    const h = harness(
      [
        fx.productNoVideo,
        fx.stagedTarget,
        fx.attachOk,
        productWith(video("videoUploaded")),
        node(video("videoProcessing")),
        node(video("videoReady")),
      ],
      { client: {} },
    );
    const ref = shopifyMediaRefSchema.parse(
      await h.client.attachVideoFromUrl(creds, {
        ...input,
        proxyUrl: "http://u:p@proxy.example:8080",
      }),
    );
    expect(ref).toEqual({
      mediaId: "gid://shopify/Video/7701",
      fileUrl: "https://cdn.shopify.com/videos/c/vp/abc/abc.HD-1080p-4.8Mbps.mp4",
      status: "READY",
    });
    expect(h.calls.map((c) => opName(c.query))).toEqual([
      "TrendcartProductVideos",
      "TrendcartStagedVideoUpload",
      "TrendcartAttachVideo",
      "TrendcartProductVideos",
      "TrendcartVideo",
      "TrendcartVideo",
    ]);
    // Source fetched once, through the brand proxy, with its signed query intact.
    expect(h.sourceRequests).toEqual([{ url: SOURCE, proxyUrl: "http://u:p@proxy.example:8080" }]);

    expect(h.calls[1]!.variables).toEqual({
      input: [
        {
          resource: "VIDEO",
          filename: FILENAME,
          mimeType: "video/mp4",
          fileSize: String(h.payload.length),
          httpMethod: "POST",
        },
      ],
    });
    expect(h.calls[2]!.variables).toEqual({
      product: { id: PRODUCT },
      media: [
        {
          originalSource: fx.stagedTarget.data.stagedUploadsCreate.stagedTargets[0]!.resourceUrl,
          mediaContentType: "VIDEO",
          alt: "LED Sunset Lamp video",
        },
      ],
    });
    expect(h.sleeps).toEqual([2000, 3000]);
  });

  it("streams a multipart form with Shopify's parameters first and the exact file bytes last", async () => {
    const h = harness([
      fx.productNoVideo,
      fx.stagedTarget,
      fx.attachOk,
      productWith(video("videoReady")),
    ]);
    await h.client.attachVideoFromUrl(creds, input);

    expect(h.uploads).toHaveLength(1);
    const { headers, body, init } = h.uploads[0]!;
    expect((init as { duplex?: string }).duplex).toBe("half");
    expect(Number(headers.get("content-length"))).toBe(body.length);
    const boundary = /boundary=(.+)$/.exec(headers.get("content-type")!)![1]!;
    expect(headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);

    const text = Buffer.from(body).toString("latin1");
    const names = [...text.matchAll(/; name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["GoogleAccessId", "key", "policy", "signature", "file"]);
    expect(text).toContain(`filename="${FILENAME}"\r\nContent-Type: video/mp4\r\n\r\n`);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);

    const start =
      text.indexOf("Content-Type: video/mp4\r\n\r\n") + "Content-Type: video/mp4\r\n\r\n".length;
    const file = body.slice(start, start + h.payload.length);
    expect(Buffer.from(file).equals(Buffer.from(h.payload))).toBe(true);
    // Read chunk by chunk (5000 bytes / 1 KiB chunks + the closing pull).
    expect(h.src.state.pulls).toBeGreaterThanOrEqual(5);
  });

  it("re-running for the same video returns the existing media without uploading again", async () => {
    const h = harness([productWith(video("videoReady"))]);
    const ref = await h.client.attachVideoFromUrl(creds, {
      ...input,
      // A fresh signed URL for the same Trendcart video.
      sourceUrl: "https://v19.tiktokcdn.example/other/path.mp4?sig=new",
    });
    expect(ref.mediaId).toBe("gid://shopify/Video/7701");
    expect(h.calls).toHaveLength(1);
    expect(h.sourceRequests).toHaveLength(0);
    expect(h.uploads).toHaveLength(0);
  });

  it("resumes polling a video still processing from an earlier run", async () => {
    const h = harness([productWith(video("videoProcessing")), node(video("videoReady"))]);
    const ref = await h.client.attachVideoFromUrl(creds, input);
    expect(ref.status).toBe("READY");
    expect(h.uploads).toHaveLength(0);
    expect(h.calls.map((c) => opName(c.query))).toEqual([
      "TrendcartProductVideos",
      "TrendcartVideo",
    ]);
  });

  it("without an idempotency key, the source origin + path is the key (query ignored)", async () => {
    const filename = videoFilename(videoMarker(sourceKey(SOURCE)), "mp4");
    expect(sourceKey(SOURCE)).toBe("https://v16.tiktokcdn.example/obj/video.mp4");
    const h = harness([productWith(video("videoReady", filename))]);
    const ref = await h.client.attachVideoFromUrl(creds, {
      productId: PRODUCT,
      sourceUrl: "https://v16.tiktokcdn.example/obj/video.mp4?x-expires=2&sig=zzz",
    });
    expect(ref.mediaId).toBe("gid://shopify/Video/7701");
    expect(h.uploads).toHaveLength(0);
  });

  it("deletes duplicates a concurrent run added and keeps the oldest", async () => {
    const newer = { ...video("videoReady"), id: "gid://shopify/Video/10000" };
    const h = harness([productWith(newer, video("videoReady")), fx.fileDeleteOk]);
    const ref = await h.client.attachVideoFromUrl(creds, input);
    expect(ref.mediaId).toBe("gid://shopify/Video/7701");
    expect(h.calls[1]!.variables).toEqual({ fileIds: ["gid://shopify/Video/10000"] });
  });

  it("replaces a FAILED video from an earlier run", async () => {
    const h = harness([
      productWith(video("videoFailed")),
      fx.fileDeleteOk,
      fx.stagedTarget,
      fx.attachOk,
      productWith({ ...video("videoReady"), id: "gid://shopify/Video/7702" }),
    ]);
    const ref = await h.client.attachVideoFromUrl(creds, input);
    expect(ref.mediaId).toBe("gid://shopify/Video/7702");
    expect(h.calls[1]!.variables).toEqual({ fileIds: ["gid://shopify/Video/7701"] });
    expect(h.uploads).toHaveLength(1);
  });

  it("gives up polling within its budget with a retryable processing error", async () => {
    const processing = Array.from({ length: 30 }, () => node(video("videoProcessing")));
    const h = harness([productWith(video("videoProcessing")), ...processing], {
      client: { videoPollTimeoutMs: 20_000 },
    });
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error).toBeInstanceOf(ShopifyMediaProcessingError);
    expect(error.retryable).toBe(true);
    expect((error as ShopifyMediaProcessingError).mediaId).toBe("gid://shopify/Video/7701");
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000);
    expect(h.sleeps.every((ms) => ms <= 5_000)).toBe(true);
  });

  it("deletes a video Shopify fails to process and reports the media errors", async () => {
    const h = harness([
      productWith(video("videoProcessing")),
      node(video("videoFailed")),
      fx.fileDeleteOk,
    ]);
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("provider_error");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("VIDEO_VALIDATION_ERROR: Unsupported codec");
    expect(h.calls[2]!.variables).toEqual({ fileIds: ["gid://shopify/Video/7701"] });
  });

  it("fails when the video vanishes while processing (the next run uploads again)", async () => {
    const h = harness([productWith(video("videoProcessing")), fx.nodeMissing]);
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("provider_error");
    expect(error.retryable).toBe(true);
  });

  it("surfaces stagedUploadsCreate userErrors and releases the source", async () => {
    const h = harness([fx.productNoVideo, fx.stagedUserErrors]);
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("input.0.fileSize");
    expect(h.uploads).toHaveLength(0);
    expect(h.src.state.cancelled).toBe(true);
  });

  it("surfaces productUpdate media userErrors", async () => {
    const h = harness([fx.productNoVideo, fx.stagedTarget, fx.attachUserErrors]);
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("Media limit reached");
  });

  it("is not_found for a missing product, before touching the source", async () => {
    const h = harness([fx.productMissing]);
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("not_found");
    expect(h.sourceRequests).toHaveLength(0);
  });

  it("rejects bad inputs before any request", async () => {
    const h = harness([]);
    expect(
      (await rejection(h.client.attachVideoFromUrl(creds, { ...input, productId: "42" }))).code,
    ).toBe("invalid_input");
    expect(
      (
        await rejection(
          h.client.attachVideoFromUrl(creds, { ...input, sourceUrl: "file:///etc/passwd" }),
        )
      ).code,
    ).toBe("invalid_input");
    expect(
      (
        await rejection(
          h.client.attachVideoFromUrl(creds, {
            ...input,
            sourceUrl: "https://u:p@x.example/v.mp4",
          }),
        )
      ).code,
    ).toBe("invalid_input");
    expect(h.calls).toHaveLength(0);
  });

  it("maps source failures: expired URL, no Content-Length, too large, not a video", async () => {
    const expired = await rejection(
      harness([fx.productNoVideo], { source: { status: 403 } }).client.attachVideoFromUrl(
        creds,
        input,
      ),
    );
    expect(expired.code).toBe("not_found");
    expect(expired.retryable).toBe(true);

    const noLength = harness([fx.productNoVideo], {
      source: { headers: { "Content-Type": "video/mp4" } },
    });
    const e1 = await rejection(noLength.client.attachVideoFromUrl(creds, input));
    expect(e1.message).toContain("Content-Length");
    expect(e1.retryable).toBe(false);
    expect(noLength.src.state.cancelled).toBe(true);

    const big = harness([fx.productNoVideo], { client: { maxVideoBytes: 1000 } });
    expect((await rejection(big.client.attachVideoFromUrl(creds, input))).code).toBe(
      "invalid_input",
    );

    const html = harness([fx.productNoVideo], {
      source: { headers: { "Content-Type": "text/html", "Content-Length": "5000" } },
    });
    expect((await rejection(html.client.attachVideoFromUrl(creds, input))).code).toBe(
      "invalid_input",
    );
  });

  it("a failing upload target is retryable and nothing is attached", async () => {
    const h = harness([fx.productNoVideo, fx.stagedTarget], { uploadStatus: 503 });
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("provider_error");
    expect(error.retryable).toBe(true);
    expect(h.calls.map((c) => opName(c.query))).not.toContain("TrendcartAttachVideo");
  });

  it("aborts the upload when the source is shorter than its Content-Length", async () => {
    const h = harness([fx.productNoVideo, fx.stagedTarget], {
      source: {
        payload: bytes(100),
        headers: { "Content-Type": "video/mp4", "Content-Length": "200" },
      },
    });
    const error = await rejection(h.client.attachVideoFromUrl(creds, input));
    expect(error.code).toBe("provider_error");
    expect(h.calls.map((c) => opName(c.query))).not.toContain("TrendcartAttachVideo");
  });
});

describe("live deleteProductMedia", () => {
  it("deletes videos and images with fileDelete, tolerating already-gone files", async () => {
    const h = harness([fx.fileDeleteGone]);
    await h.client.deleteProductMedia(creds, {
      productId: PRODUCT,
      mediaIds: [
        "gid://shopify/Video/7701",
        "gid://shopify/MediaImage/501",
        "gid://shopify/Video/7701",
      ],
    });
    expect(h.calls[0]!.variables).toEqual({
      fileIds: ["gid://shopify/Video/7701", "gid://shopify/MediaImage/501"],
    });
  });

  it("does nothing for an empty list and rejects non-GIDs", async () => {
    const h = harness([]);
    await h.client.deleteProductMedia(creds, { productId: PRODUCT, mediaIds: [] });
    expect(h.calls).toHaveLength(0);
    expect(
      (
        await rejection(
          h.client.deleteProductMedia(creds, { productId: PRODUCT, mediaIds: ["7701"] }),
        )
      ).code,
    ).toBe("invalid_input");
  });
});

describe("live listProductTemplates cache", () => {
  it("serves repeated calls from a short per-connection cache", async () => {
    const h = harness([fx.templatesPage, fx.templatesPage, fx.templatesPage]);
    expect(await h.client.listProductTemplates(creds)).toEqual([null, "trendcart"]);
    expect(await h.client.listProductTemplates(creds)).toEqual([null, "trendcart"]);
    expect(h.calls).toHaveLength(1);
    // Another token (another connection to the same shop) is a separate entry.
    await h.client.listProductTemplates({ ...creds, accessToken: "shpat_other" });
    expect(h.calls).toHaveLength(2);
  });

  it("expires entries, never caches errors and can be disabled", async () => {
    let clock = 0;
    const queue: unknown[] = [
      { errors: [{ message: "boom" }] },
      fx.templatesPage,
      fx.templatesPage,
    ];
    const calls: string[] = [];
    const client = createLiveShopifyClient({
      apiKey: "k",
      apiSecret: "s",
      apiVersion: "2026-10",
      now: () => clock,
      sleep: async () => {},
      fetch: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify(queue.shift()), { status: 200 });
      },
    });
    await rejection(client.listProductTemplates(creds));
    expect(await client.listProductTemplates(creds)).toEqual([null, "trendcart"]);
    clock += 29_000;
    await client.listProductTemplates(creds);
    expect(calls).toHaveLength(2);
    clock += 2_000;
    await client.listProductTemplates(creds);
    expect(calls).toHaveLength(3);

    const off = harness([fx.templatesPage, fx.templatesPage], {
      client: { templateCacheTtlMs: 0 },
    });
    await off.client.listProductTemplates(creds);
    await off.client.listProductTemplates(creds);
    expect(off.calls).toHaveLength(2);
  });
});

describe("video helpers", () => {
  it("picks the best MP4 rendition up to 1080p, else the original MP4", () => {
    expect(pickVideoUrl(fx.videoReady)).toBe(
      "https://cdn.shopify.com/videos/c/vp/abc/abc.HD-1080p-4.8Mbps.mp4",
    );
    expect(pickVideoUrl({ sources: [], originalSource: fx.videoReady.originalSource })).toBe(
      "https://cdn.shopify.com/videos/c/o/v/abc.mp4",
    );
    expect(
      pickVideoUrl({
        sources: [fx.videoReady.sources[0]!],
        originalSource: {
          ...fx.videoReady.originalSource,
          mimeType: "video/quicktime",
          format: "mov",
        },
      }),
    ).toBeNull();
  });

  it("derives the video type and checks the declared size", () => {
    expect(videoTypeOf("video/quicktime", "https://x.example/a")).toEqual({
      mimeType: "video/quicktime",
      extension: "mov",
    });
    expect(videoTypeOf("application/octet-stream", "https://x.example/a.webm")).toEqual({
      mimeType: "video/webm",
      extension: "webm",
    });
    expect(videoTypeOf(null, "https://x.example/a")).toEqual({
      mimeType: "video/mp4",
      extension: "mp4",
    });
    expect(declaredSize("123", 1000)).toBe(123);
    expect(() => declaredSize("0", 1000)).toThrow(IntegrationError);
    expect(() => declaredSize("12abc", 1000)).toThrow(IntegrationError);
  });

  it("errors the multipart stream when the source sends too many bytes", async () => {
    const { body } = chunkedSource(bytes(300), 100);
    const upload = multipartUpload({
      parameters: [],
      filename: "tcv-x.mp4",
      mimeType: "video/mp4",
      size: 200,
      source: body,
      boundary: "b",
    });
    expect(upload.contentLength).toBeGreaterThan(200);
    const reader = upload.body.getReader();
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) break;
      })(),
    ).rejects.toThrow(/more bytes/);
  });

  it("video filenames never match the draft image marker (tc-<hex>)", () => {
    expect(FILENAME).toMatch(/^tcv-[0-9a-f]{16}\.mp4$/);
    expect(/(?:^|\/)tc-([0-9a-f]{16})[^/]*$/.test(FILENAME)).toBe(false);
  });
});

describe("mock attachVideoFromUrl (same idempotency as live)", () => {
  it("returns the same media for the same video key, whatever the signed query", async () => {
    const mock = createMockShopifyClient();
    const c = { shopDomain: "trendcart-demo.myshopify.com", accessToken: "shpat_mock" };
    const a = await mock.attachVideoFromUrl(c, input);
    const b = await mock.attachVideoFromUrl(c, {
      ...input,
      sourceUrl: "https://other.example/x.mp4",
    });
    expect(b).toEqual(a);
    const viaUrl1 = await mock.attachVideoFromUrl(c, { productId: PRODUCT, sourceUrl: SOURCE });
    const viaUrl2 = await mock.attachVideoFromUrl(c, {
      productId: PRODUCT,
      sourceUrl: "https://v16.tiktokcdn.example/obj/video.mp4?sig=new",
    });
    expect(viaUrl2).toEqual(viaUrl1);
    expect(viaUrl1.mediaId).not.toBe(a.mediaId);
    await expect(
      mock.attachVideoFromUrl(c, { productId: PRODUCT, sourceUrl: "ftp://x.example/v.mp4" }),
    ).rejects.toBeInstanceOf(IntegrationError);
  });
});
