import "server-only";

import { aiCapParts, planAiCap } from "@/lib/ai/metering";
import { requirePermission } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { workspaceSettings } from "@/lib/db/schema";
import { workspaceSettingsInputSchema, type WorkspaceSettingsInput } from "@/lib/domain/settings";
import { effectiveSettings, getSettingsRow, type EffectiveSettings } from "@/lib/settings";
import { actorUserId, type WorkspaceContext } from "@/lib/tenant/context";
import type { ScopedDb } from "@/lib/tenant/scoped-db";

import { ServiceError } from "./errors";

/**
 * Workspace settings: AI models, monthly AI budget and AI time limits.
 * Everyone in the workspace can read them; only owners can change them.
 */

export type WorkspaceSettingsDTO = EffectiveSettings & {
  aiCap: {
    /** The subscribed plan's AI budget: the owner cannot go above it. Null: no plan cap. */
    planMax: number | null;
    /** Set by Trendcart support: wins over the owner's value. */
    adminOverride: number | null;
  };
};

/** Effective settings with the AI budget resolved against the plan and the admin value. */
async function withAiCap(db: ScopedDb, base: EffectiveSettings): Promise<WorkspaceSettingsDTO> {
  const parts = await aiCapParts(db);
  const defaultValue = parts.planCap ?? parts.defaultCap;
  return {
    ...base,
    aiMonthlyCapUsd: {
      value: parts.effective,
      isDefault: parts.ownerCap === null && parts.adminCap === null,
      defaultValue,
    },
    aiCap: { planMax: parts.planCap, adminOverride: parts.adminCap },
  };
}

const FIELDS = [
  "analysisModel",
  "copywritingModel",
  "aiMonthlyCapUsd",
  "analysisTimeoutSec",
  "copywritingTimeoutSec",
] as const;

export async function getWorkspaceSettings(ctx: WorkspaceContext): Promise<WorkspaceSettingsDTO> {
  requirePermission(ctx, "workspace:read");
  return withAiCap(ctx.db, effectiveSettings(await getSettingsRow(ctx.db)));
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
  if (typeof values.aiMonthlyCapUsd === "number") {
    const planMax = await planAiCap(ctx.db);
    if (planMax !== null && values.aiMonthlyCapUsd > planMax) {
      throw new ServiceError(
        "invalid_input",
        `Your plan allows a monthly AI budget of up to ${planMax} USD. Upgrade in Billing for more.`,
        { reason: "plan_limit" },
      );
    }
  }
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
  return withAiCap(ctx.db, effectiveSettings(row));
}
