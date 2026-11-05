import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { analysisProviderOf } from "@/lib/domain/settings";
import { IntegrationError } from "@/lib/domain/contracts";
import type { HttpFetch } from "@/lib/integrations/tiktok-data/http";

import { createLiveProductAnalyzer } from "./analyzer-live";

/*
 * Claude as the analysis provider (workspace Settings): Claude cannot take
 * video, so a TikTok is identified from its cover image and caption, and the
 * video is never downloaded nor sent to the Gemini Files API.
 */

const MEDIA_URL = "https://v16.tiktokcdn-us.com/nwm-1.mp4?x-expires=1793000000";
const THUMB = "https://p16-sign.tiktokcdn-us.com/cover-1.jpeg";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const output = {
  productName: "LED Sunset Projection Lamp",
  category: "Home & Living > Lighting",
  description: "Lampe USB qui projette un halo.",
  features: ["USB-C"],
  sellingPoints: ["Ambiance golden hour"],
  keywords: ["sunset lamp"],
  bestFrameSec: 4,
  confidence: 0.7,
};

type Prompt = { role: string; content: unknown }[];

function claude() {
  const prompts: Prompt[] = [];
  const model = new MockLanguageModelV4({
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    doGenerate: async (options) => {
      prompts.push(options.prompt as Prompt);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 2_000,
            noCache: 2_000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 300, text: 300, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

function network(options: { thumb?: "ok" | "missing" | "html" } = {}) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === THUMB) {
      if (options.thumb === "missing") return new Response("gone", { status: 403 });
      if (options.thumb === "html")
        return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as HttpFetch;
  return { fetch, urls };
}

const ctx = {
  workspaceId: "ws_live",
  ai: { analysisModel: "claude-sonnet-5-5" },
};

function analyzer(model: MockLanguageModelV4, fetch: HttpFetch) {
  return createLiveProductAnalyzer({
    model,
    fetch,
    apiKey: "gemini-key-unused",
    now: () => new Date("2026-11-05T12:00:00Z"),
  });
}

const contentOf = (prompts: Prompt[]) =>
  (prompts[0]!.find((m) => m.role === "user")!.content as { type: string; text?: string }[]) ?? [];

describe("analysis provider", () => {
  it("is Claude for claude-* ids and Gemini otherwise", () => {
    expect(analysisProviderOf("claude-haiku-5-5")).toBe("anthropic");
    expect(analysisProviderOf("gemini-3.8-flash")).toBe("google");
    expect(analysisProviderOf(undefined)).toBe("google");
  });
});

describe("live ProductAnalyzer with Claude", () => {
  it("identifies a TikTok from its cover image and caption, never the video", async () => {
    const net = network();
    const { model, prompts } = claude();
    const result = await analyzer(model, net.fetch).analyze(ctx, {
      source: "tiktok_video",
      mediaUrl: MEDIA_URL,
      caption: "Golden hour #sunsetlamp",
      thumbnailUrl: THUMB,
      language: "fr",
    });

    expect(net.urls).toEqual([THUMB]);
    const parts = contentOf(prompts);
    expect(parts.map((p) => p.type)).toEqual(["file", "text"]);
    const text = parts.find((p) => p.type === "text")!.text!;
    expect(text).toMatch(/cannot see the video/);
    expect(text).toContain("Golden hour #sunsetlamp");

    expect(result.data.bestFrameSec).toBeNull();
    expect(result.data.referenceImageUrl).toBe(THUMB);
    expect(result.usage).toEqual([
      expect.objectContaining({ provider: "anthropic", model: "claude-sonnet-5-5" }),
    ]);
  });

  it("goes on with the caption alone when the cover image cannot be used", async () => {
    for (const thumb of ["missing", "html"] as const) {
      const net = network({ thumb });
      const { model, prompts } = claude();
      await analyzer(model, net.fetch).analyze(ctx, {
        source: "tiktok_video",
        mediaUrl: MEDIA_URL,
        caption: "Golden hour lamp",
        thumbnailUrl: THUMB,
        language: "en",
      });
      const parts = contentOf(prompts);
      expect(parts.map((p) => p.type)).toEqual(["text"]);
      expect(parts[0]!.text).toMatch(/cover image could not be loaded/);
    }
  });

  it("refuses a TikTok with neither cover image nor caption, without calling the model", async () => {
    const net = network({ thumb: "missing" });
    const { model, prompts } = claude();
    const error = await analyzer(model, net.fetch)
      .analyze(ctx, {
        source: "tiktok_video",
        mediaUrl: MEDIA_URL,
        thumbnailUrl: THUMB,
        language: "en",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({ code: "invalid_input", retryable: false });
    expect(prompts).toHaveLength(0);
  });
});
