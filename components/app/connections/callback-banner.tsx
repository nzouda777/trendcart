import Link from "next/link";

import { Notice } from "../surface";

/*
 * Result of an OAuth round trip, read from /app/connections query params set
 * by app/api/shopify/* and app/api/tiktok/*. Only short codes come back in the
 * URL (never provider messages or tokens); we map them to plain text here.
 */

type Params = Record<string, string | string[] | undefined>;

const REASONS: Record<string, string> = {
  forbidden: "Your role cannot connect accounts. Ask a media buyer or an owner.",
  not_found: "The brand was not found in this workspace.",
  unauthenticated: "Your session expired. Sign in and try again.",
  no_workspace: "Pick a workspace first.",
  invalid_state: "The connection request expired or was already used. Start again.",
  invalid_input: "The request was incomplete. Check the store domain and try again.",
  invalid_shop: "That does not look like a myshopify.com store domain.",
  invalid_hmac: "Shopify's signature could not be verified. Start again.",
  auth_expired: "Authorization expired. Start again.",
  permission_denied: "Access was declined or a required permission is missing.",
  not_configured:
    "TikTok is not set up on this server yet: its app key and secret are missing. Add them to the environment variables and redeploy.",
  rate_limited: "The provider is rate limiting requests. Try again in a minute.",
  quota_exceeded: "A usage limit was reached. Try again later.",
  provider_error: "The provider returned an error. Try again.",
  unexpected: "Something went wrong. Try again.",
};

function reasonText(code: string | undefined) {
  if (!code) return REASONS.unexpected;
  return REASONS[code] ?? `${REASONS.unexpected} (code: ${code.slice(0, 40)})`;
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type Banner = { tone: "success" | "warning" | "danger"; title: string; body?: string };

export function callbackBanners(params: Params): Banner[] {
  const out: Banner[] = [];
  const shopify = one(params.shopify);
  const shopifyError = one(params.shopify_error);
  const shopifyWarning = one(params.shopify_warning);
  const ads = one(params.tiktok_ads);
  const login = one(params.tiktok_login);
  const reason = one(params.reason);

  if (one(params.welcome) === "1") {
    out.push({
      tone: "success",
      title: "Brand created",
      body: "Next, connect its Shopify store and TikTok accounts.",
    });
  }
  if (shopify === "connected") out.push({ tone: "success", title: "Shopify store connected" });
  if (shopifyWarning === "metafields_pending") {
    out.push({
      tone: "warning",
      title: "Store connected, setup still finishing",
      body: "Trendcart could not create its product metafields yet. It retries automatically before the first page is built.",
    });
  }
  if (shopifyError) {
    out.push({
      tone: "danger",
      title: "Shopify connection failed",
      body: reasonText(shopifyError),
    });
  }
  if (ads === "connected") {
    const count = Number(one(params.count) ?? "0");
    out.push({
      tone: "success",
      title:
        count === 1
          ? "1 TikTok ad account connected"
          : `${Number.isFinite(count) ? count : 0} TikTok ad accounts connected`,
    });
  }
  if (ads === "error") {
    out.push({ tone: "danger", title: "TikTok Ads connection failed", body: reasonText(reason) });
  }
  if (login === "connected") {
    const profile = one(params.profile)?.slice(0, 100);
    out.push({
      tone: "success",
      title: profile ? `TikTok profile ${profile} connected` : "TikTok profile connected",
    });
  }
  if (login === "error") {
    out.push({
      tone: "danger",
      title: "TikTok profile connection failed",
      body: reasonText(reason),
    });
  }
  return out;
}

export function CallbackBanners({ params }: { params: Params }) {
  const banners = callbackBanners(params);
  if (banners.length === 0) return null;
  return (
    <div className="grid gap-2">
      {banners.map((b) => (
        <Notice
          key={b.title}
          tone={b.tone}
          title={b.title}
          action={
            <Link
              href="/app/connections"
              scroll={false}
              className="rounded-md text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Dismiss
            </Link>
          }
        >
          {b.body}
        </Notice>
      ))}
    </div>
  );
}
