/**
 * Import link parsing: decides whether user input is a TikTok video link or
 * a product link, and normalizes product links (pure).
 *
 * Product links must be public http(s) URLs: no credentials, no IP literals,
 * no localhost / internal names (we fetch them server-side, so this is also
 * an SSRF guard). Tracking parameters are dropped so the same product link
 * dedupes to one source_url.
 *
 * This is the static half of the SSRF guard. Names that resolve to private
 * addresses are refused at connect time by the guarded dispatcher
 * (lib/integrations/tiktok-data/net-guard.ts) on every fetch and redirect hop.
 */
import { IntegrationError } from "@/lib/domain/contracts";
import {
  isTikTokHost,
  toUrl,
  tryParseTikTokUrl,
  type TikTokLink,
} from "@/lib/integrations/tiktok-data/links";
import { isPublicHostname } from "@/lib/integrations/tiktok-data/net-guard";

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^ttclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^_t$/i,
  /^_r$/i,
  /^spm$/i,
  /^scm$/i,
  /^aff_/i,
  /^sk$/i,
  /^ref_?$/i,
  /^igshid$/i,
];

function invalid(message: string): IntegrationError {
  return new IntegrationError("product-link", "invalid_input", message, { retryable: false });
}

function isIpLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[") || /^\d+$/.test(hostname)
  );
}

/** Returns a normalized public product URL or throws IntegrationError("invalid_input"). */
export function normalizeProductUrl(input: string): string {
  const url = toUrl(input);
  if (!url) throw invalid("Enter a valid product link (https://...).");
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw invalid("Only http(s) product links are supported.");
  if (url.username || url.password) throw invalid("Links with credentials are not allowed.");
  if (url.port && url.port !== "80" && url.port !== "443")
    throw invalid("Links with a custom port are not allowed.");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpLiteral(host)) throw invalid("Use the store's domain name, not an IP address.");
  if (!isPublicHostname(host)) throw invalid("This link does not point to a public website.");

  url.hostname = host;
  url.hash = "";
  url.port = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

export type ImportLink =
  { sourceType: "tiktok_video"; tiktok: TikTokLink } | { sourceType: "product_link"; url: string };

/** Classifies an import link. TikTok links that are not videos (profiles, tags) are rejected. */
export function parseImportLink(input: string): ImportLink {
  const tiktok = tryParseTikTokUrl(input);
  if (tiktok) return { sourceType: "tiktok_video", tiktok };

  const url = toUrl(input);
  if (url && isTikTokHost(url.hostname)) {
    throw invalid("This TikTok link is not a video. Paste the link of a TikTok video.");
  }
  return { sourceType: "product_link", url: normalizeProductUrl(input) };
}
