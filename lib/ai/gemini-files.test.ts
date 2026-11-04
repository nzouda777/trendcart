import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/domain/contracts";
import type { HttpFetch } from "@/lib/integrations/tiktok-data/http";

import { uploadToGeminiFiles, type GeminiFilesConfig } from "./gemini-files";

const BASE = "https://gemini.test";
const FILE_URL = `${BASE}/v1beta/files/f1`;
const BYTES = new Uint8Array(512).fill(7);

type Call = { method: string; url: string };

/** Fake Files API: upload returns PROCESSING, then each poll answers `poll(n)`. */
function fakeFiles(poll: (n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let polls = 0;
  const fetch = (async (input: string | URL, init?: { method?: string; body?: unknown }) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url === `${BASE}/upload/v1beta/files`) {
      return new Response("{}", { headers: { "x-goog-upload-url": `${BASE}/upload/s1` } });
    }
    if (url === `${BASE}/upload/s1`) {
      await new Response(init?.body as BodyInit).arrayBuffer();
      return Response.json({
        file: { name: "files/f1", uri: FILE_URL, mimeType: "video/mp4", state: "PROCESSING" },
      });
    }
    if (url === FILE_URL && method === "DELETE") return new Response("{}");
    if (url === FILE_URL) return poll(++polls);
    return new Response("not found", { status: 404 });
  }) as unknown as HttpFetch;
  return { fetch, calls, deletes: () => calls.filter((c) => c.method === "DELETE") };
}

const source = () => ({
  body: new Response(BYTES).body as ReadableStream<Uint8Array>,
  size: BYTES.byteLength,
  mediaType: "video/mp4",
});

function config(fetch: HttpFetch, extra: Partial<GeminiFilesConfig> = {}): GeminiFilesConfig {
  return { apiKey: "k", fetch, baseUrl: BASE, sleep: async () => undefined, ...extra };
}

const fileState = (state: string, extra: Record<string, unknown> = {}) =>
  Response.json({ name: "files/f1", uri: FILE_URL, mimeType: "video/mp4", state, ...extra });

describe("uploadToGeminiFiles cleanup (N7)", () => {
  it("returns the ACTIVE file and leaves deletion to the caller", async () => {
    const net = fakeFiles((n) => fileState(n < 2 ? "PROCESSING" : "ACTIVE"));
    const file = await uploadToGeminiFiles(config(net.fetch), source(), "t");
    expect(file).toMatchObject({ name: "files/f1", uri: FILE_URL, state: "ACTIVE" });
    expect(net.deletes()).toHaveLength(0);
  });

  it("deletes the file when processing ends FAILED", async () => {
    const net = fakeFiles(() => fileState("FAILED", { error: { message: "bad codec" } }));
    const run = uploadToGeminiFiles(config(net.fetch), source(), "t");
    await expect(run).rejects.toMatchObject({ code: "invalid_input", retryable: false });
    await expect(run).rejects.toThrow(/bad codec/);
    expect(net.deletes()).toEqual([{ method: "DELETE", url: FILE_URL }]);
  });

  it("deletes the file when processing times out", async () => {
    const net = fakeFiles(() => fileState("PROCESSING"));
    const run = uploadToGeminiFiles(config(net.fetch, { pollTimeoutMs: -1 }), source(), "t");
    await expect(run).rejects.toMatchObject({ code: "provider_error", retryable: true });
    expect(net.deletes()).toHaveLength(1);
  });

  it("deletes the file when the caller's budget aborts the wait", async () => {
    const budget = new AbortController();
    const net = fakeFiles(() => {
      budget.abort();
      return fileState("PROCESSING");
    });
    const run = uploadToGeminiFiles(config(net.fetch, { signal: budget.signal }), source(), "t");
    await expect(run).rejects.toBeInstanceOf(IntegrationError);
    expect(net.deletes()).toHaveLength(1);
  });

  it("deletes the file when a status poll errors (HTTP, network or bad JSON)", async () => {
    for (const poll of [
      () => new Response("boom", { status: 500 }),
      () => Promise.reject(new TypeError("fetch failed")),
      () => new Response("not json"),
    ]) {
      const net = fakeFiles(poll);
      await expect(uploadToGeminiFiles(config(net.fetch), source(), "t")).rejects.toBeInstanceOf(
        IntegrationError,
      );
      expect(net.deletes()).toEqual([{ method: "DELETE", url: FILE_URL }]);
    }
  });

  it("still deletes when the delete itself fails, and rethrows the original error", async () => {
    const calls: string[] = [];
    const net = fakeFiles(() => fileState("FAILED"));
    const fetch = (async (input: string | URL, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (init?.method === "DELETE") throw new TypeError("network down");
      return (net.fetch as unknown as (u: string | URL, i?: unknown) => Promise<Response>)(
        input,
        init,
      );
    }) as unknown as HttpFetch;
    await expect(uploadToGeminiFiles(config(fetch), source(), "t")).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(calls).toContain(`DELETE ${FILE_URL}`);
  });
});
