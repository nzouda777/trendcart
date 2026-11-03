import "server-only";

import { requirePermission } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { workspaceSettings } from "@/lib/db/schema";
import { workspaceSettingsInputSchema, type WorkspaceSettingsInput } from "@/lib/domain/settings";
import { effectiveSettings, getSettingsRow, type EffectiveSettings } from "@/lib/settings";
import { actorUserId, type WorkspaceContext } from "@/lib/tenant/context";

/**
 * Workspace settings: AI models, monthly AI budget and AI time limits.
 * Everyone in the workspace can read them; only owners can change them.
 */

export type WorkspaceSettingsDTO = EffectiveSettings;

const FIELDS = [
  "analysisModel",
  "copywritingModel",
  "aiMonthlyCapUsd",
  "analysisTimeoutSec",
  "copywritingTimeoutSec",
] as const;

export async function getWorkspaceSettings(ctx: WorkspaceContext): Promise<WorkspaceSettingsDTO> {
  requirePermission(ctx, "workspace:read");
  return effectiveSettings(await getSettingsRow(ctx.db));
}

/**
 * Saves the given fields; null resets a field to its default, an omitted
 * field is left unchanged. Audited as `settings.update` with from/to values.
 */
export async function updateWorkspaceSettings(
  ctx: WorkspaceContext,
  input: WorkspaceSettingsInput,
): Promise<WorkspaceSettingsDTO> {
  requirePermission(ctx, "workspace:update");
  const values = workspaceSettingsInputSchema.parse(input);
  type Patch = Partial<Pick<typeof workspaceSettings.$inferInsert, (typeof FIELDS)[number]>>;
  const patch = Object.fromEntries(
    FIELDS.filter((k) => values[k] !== undefined).map((k) => [k, values[k] ?? null]),
  ) as Patch;

  const row = await ctx.db.transaction(async (tx) => {
    const before = await getSettingsRow(tx);
    const changed = Object.fromEntries(
      Object.entries(patch)
        .map(([k, to]) => {
          const raw = before?.[k as keyof typeof before] ?? null;
          const from = k === "aiMonthlyCapUsd" && raw !== null ? Number(raw) : raw;
          return [k, { from, to }] as const;
        })
        .filter(([, v]) => v.from !== v.to),
    );
    const saved = await tx.upsert(
      workspaceSettings,
      { ...patch, updatedBy: actorUserId(ctx) },
      { target: () => [], set: { ...patch, updatedBy: actorUserId(ctx), updatedAt: new Date() } },
    );
    if (Object.keys(changed).length > 0) {
      await writeAudit(
        { ...ctx, db: tx },
        {
          action: "settings.update",
          targetType: "workspace_settings",
          targetId: saved.id,
          metadata: { changed },
        },
      );
    }
    return saved;
  });
  return effectiveSettings(row);
}
