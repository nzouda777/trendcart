import { z } from "zod";

/**
 * Workspace settings: which AI model does what, the monthly AI budget and the
 * time limits of the AI steps. Stored in `workspace_settings`; null means
 * "default" (env var, then the built-in value below).
 */

/** Gemini models that can analyse a video (Files API) and are priced in lib/ai/pricing. */
export const ANALYSIS_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (recommended)" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (cheapest, less accurate)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
] as const;

/** Claude models for product page copy, priced in lib/ai/pricing. */
export const COPYWRITING_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best copy)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
] as const;

type Ids<T extends readonly { id: string }[]> = T[number]["id"];
export type AnalysisModelId = Ids<typeof ANALYSIS_MODELS>;
export type CopywritingModelId = Ids<typeof COPYWRITING_MODELS>;

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((m) => m.id) as [Ids<T>, ...Ids<T>[]];

/**
 * Time limits in seconds. The maximum stays under the Vercel function limit
 * (300 s on Hobby) so a slow call ends with a clean, retryable error instead
 * of the function being killed mid-step.
 */
export const TIMEOUT_LIMITS = { minSec: 30, maxSec: 270 } as const;
export const DEFAULT_ANALYSIS_TIMEOUT_SEC = 210;
export const DEFAULT_COPYWRITING_TIMEOUT_SEC = 240;
export const MAX_AI_MONTHLY_CAP_USD = 100_000;

const timeoutSec = z
  .number()
  .int("Use whole seconds.")
  .min(TIMEOUT_LIMITS.minSec, `At least ${TIMEOUT_LIMITS.minSec} seconds.`)
  .max(TIMEOUT_LIMITS.maxSec, `At most ${TIMEOUT_LIMITS.maxSec} seconds.`);

/** What an owner can save. Null (or omitted) resets a field to its default. */
export const workspaceSettingsInputSchema = z.object({
  analysisModel: z.enum(ids(ANALYSIS_MODELS)).nullable().optional(),
  copywritingModel: z.enum(ids(COPYWRITING_MODELS)).nullable().optional(),
  aiMonthlyCapUsd: z
    .number()
    .min(0, "Use 0 or more (0 turns AI off).")
    .max(MAX_AI_MONTHLY_CAP_USD)
    .nullable()
    .optional(),
  analysisTimeoutSec: timeoutSec.nullable().optional(),
  copywritingTimeoutSec: timeoutSec.nullable().optional(),
});
export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsInputSchema>;

/**
 * Per-call AI settings carried by CallContext.ai (built by
 * lib/workflows/call-context). Adapters fall back to their defaults for any
 * missing field.
 */
export const aiCallSettingsSchema = z.object({
  analysisModel: z.string().min(1).optional(),
  copywritingModel: z.string().min(1).optional(),
  analysisTimeoutMs: z.number().int().positive().optional(),
  copywritingTimeoutMs: z.number().int().positive().optional(),
});
export type AiCallSettings = z.infer<typeof aiCallSettingsSchema>;
