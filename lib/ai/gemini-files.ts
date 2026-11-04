import "server-only";

/**
 * Streams a video into the Gemini Files API without touching disk.
 *
 * The installed @ai-sdk/google `files().uploadFile` buffers the whole file
 * (it rejects stream data), so this implements the documented resumable
 * protocol directly (https://ai.google.dev/gemini-api/docs/files):
 *   1. POST {base}/upload/v1beta/files   X-Goog-Upload-Command: start
 *   2. POST <x-goog-upload-url>          X-Goog-Upload-Command: upload, finalize
 *      body = the source response stream (piped, never buffered when the
 *      source announces Content-Length)
 *   3. GET  {base}/v1beta/files/<id>     until state ACTIVE
 *   4. DELETE after use (files also auto-expire after 48 h)
 */
import type { BodyInit } from "undici";
import { z } from "zod";

import { IntegrationError } from "@/lib/domain/contracts";
import { httpStatusError, networkError, type HttpFetch } from "@/lib/integrations/tiktok-data/http";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
/** Upper bound for a TikTok video we analyse (TikTok uploads are far smaller). */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const PROVIDER = "google";

const fileSchema = z.object({
  name: z.string(),
  uri: z.string(),
  mimeType: z.string().optional(),
  state: z.string().optional(),
  sizeBytes: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
export type GeminiFile = z.infer<typeof fileSchema>;

export type GeminiFilesConfig = {
  apiKey: string;
  fetch: HttpFetch;
  baseUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Overall budget of the caller: aborts the upload and stops polling. */
  signal?: AbortSignal;
};

/** Per-request timeout, cut short by the caller's overall budget. */
function withBudget(ms: number, budget?: AbortSignal): AbortSignal {
  const own = AbortSignal.timeout(ms);
  return budget ? AbortSignal.any([own, budget]) : own;
}

function tooSlow(): IntegrationError {
  // Retryable: the workflow engine retries later with backoff.
  return new IntegrationError(
    PROVIDER,
    "provider_error",
    "Gemini took too long to process the video.",
    {
      retryable: true,
    },
  );
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fail(res: { status: number; text(): Promise<string> }): Promise<never> {
  throw httpStatusError(PROVIDER, res.status, await res.text().catch(() => ""));
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw networkError(PROVIDER, error);
  }
}

/** Reads a stream into memory up to `max` bytes (used only without Content-Length). */
async function readAll(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new IntegrationError(PROVIDER, "invalid_input", "Video is too large to analyse.", {
        retryable: false,
      });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export type VideoSource = {
  body: ReadableStream<Uint8Array>;
  /** From the source's Content-Length, when known. */
  size: number | null;
  mediaType: string;
};

export async function uploadToGeminiFiles(
  config: GeminiFilesConfig,
  source: VideoSource,
  displayName: string,
): Promise<GeminiFile> {
  const base = (config.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, "");
  const sleep = config.sleep ?? defaultSleep;

  let body: ReadableStream<Uint8Array> | Uint8Array = source.body;
  let size = source.size;
  if (size !== null && size > MAX_VIDEO_BYTES) {
    await source.body.cancel().catch(() => undefined);
    throw new IntegrationError(PROVIDER, "invalid_input", "Video is too large to analyse.", {
      retryable: false,
    });
  }
  if (size === null) {
    // The resumable protocol needs the length up front: buffer in memory only.
    const bytes = await readAll(source.body, MAX_VIDEO_BYTES);
    body = bytes;
    size = bytes.byteLength;
  }

  const start = await call(() =>
    config.fetch(`${base}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": config.apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(size),
        "X-Goog-Upload-Header-Content-Type": source.mediaType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
      signal: withBudget(30_000, config.signal),
    }),
  );
  if (!start.ok) {
    await source.body.cancel().catch(() => undefined);
    return fail(start);
  }
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    await source.body.cancel().catch(() => undefined);
    throw new IntegrationError(
      PROVIDER,
      "provider_error",
      "Gemini Files API returned no upload URL.",
    );
  }

  const uploaded = await call(() =>
    config.fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(size),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      // DOM and undici stream typings differ; both are WHATWG streams at runtime.
      body: body as unknown as BodyInit,
      duplex: "half",
      // Large uploads can take longer than the default request timeout.
      signal: withBudget(120_000, config.signal),
    }),
  );
  if (!uploaded.ok) return fail(uploaded);
  const parsed = z.object({ file: fileSchema }).safeParse(await uploaded.json().catch(() => null));
  if (!parsed.success) {
    throw new IntegrationError(
      PROVIDER,
      "provider_error",
      "Unexpected Gemini Files API response.",
      {
        cause: parsed.error,
      },
    );
  }

  const name = parsed.data.file.name;
  try {
    return await waitUntilActive(config, base, sleep, parsed.data.file);
  } catch (error) {
    // The file exists from here on: whatever ends the wait (FAILED, timeout,
    // budget abort, poll error, bad response), delete it before rethrowing.
    // On success the caller deletes it after use.
    await deleteGeminiFile(config, name);
    throw error;
  }
}

const polledFileSchema = fileSchema.partial({ uri: true });

async function waitUntilActive(
  config: GeminiFilesConfig,
  base: string,
  sleep: (ms: number) => Promise<void>,
  uploaded: GeminiFile,
): Promise<GeminiFile> {
  let file = uploaded;
  const deadline = Date.now() + (config.pollTimeoutMs ?? 90_000);
  while (file.state === "PROCESSING" || file.state === "STATE_UNSPECIFIED") {
    if (Date.now() > deadline || config.signal?.aborted) throw tooSlow();
    await sleep(config.pollIntervalMs ?? 2_000);
    const res = await call(() =>
      config.fetch(`${base}/v1beta/${uploaded.name}`, {
        headers: { "x-goog-api-key": config.apiKey },
        signal: withBudget(15_000, config.signal),
      }),
    );
    if (!res.ok) return fail(res);
    const polled = polledFileSchema.safeParse(await res.json().catch(() => null));
    if (!polled.success) {
      throw new IntegrationError(
        PROVIDER,
        "provider_error",
        "Unexpected Gemini Files API response.",
        {
          cause: polled.error,
        },
      );
    }
    file = { ...polled.data, name: uploaded.name, uri: polled.data.uri ?? uploaded.uri };
  }
  if (file.state === "FAILED") {
    throw new IntegrationError(
      PROVIDER,
      "invalid_input",
      `Gemini could not process the video${file.error?.message ? `: ${file.error.message}` : "."}`,
      { retryable: false },
    );
  }
  return file;
}

/** Best effort: the file expires on its own anyway. */
export async function deleteGeminiFile(config: GeminiFilesConfig, name: string): Promise<void> {
  const base = (config.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, "");
  try {
    // Own short timeout, not the caller's budget: cleanup still runs after it expires.
    const res = await config.fetch(`${base}/v1beta/${name}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": config.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => undefined);
  } catch {
    // ignore
  }
}
