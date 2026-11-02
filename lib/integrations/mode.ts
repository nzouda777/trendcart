import { integrationsModeSchema, type IntegrationsMode } from "@/lib/domain/contracts";

type Env = Record<string, string | undefined>;

/**
 * INTEGRATIONS_MODE, defaulting to "mock" everywhere except Vercel
 * production, where it must be set explicitly to "live": mock mode there
 * would accept the public mock Shopify secret for webhooks and print auth
 * links to the logs.
 */
export function resolveIntegrationsMode(env: Env = process.env): IntegrationsMode {
  const raw = env.INTEGRATIONS_MODE?.trim();
  const mode = integrationsModeSchema.parse(raw || "mock");
  if (env.VERCEL_ENV === "production" && mode !== "live") {
    throw new Error(
      raw
        ? 'INTEGRATIONS_MODE="mock" is not allowed in production. Set INTEGRATIONS_MODE=live.'
        : "INTEGRATIONS_MODE must be set to live in production.",
    );
  }
  return mode;
}

/**
 * AI_MODE overrides INTEGRATIONS_MODE for the read-only analysis adapters:
 * TikTok data (import, related videos), product analysis, supplier search and
 * page copywriting. Shopify, TikTok Ads, TikTok posting, compliance and email
 * keep following INTEGRATIONS_MODE, so `INTEGRATIONS_MODE=mock AI_MODE=live`
 * tests real identification without writing to any store or ad account.
 *
 * Unset: same as INTEGRATIONS_MODE. "mock" is refused in Vercel production.
 */
export function resolveAiMode(env: Env = process.env): IntegrationsMode {
  const raw = env.AI_MODE?.trim();
  if (!raw) return resolveIntegrationsMode(env);
  const mode = integrationsModeSchema.parse(raw);
  if (env.VERCEL_ENV === "production" && mode !== "live") {
    throw new Error('AI_MODE="mock" is not allowed in production. Set AI_MODE=live or remove it.');
  }
  return mode;
}
