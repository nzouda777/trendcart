import "server-only";

import type { Integrations } from "@/lib/domain/contracts";
import { getIntegrations } from "@/lib/integrations";
import { getConcurrencyLimiter, type ConcurrencyLimiter } from "@/lib/workflows/concurrency";
import { createDurablePipeline } from "@/lib/workflows/durable/pipeline";
import { createInlinePipeline, type ProductPipeline } from "@/lib/workflows/pipeline";
import type { Sleep } from "@/lib/workflows/retry";

import type { RateLimiter, RebuildLimiters } from "./rate-limit";

/**
 * Optional dependencies every service accepts as its last argument. Pages and
 * actions pass nothing (defaults: the integration registry for
 * INTEGRATIONS_MODE, the Upstash limiter, the inline pipeline). Tests pass
 * fakes.
 */
export type ServiceDeps = {
  integrations?: Integrations;
  limiter?: ConcurrencyLimiter;
  pipeline?: ProductPipeline;
  now?: () => Date;
  sleep?: Sleep;
  /** Monthly AI cap override in USD (default AI_MONTHLY_CAP_USD, see lib/ai). */
  aiCapUsd?: number;
  /** Import rate limiter (default: Upstash, IMPORT_RATE_LIMIT_PER_HOUR per workspace). */
  importLimiter?: RateLimiter;
  /**
   * Paid rebuild limiters: GATE 2 re-search, GATE 3 page rejection and
   * regeneration (default: Upstash, 10/h per product and 60/h per workspace).
   */
  rebuildLimiters?: RebuildLimiters;
};

export function resolveIntegrations(deps: ServiceDeps): Integrations {
  return deps.integrations ?? getIntegrations();
}

export function resolveNow(deps: ServiceDeps): () => Date {
  return deps.now ?? (() => new Date());
}

export type PipelineEngine = "workflow" | "inline";

/**
 * PIPELINE_ENGINE=workflow|inline. Default: Vercel Workflow on Vercel
 * (VERCEL=1), inline elsewhere (local dev with PGlite, tests). The inline
 * engine runs each step synchronously inside the service call.
 */
export function pipelineEngine(env: NodeJS.ProcessEnv = process.env): PipelineEngine {
  const value = env.PIPELINE_ENGINE?.trim().toLowerCase();
  if (value === "workflow" || value === "inline") return value;
  return env.VERCEL === "1" ? "workflow" : "inline";
}

export function resolvePipeline(deps: ServiceDeps): ProductPipeline {
  if (deps.pipeline) return deps.pipeline;
  if (pipelineEngine() === "workflow") return createDurablePipeline();
  return createInlinePipeline({
    integrations: resolveIntegrations(deps),
    limiter: deps.limiter ?? getConcurrencyLimiter(),
    now: deps.now,
    sleep: deps.sleep,
    aiCapUsd: deps.aiCapUsd,
  });
}
