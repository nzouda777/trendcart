"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/components/app/action-result";
import type { WorkspaceSettingsInput } from "@/lib/domain/settings";
import { updateWorkspaceSettings } from "@/lib/services";

import { runAction } from "../_lib/action";

export async function updateSettingsAction(input: WorkspaceSettingsInput): Promise<ActionResult> {
  const result = await runAction(async (ctx) => {
    await updateWorkspaceSettings(ctx, input);
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}
