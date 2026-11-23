"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/components/app/action-result";
import type {
  CampaignPresetKind,
  CampaignPresetSettingsInput,
} from "@/lib/domain/campaign-presets";
import {
  createCampaignPreset,
  deleteCampaignPreset,
  setDefaultCampaignPreset,
  updateCampaignPreset,
} from "@/lib/services";

import { runAction } from "../_lib/action";

/*
 * Saved campaign settings of a brand ("Brand new campaign setup 1",
 * "Campaign duplicate settings 2"…). Each action calls one service, which
 * checks the role (Media buyer or Owner) and audits the change.
 */

export type PresetFormInput = {
  name: string;
  isDefault: boolean;
  settings: CampaignPresetSettingsInput;
};

const FORBIDDEN = "Only a Media buyer or the Owner can change campaign presets.";

function explain<T>(result: ActionResult<T>): ActionResult<T> {
  if (result.ok) {
    refresh();
    return result;
  }
  return result.code === "forbidden" ? { ...result, error: FORBIDDEN } : result;
}

export async function createPresetAction(
  brandId: string,
  kind: CampaignPresetKind,
  input: PresetFormInput,
): Promise<ActionResult<{ id: string }>> {
  return explain(
    await runAction(async (ctx) => {
      const preset = await createCampaignPreset(ctx, { brandId, kind, ...input });
      return { id: preset.id };
    }),
  );
}

export async function updatePresetAction(
  presetId: string,
  input: PresetFormInput,
): Promise<ActionResult<{ id: string }>> {
  return explain(
    await runAction(async (ctx) => {
      const preset = await updateCampaignPreset(ctx, { presetId, ...input });
      return { id: preset.id };
    }),
  );
}

export async function deletePresetAction(presetId: string): Promise<ActionResult> {
  return explain(
    await runAction(async (ctx) => {
      await deleteCampaignPreset(ctx, { presetId });
      return undefined;
    }),
  );
}

export async function setDefaultPresetAction(presetId: string): Promise<ActionResult> {
  return explain(
    await runAction(async (ctx) => {
      await setDefaultCampaignPreset(ctx, { presetId });
      return undefined;
    }),
  );
}
