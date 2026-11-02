import "server-only";

/**
 * Fetches a product page (through the caller's proxied fetch) and reduces it
 * to compact text for the model: title, meta description, JSON-LD Product
 * data and visible text. In memory only, size-capped.
 */
import { IntegrationError } from "@/lib/domain/contracts";
import { httpStatusError, networkError, type HttpFetch } from "@/lib/integrations/tiktok-data/http";
import { normalizeProductUrl } from "@/lib/sourcing/links";

export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_PAGE_TEXT = 24_000;
const MAX_REDIRECTS = 5;

export type ExtractedPage = { url: string; title: string; text: string; imageUrl: string | null };

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (size >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return out + decoder.decode();
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = html.match(re);
  const value = m?.[1] ?? m?.[2];
  return value ? decodeEntities(value).trim() : null;
}

/** Pure: exported for tests. */
export function htmlToProductText(html: string, pageUrl: string): Omit<ExtractedPage, "url"> {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const description = meta(html, "og:description") ?? meta(html, "description") ?? "";

  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]!.trim())
    .filter((s) => /"@type"\s*:\s*"?(Product|Offer)/i.test(s))
    .join("\n")
    .slice(0, 8_000);

  const visible = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();

  let imageUrl: string | null = null;
  const og = meta(html, "og:image");
  if (og) {
    try {
      const abs = new URL(og, pageUrl);
      if (abs.protocol === "https:") imageUrl = abs.href;
    } catch {
      imageUrl = null;
    }
  }

  const text = [
    `Title: ${title}`,
    description && `Description: ${description}`,
    jsonLd && `Structured data:\n${jsonLd}`,
    `Visible text:\n${visible}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_PAGE_TEXT);
  return { title, text, imageUrl };
}

export async function extractPage(fetch: HttpFetch, rawUrl: string): Promise<ExtractedPage> {
  let url = normalizeProductUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en,*;q=0.5",
        },
      });
    } catch (error) {
      throw networkError("product-page", error);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      // Re-validate every hop: a public page must not redirect us to an internal host.
      url = normalizeProductUrl(new URL(location, url).href);
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw httpStatusError("product-page", res.status, "");
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(type)) {
      await res.body.cancel().catch(() => undefined);
      throw new IntegrationError(
        "product-page",
        "invalid_input",
        "The link does not point to a web page.",
        {
          retryable: false,
        },
      );
    }
    const html = await readCapped(res.body as ReadableStream<Uint8Array>, MAX_PAGE_BYTES);
    return { url, ...htmlToProductText(html, url) };
  }
  throw new IntegrationError("product-page", "invalid_input", "Too many redirects.", {
    retryable: false,
  });
}
