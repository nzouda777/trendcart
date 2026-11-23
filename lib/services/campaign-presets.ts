import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guards";
import {
  campaignPresetKindSchema,
  campaignPresetSettingsSchema,
  type CampaignPresetKind,
  type CampaignPresetSettings,
} from "@/lib/domain/campaign-presets";
import { brand, campaignPreset } from "@/lib/db/schema";
import { COUNTRY_LOCATION_IDS } from "@/lib/integrations/tiktok-ads/geo";
import { actorUserId, type WorkspaceContext } from "@/lib/tenant/context";
import type { Row, ScopedDb } from "@/lib/tenant/scoped-db";

import { idSchema } from "./brands";
import { ServiceError } from "./errors";

/*
 * Saved campaign settings per brand (lib/domain/campaign-presets). Read by
 * anyone who can read campaigns; created, changed and deleted by a Media
 * buyer or the Owner (campaign:update), audited `campaign.preset_change`
 * because a preset decides budgets.
 */

export const MAX_PRESETS_PER_KIND = 20;

export type CampaignPresetDTO = {
  id: string;
  brandId: string;
  kind: CampaignPresetKind;
  name: string;
  isDefault: boolean;
  settings: CampaignPresetSettings;
  updatedAt: string;
};

type PresetRow = Row<typeof campaignPreset>;

/** Stored settings, re-parsed so old rows get new defaults. Bad rows fall back to the defaults. */
function settingsOf(row: Pick<PresetRow, "settings">): CampaignPresetSettings {
  const parsed = campaignPresetSettingsSchema.safeParse(row.settings ?? {});
  return parsed.success ? parsed.data : campaignPresetSettingsSchema.parse({});
}

function toDTO(row: PresetRow): CampaignPresetDTO {
  return {
    id: row.id,
    brandId: row.brandId,
    kind: row.kind,
    name: row.name,
    isDefault: row.isDefault,
    settings: settingsOf(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertSupportedCountries(settings: CampaignPresetSettings) {
  const unknown = settings.targeting.countries.filter((c) => !COUNTRY_LOCATION_IDS[c]);
  if (unknown.length) {
    throw new ServiceError(
      "invalid_input",
      `TikTok targeting is not set up for: ${unknown.join(", ")}. Remove them or ask support to add them.`,
    );
  }
}

const nameSchema = z.string().trim().min(1, "Give the preset a name.").max(80);

const listSchema = z.object({ brandId: idSchema, kind: campaignPresetKindSchema.optional() });

export async function listCampaignPresets(
  ctx: WorkspaceContext,
  input: z.input<typeof listSchema>,
): Promise<CampaignPresetDTO[]> {
  requirePermission(ctx, "campaign:read");
  const v = listSchema.parse(input);
  await ctx.db.getById(brand, v.brandId);
  const rows = await ctx.db.select(campaignPreset, {
    where: and(
      eq(campaignPreset.brandId, v.brandId),
      v.kind ? eq(campaignPreset.kind, v.kind) : undefined,
    ),
    orderBy: (t) => [asc(t.kind), asc(t.createdAt)],
  });
  return rows.map(toDTO);
}

/** A preset of the brand and kind, or a not_found AccessError / invalid_input. */
export async function loadPresetFor(
  db: ScopedDb,
  input: { presetId: string; brandId: string; kind: CampaignPresetKind },
): Promise<{ id: string; name: string; settings: CampaignPresetSettings }> {
  const row = await db.findById(campaignPreset, input.presetId);
  if (!row || row.brandId !== input.brandId || row.kind !== input.kind) {
    throw new ServiceError(
      "invalid_input",
      input.kind === "new_test"
        ? "Choose one of this brand's brand new campaign setups."
        : "Choose one of this brand's campaign duplicate settings.",
    );
  }
  return { id: row.id, name: row.name, settings: settingsOf(row) };
}

/** The brand's default preset of a kind, or null (built-in settings). */
export async function defaultPresetFor(
  db: ScopedDb,
  brandId: string,
  kind: CampaignPresetKind,
): Promise<{ id: string; name: string; settings: CampaignPresetSettings } | null> {
  const row = await db.findFirst(
    campaignPreset,
    and(
      eq(campaignPreset.brandId, brandId),
      eq(campaignPreset.kind, kind),
      eq(campaignPreset.isDefault, true),
    ),
  );
  return row ? { id: row.id, name: row.name, settings: settingsOf(row) } : null;
}

const saveSchema = z.object({
  brandId: idSchema,
  kind: campaignPresetKindSchema,
  name: nameSchema,
  isDefault: z.boolean().default(false),
  settings: campaignPresetSettingsSchema,
});

async function assertNameFree(
  tx: ScopedDb,
  v: { brandId: string; kind: CampaignPresetKind; name: string },
  exceptId?: string,
) {
  const clash = await tx.findFirst(
    campaignPreset,
    and(
      eq(campaignPreset.brandId, v.brandId),
      eq(campaignPreset.kind, v.kind),
      eq(campaignPreset.name, v.name),
      exceptId ? ne(campaignPreset.id, exceptId) : undefined,
    ),
  );
  if (clash) throw new ServiceError("invalid_input", `A preset named "${v.name}" already exists.`);
}

async function clearDefault(tx: ScopedDb, brandId: string, kind: CampaignPresetKind) {
  await tx.update(
    campaignPreset,
    { isDefault: false },
    and(
      eq(campaignPreset.brandId, brandId),
      eq(campaignPreset.kind, kind),
      eq(campaignPreset.isDefault, true),
    ),
  );
}

export async function createCampaignPreset(
  ctx: WorkspaceContext,
  input: z.input<typeof saveSchema>,
): Promise<CampaignPresetDTO> {
  requirePermission(ctx, "campaign:update");
  const v = saveSchema.parse(input);
  assertSupportedCountries(v.settings);
  return ctx.db.transaction(async (tx) => {
    await tx.getById(brand, v.brandId);
    const count = await tx.count(
      campaignPreset,
      and(eq(campaignPreset.brandId, v.brandId), eq(campaignPreset.kind, v.kind)),
    );
    if (count >= MAX_PRESETS_PER_KIND) {
      throw new ServiceError(
        "invalid_input",
        `A brand can keep up to ${MAX_PRESETS_PER_KIND} presets of each kind. Delete one first.`,
      );
    }
    await assertNameFree(tx, v);
    // The first preset of a kind becomes the default.
    const isDefault = v.isDefault || count === 0;
    if (isDefault) await clearDefault(tx, v.brandId, v.kind);
    const row = await tx.insert(campaignPreset, {
      brandId: v.brandId,
      kind: v.kind,
      name: v.name,
      settings: v.settings,
      isDefault,
      createdBy: actorUserId(ctx),
      updatedBy: actorUserId(ctx),
    });
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.preset_change",
        targetType: "campaign_preset",
        targetId: row.id,
        metadata: { change: "create", brandId: v.brandId, kind: v.kind, name: v.name, isDefault },
      },
    );
    return toDTO(row);
  });
}

const updateSchema = z.object({
  presetId: idSchema,
  name: nameSchema,
  isDefault: z.boolean(),
  settings: campaignPresetSettingsSchema,
});

export async function updateCampaignPreset(
  ctx: WorkspaceContext,
  input: z.input<typeof updateSchema>,
): Promise<CampaignPresetDTO> {
  requirePermission(ctx, "campaign:update");
  const v = updateSchema.parse(input);
  assertSupportedCountries(v.settings);
  return ctx.db.transaction(async (tx) => {
    const current = await tx.getById(campaignPreset, v.presetId);
    await assertNameFree(tx, { ...current, name: v.name }, current.id);
    if (v.isDefault && !current.isDefault) await clearDefault(tx, current.brandId, current.kind);
    const [row] = await tx.update(
      campaignPreset,
      { name: v.name, settings: v.settings, isDefault: v.isDefault, updatedBy: actorUserId(ctx) },
      eq(campaignPreset.id, current.id),
    );
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.preset_change",
        targetType: "campaign_preset",
        targetId: current.id,
        metadata: {
          change: "update",
          brandId: current.brandId,
          kind: current.kind,
          name: v.name,
          isDefault: v.isDefault,
          budgetFrom: settingsOf(current).budget.amount,
          budgetTo: v.settings.budget.amount,
        },
      },
    );
    return toDTO(row!);
  });
}

