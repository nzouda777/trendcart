import "server-only";

/**
 * Effective workspace settings: the saved value when there is one, else the
 * env var, else the built-in default. Read through the scoped db, so a
 * workspace only ever sees its own row.
 */
import { getAiMonthlyCapUsd } from "@/lib/ai/metering";
import { modelIds } from "@/lib/ai/pricing";
import { workspaceSettings } from "@/lib/db/schema";
import {
  DEFAULT_ANALYSIS_TIMEOUT_SEC,
  DEFAULT_COPYWRITING_TIMEOUT_SEC,
  type AiCallSettings,
} from "@/lib/domain/settings";
import type { ScopedDb } from "@/lib/tenant/scoped-db";

export type SettingsRow = typeof workspaceSettings.$inferSelect;

/** The value in use, whether it is the default, and the default itself. */
type Effective<T> = { value: T; isDefault: boolean; defaultValue: T };

export type EffectiveSettings = {
  analysisModel: Effective<string>;
  copywritingModel: Effective<string>;
  aiMonthlyCapUsd: Effective<number>;
  analysisTimeoutSec: Effective<number>;
  copywritingTimeoutSec: Effective<number>;
  updatedAt: Date | null;
};

const pick = <T>(saved: T | null | undefined, fallback: T): Effective<T> =>
  saved === null || saved === undefined
    ? { value: fallback, isDefault: true, defaultValue: fallback }
    : { value: saved, isDefault: false, defaultValue: fallback };

export async function getSettingsRow(db: ScopedDb): Promise<SettingsRow | null> {
  return (await db.findFirst(workspaceSettings)) ?? null;
}

export function effectiveSettings(row: SettingsRow | null): EffectiveSettings {
  const models = modelIds();
  return {
    analysisModel: pick(row?.analysisModel, models.productAnalysis),
    copywritingModel: pick(row?.copywritingModel, models.copywriting),
    aiMonthlyCapUsd: pick(
      row?.aiMonthlyCapUsd === null || row?.aiMonthlyCapUsd === undefined
        ? null
        : Number(row.aiMonthlyCapUsd),
      getAiMonthlyCapUsd(),
    ),
    analysisTimeoutSec: pick(row?.analysisTimeoutSec, DEFAULT_ANALYSIS_TIMEOUT_SEC),
    copywritingTimeoutSec: pick(row?.copywritingTimeoutSec, DEFAULT_COPYWRITING_TIMEOUT_SEC),
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function loadEffectiveSettings(db: ScopedDb): Promise<EffectiveSettings> {
  return effectiveSettings(await getSettingsRow(db));
}

/** The CallContext.ai block adapters read. */
export function aiCallSettings(settings: EffectiveSettings): AiCallSettings {
  return {
    analysisModel: settings.analysisModel.value,
    copywritingModel: settings.copywritingModel.value,
    analysisTimeoutMs: settings.analysisTimeoutSec.value * 1000,
    copywritingTimeoutMs: settings.copywritingTimeoutSec.value * 1000,
  };
}
