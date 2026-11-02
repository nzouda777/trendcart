import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/domain/contracts";

import type { HttpFetch } from "./http";
import { parseTikTokUrl, resolveShortLink, tryParseTikTokUrl } from "./links";

const ID = "7412345678901234567";

describe("parseTikTokUrl", () => {
  it.each([
    [`https://www.tiktok.com/@shop.daily/video/${ID}`, "shop.daily"],
    [
      `https://www.tiktok.com/@shop.daily/video/${ID}?is_from_webapp=1&sender_device=pc`,
      "shop.daily",
    ],
    [`tiktok.com/@shop.daily/video/${ID}`, "shop.daily"],
    [`  https://TIKTOK.com/@shop.daily/video/${ID}/  `, "shop.daily"],
    [`https://www.tiktok.com/@shop.daily/photo/${ID}`, "shop.daily"],
  ])("parses %s", (input, username) => {
    expect(parseTikTokUrl(input)).toEqual({
      kind: "video",
      videoId: ID,
      username,
      canonicalUrl: `https://www.tiktok.com/@${username}/video/${ID}`,
    });
  });

  it.each([
    `https://m.tiktok.com/v/${ID}.html`,
    `https://www.tiktok.com/embed/v2/${ID}`,
    `https://www.tiktok.com/embed/${ID}`,
  ])("parses id-only form %s", (input) => {
    expect(parseTikTokUrl(input)).toEqual({
      kind: "video",
      videoId: ID,
      username: null,
      canonicalUrl: `https://m.tiktok.com/v/${ID}.html`,
    });
  });

  it.each([
    ["https://vm.tiktok.com/ZMh7Abc12/", "https://vm.tiktok.com/ZMh7Abc12/"],
    ["vt.tiktok.com/ZSabc123", "https://vt.tiktok.com/ZSabc123/"],
    ["https://www.tiktok.com/t/ZTRk9xyz/", "https://www.tiktok.com/t/ZTRk9xyz/"],
  ])("recognizes short link %s", (input, shortUrl) => {
    expect(parseTikTokUrl(input)).toMatchObject({ kind: "short", shortUrl });
  });

  it.each([
    "",
    "not a url",
    "https://www.tiktok.com/@shop.daily",
    "https://www.tiktok.com/tag/gadgets",
    `https://www.tiktok.com/@shop/video/123`,
    `https://evil-tiktok.com/@a/video/${ID}`,
    `https://tiktok.com.evil.io/@a/video/${ID}`,
    `ftp://www.tiktok.com/@a/video/${ID}`,
    `https://user:pw@www.tiktok.com/@a/video/${ID}`,
    "https://www.youtube.com/watch?v=abc",
  ])("rejects %s", (input) => {
    expect(tryParseTikTokUrl(input)).toBeNull();
    expect(() => parseTikTokUrl(input)).toThrow(IntegrationError);
  });
});

function redirectingFetch(
  hops: Record<string, { status: number; location?: string }>,
): HttpFetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const hop = hops[url] ?? { status: 200 };
    return new Response(null, {
      status: hop.status,
      headers: hop.location ? { location: hop.location } : {},
    });
  }) as unknown as HttpFetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("resolveShortLink", () => {
  it("follows redirects to the canonical video", async () => {
    const fetch = redirectingFetch({
      "https://vm.tiktok.com/ZMh7Abc12/": {
        status: 301,
        location: "https://www.tiktok.com/t/ZMh7Abc12/",
      },
      "https://www.tiktok.com/t/ZMh7Abc12/": {
        status: 302,
        location: `https://www.tiktok.com/@shop.daily/video/${ID}?_t=8abc&_r=1`,
      },
    });
    const short = parseTikTokUrl("https://vm.tiktok.com/ZMh7Abc12/");
    if (short.kind !== "short") throw new Error("expected short");
    await expect(resolveShortLink(short, fetch)).resolves.toMatchObject({
      videoId: ID,
      username: "shop.daily",
    });
    expect(fetch.calls).toHaveLength(2);
  });

  it("refuses redirects off tiktok.com", async () => {
    const fetch = redirectingFetch({
      "https://vm.tiktok.com/ZMh7Abc12/": { status: 302, location: "https://phish.example/x" },
    });
    const short = parseTikTokUrl("https://vm.tiktok.com/ZMh7Abc12/");
    if (short.kind !== "short") throw new Error("expected short");
    await expect(resolveShortLink(short, fetch)).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a dead short link to not_found", async () => {
    const fetch = redirectingFetch({ "https://vm.tiktok.com/ZMdead123/": { status: 404 } });
    const short = parseTikTokUrl("https://vm.tiktok.com/ZMdead123/");
    if (short.kind !== "short") throw new Error("expected short");
    await expect(resolveShortLink(short, fetch)).rejects.toMatchObject({ code: "not_found" });
  });
});