const presetIdSchema = z.object({ presetId: idSchema });

/** Deletes a preset. Campaigns built from it keep their settings. */
export async function deleteCampaignPreset(
  ctx: WorkspaceContext,
  input: z.input<typeof presetIdSchema>,
): Promise<void> {
  requirePermission(ctx, "campaign:update");
  const v = presetIdSchema.parse(input);
  await ctx.db.transaction(async (tx) => {
    const current = await tx.getById(campaignPreset, v.presetId);
    await tx.delete(campaignPreset, eq(campaignPreset.id, current.id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.preset_change",
        targetType: "campaign_preset",
        targetId: current.id,
        metadata: {
          change: "delete",
          brandId: current.brandId,
          kind: current.kind,
          name: current.name,
        },
      },
    );
  });
}

/** Makes a preset the default of its kind for its brand. */
export async function setDefaultCampaignPreset(
  ctx: WorkspaceContext,
  input: z.input<typeof presetIdSchema>,
): Promise<void> {
  requirePermission(ctx, "campaign:update");
  const v = presetIdSchema.parse(input);
  await ctx.db.transaction(async (tx) => {
    const current = await tx.getById(campaignPreset, v.presetId);
    if (current.isDefault) return;
    await clearDefault(tx, current.brandId, current.kind);
    await tx.update(campaignPreset, { isDefault: true }, eq(campaignPreset.id, current.id));
    await writeAudit(
      { ...ctx, db: tx },
      {
        action: "campaign.preset_change",
        targetType: "campaign_preset",
        targetId: current.id,
        metadata: {
          change: "set_default",
          brandId: current.brandId,
          kind: current.kind,
          name: current.name,
        },
      },
    );
  });
}
