import { MissingConfigError, type Env } from "./safety";

/*
 * TikTok API for Business (Marketing API) settings.
 *
 * Pinned version: v1.3 (current stable; endpoints verified against TikTok's
 * official Business API SDK spec, github.com/tiktok/tiktok-business-api-sdk).
 *
 * - Advertiser authorization page: https://business-api.tiktok.com/portal/auth
 * - Production API:  https://business-api.tiktok.com/open_api/v1.3
 * - Sandbox API:     https://sandbox-ads.tiktok.com/open_api/v1.3
 *
 * OAuth (oauth2/*) always uses the production host: the sandbox has no
 * advertiser authorization flow (its token is generated in the developer
 * portal). With TIKTOK_SANDBOX=true every other call goes to the sandbox host.
 */

export const TIKTOK_ADS_PROVIDER = "tiktok_ads";
export const MARKETING_API_VERSION = "v1.3";
export const ADS_AUTH_URL = "https://business-api.tiktok.com/portal/auth";
export const ADS_PROD_BASE = `https://business-api.tiktok.com/open_api/${MARKETING_API_VERSION}`;
export const ADS_SANDBOX_BASE = `https://sandbox-ads.tiktok.com/open_api/${MARKETING_API_VERSION}`;

export type TikTokAdsConfig = {
  appId: string;
  appSecret: string;
  sandbox: boolean;
};

export function isSandbox(env: Env = process.env): boolean {
  // Sandbox unless explicitly turned off: safer default.
  return (env.TIKTOK_SANDBOX ?? "true").toLowerCase() !== "false";
}

/** Read lazily, at call time, so builds and mock mode need no secrets. */
export function readAdsConfig(env: Env = process.env): TikTokAdsConfig {
  const appId = env.TIKTOK_APP_ID;
  const appSecret = env.TIKTOK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new MissingConfigError(TIKTOK_ADS_PROVIDER, ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"]);
  }
  return { appId, appSecret, sandbox: isSandbox(env) };
}

export function resourceBase(config: TikTokAdsConfig): string {
  return config.sandbox ? ADS_SANDBOX_BASE : ADS_PROD_BASE;
}
