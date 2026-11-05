import { z } from "zod";

/**
 * Workspace settings: which AI model does what, the monthly AI budget and the
 * time limits of the AI steps. Stored in `workspace_settings`; null means
 * "default" (env var, then the built-in value below).
 */

/**
 * Who identifies the product and reviews videos against the ad rules:
 * - google (Gemini) watches the TikTok video itself (Files API);
 * - anthropic (Claude) cannot take video: it works from the cover image, the
 *   caption and the product page, and the ad rules review covers the text
 *   only (the video must be checked by hand).
 */
export const AI_VISION_PROVIDERS = [
  {
    id: "google",
    label: "Gemini",
    description: "Watches the TikTok video (visuals, on-screen text, speech).",
  },
  {
    id: "anthropic",
    label: "Claude",
    description:
      "Cannot watch videos: uses the cover image, caption and product page. Videos must be checked by hand for the ad rules.",
  },
] as const;
export type AiVisionProvider = (typeof AI_VISION_PROVIDERS)[number]["id"];

/**
 * Models for product identification (and, through their provider, the ad
 * rules review), all priced in lib/ai/pricing. The provider is part of the id.
 */
export const ANALYSIS_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (recommended)", provider: "google" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google" },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite (cheapest, less accurate)",
    provider: "google",
  },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (recommended)", provider: "anthropic" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most accurate)", provider: "anthropic" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheapest)", provider: "anthropic" },
] as const satisfies readonly { id: string; label: string; provider: AiVisionProvider }[];

/** Model used when Claude is chosen without a specific model. */
export const DEFAULT_CLAUDE_ANALYSIS_MODEL = "claude-sonnet-5-5";

/** Provider of an analysis model id (unknown ids are treated as Gemini, the default). */
export function analysisProviderOf(modelId: string | null | undefined): AiVisionProvider {
  return modelId?.startsWith("claude-") ? "anthropic" : "google";
}

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
