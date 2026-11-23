import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import {
  DEFAULT_YEARLY_MULTIPLIER,
  CURRENCY,
  planInputSchema,
  planLimitsSchema,
  toCents,
  yearlyCents,
  type PlanInput,
  type PlanLimits,
} from "@/lib/domain/billing";
import { plan, platformSetting, workspaceSubscription } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { ServiceError } from "@/lib/services/errors";

import { writePlatformAudit } from "./audit";
import type { AdminContext } from "./guard";
import { getStripe, isStripeConfigured } from "./stripe";

/*
 * Plans and billing settings (platform admins). Prices are USD. A paid plan
 * is mirrored in Stripe as one Product with a monthly and a yearly Price.
 * Stripe prices cannot change amount: when the amount changes, new Prices are
 * created (the lookup keys move to them) and the old ones are archived.
 * Existing subscribers keep paying their old price; new ones pay the new one.
 */

export type PlanRow = typeof plan.$inferSelect;

export type BillingSettings = { yearlyMultiplier: number };

const billingSettingsSchema = z.object({
  yearlyMultiplier: z.number().min(1).max(24).default(DEFAULT_YEARLY_MULTIPLIER),
});

export async function getBillingSettings(db: Database): Promise<BillingSettings> {
  const [row] = await db.select().from(platformSetting).where(eq(platformSetting.key, "billing"));
  const parsed = billingSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : { yearlyMultiplier: DEFAULT_YEARLY_MULTIPLIER };
}

export function effectiveMultiplier(row: Pick<PlanRow, "yearlyMultiplier">, s: BillingSettings) {
  return row.yearlyMultiplier ?? s.yearlyMultiplier;
}

/** Monthly and yearly prices of a plan, in cents (null for trial plans). */
export function planPrices(row: PlanRow, s: BillingSettings) {
  if (row.kind !== "paid" || row.priceMonthlyCents === null) return null;
  return {
    monthlyCents: row.priceMonthlyCents,
    yearlyCents: yearlyCents(row.priceMonthlyCents, effectiveMultiplier(row, s)),
  };
}

export function limitsOf(row: Pick<PlanRow, "limits">): PlanLimits {
  const parsed = planLimitsSchema.safeParse(row.limits ?? {});
  return parsed.success ? parsed.data : planLimitsSchema.parse({});
}

/* Admin: settings -------------------------------------------------------- */

export async function updateBillingSettings(
  admin: AdminContext,
  input: z.input<typeof billingSettingsSchema>,
): Promise<{ resynced: number }> {
  const v = billingSettingsSchema.parse(input);
  const before = await getBillingSettings(admin.db);
  await admin.db
    .insert(platformSetting)
    .values({ key: "billing", value: v, updatedBy: admin.adminUserId })
    .onConflictDoUpdate({
      target: platformSetting.key,
      set: { value: v, updatedBy: admin.adminUserId, updatedAt: new Date() },
    });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "settings.update",
    targetType: "billing",
    metadata: { from: before, to: v },
  });
  // Plans on the default multiplier get new yearly prices.
  let resynced = 0;
  if (before.yearlyMultiplier !== v.yearlyMultiplier && isStripeConfigured()) {
    const affected = await admin.db
      .select()
      .from(plan)
      .where(and(eq(plan.kind, "paid"), ne(plan.status, "archived")));
    for (const row of affected.filter((p) => p.yearlyMultiplier === null && p.stripeProductId)) {
      await syncPlanToStripe(admin, row.id);
      resynced++;
    }
  }
  return { resynced };
}

/* Admin: plans ------------------------------------------------------------ */

export async function listPlans(db: Database): Promise<PlanRow[]> {
  return db.select().from(plan).orderBy(asc(plan.sortOrder), asc(plan.createdAt));
}

export async function getPlan(db: Database, planId: string): Promise<PlanRow> {
  const [row] = await db.select().from(plan).where(eq(plan.id, planId));
  if (!row) throw new ServiceError("invalid_input", "This plan does not exist.");
  return row;
}

function toColumns(v: z.output<typeof planInputSchema>) {
  return {
    slug: v.slug,
    kind: v.kind,
    name: v.name,
    description: v.description,
    priceMonthlyCents:
      v.kind === "paid" && v.priceMonthly !== null ? toCents(v.priceMonthly) : null,
    yearlyMultiplier: v.kind === "paid" ? v.yearlyMultiplier : null,
    limits: v.limits,
    features: v.features,
    highlighted: v.highlighted,
    badge: v.badge || null,
    ctaLabel: v.ctaLabel || null,
    sortOrder: v.sortOrder,
    status: v.status,
    trialDays: v.trialDays,
    trialRequiresCard: v.kind === "paid" ? v.trialRequiresCard : false,
  };
}

async function assertSlugFree(db: Database, slug: string, exceptId?: string) {
  const rows = await db.select({ id: plan.id }).from(plan).where(eq(plan.slug, slug));
  if (rows.some((r) => r.id !== exceptId)) {
    throw new ServiceError("invalid_input", `Another plan already uses the id "${slug}".`);
  }
}

function assertCanPublish(v: z.output<typeof planInputSchema>) {
  if (v.status === "published" && v.kind === "paid" && !isStripeConfigured()) {
    throw new ServiceError(
      "precondition_failed",
      "Set STRIPE_SECRET_KEY before publishing a paid plan: it could not be bought.",
    );
  }
}

export async function createPlan(admin: AdminContext, input: PlanInput): Promise<PlanRow> {
  const v = planInputSchema.parse(input);
  assertCanPublish(v);
  await assertSlugFree(admin.db, v.slug);
  const [row] = await admin.db.insert(plan).values(toColumns(v)).returning();
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "plan.create",
    targetType: "plan",
    targetId: row!.id,
    metadata: { slug: v.slug, kind: v.kind, priceMonthly: v.priceMonthly, status: v.status },
  });
  if (row!.kind === "paid" && isStripeConfigured()) return syncPlanToStripe(admin, row!.id);
  return row!;
}

export async function updatePlan(
  admin: AdminContext,
  planId: string,
  input: PlanInput,
): Promise<PlanRow> {
  const v = planInputSchema.parse(input);
  const current = await getPlan(admin.db, planId);
  if (current.kind !== v.kind) {
    throw new ServiceError("invalid_input", "A plan cannot change between paid and free trial.");
  }
  assertCanPublish(v);
  await assertSlugFree(admin.db, v.slug, planId);
  const [row] = await admin.db
    .update(plan)
    .set(toColumns(v))
    .where(eq(plan.id, planId))
    .returning();
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "plan.update",
    targetType: "plan",
    targetId: planId,
    metadata: {
      slug: v.slug,
      priceFrom: current.priceMonthlyCents,
      priceTo: row!.priceMonthlyCents,
      statusFrom: current.status,
      statusTo: v.status,
    },
  });
  if (row!.kind === "paid" && isStripeConfigured()) return syncPlanToStripe(admin, planId);
  return row!;
}

/** Deletes a plan nobody ever subscribed to; otherwise archive it. */
export async function deletePlan(admin: AdminContext, planId: string): Promise<void> {
  const current = await getPlan(admin.db, planId);
  const used = await admin.db
    .select({ id: workspaceSubscription.id })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.planId, planId))
    .limit(1);
  if (used.length) {
    throw new ServiceError(
      "invalid_state",
      "Workspaces are or were subscribed to this plan. Archive it instead: it disappears from the landing page and subscribers keep it.",
    );
  }
  if (current.stripeProductId && isStripeConfigured()) {
    const stripe = getStripe();
    for (const id of [current.stripeMonthlyPriceId, current.stripeYearlyPriceId]) {
      if (id) await stripe.prices.update(id, { active: false });
    }
    await stripe.products.update(current.stripeProductId, { active: false });
  }
  await admin.db.delete(plan).where(eq(plan.id, planId));
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "plan.delete",
    targetType: "plan",
    targetId: planId,
    metadata: { slug: current.slug },
  });
}

/**
 * Mirrors a paid plan in Stripe: the Product (name, description, active), and
 * new monthly / yearly Prices when the amounts changed (old ones archived).
 */
export async function syncPlanToStripe(admin: AdminContext, planId: string): Promise<PlanRow> {
  const row = await getPlan(admin.db, planId);
  if (row.kind !== "paid") return row;
  const stripe = getStripe();
  const settings = await getBillingSettings(admin.db);
  const prices = planPrices(row, settings)!;
  const active = row.status !== "archived";

  let productId = row.stripeProductId;
  if (!productId) {
    const product = await stripe.products.create({
      name: `Trendcart ${row.name}`,
      ...(row.description ? { description: row.description } : {}),
      active,
      metadata: { trendcart_plan_id: row.id, trendcart_plan_slug: row.slug },
    });
    productId = product.id;
  } else {
    await stripe.products.update(productId, {
      name: `Trendcart ${row.name}`,
      ...(row.description ? { description: row.description } : {}),
      active,
    });
  }

  const patch: Partial<PlanRow> = { stripeProductId: productId };
  for (const interval of ["month", "year"] as const) {
    const amount = interval === "month" ? prices.monthlyCents : prices.yearlyCents;
    const currentId = interval === "month" ? row.stripeMonthlyPriceId : row.stripeYearlyPriceId;
    const currentAmount = interval === "month" ? row.stripeMonthlyCents : row.stripeYearlyCents;
    if (currentId && currentAmount === amount) {
      if (!active) await stripe.prices.update(currentId, { active: false });
      continue;
    }
    if (!active) continue;
    const price = await stripe.prices.create({
      product: productId,
      currency: CURRENCY,
      unit_amount: amount,
      recurring: { interval },
      lookup_key: `trendcart_${row.slug}_${interval}ly`,
      transfer_lookup_key: true,
      metadata: { trendcart_plan_id: row.id },
    });
    // Old subscribers keep the archived price; only new checkouts use the new one.
    if (currentId) await stripe.prices.update(currentId, { active: false });
    if (interval === "month") {
      patch.stripeMonthlyPriceId = price.id;
      patch.stripeMonthlyCents = amount;
    } else {
      patch.stripeYearlyPriceId = price.id;
      patch.stripeYearlyCents = amount;
    }
  }
  const [updated] = await admin.db.update(plan).set(patch).where(eq(plan.id, planId)).returning();
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "plan.stripe_sync",
    targetType: "plan",
    targetId: planId,
    metadata: {
      productId,
      monthlyPriceId: updated!.stripeMonthlyPriceId,
      yearlyPriceId: updated!.stripeYearlyPriceId,
      monthlyCents: updated!.stripeMonthlyCents,
      yearlyCents: updated!.stripeYearlyCents,
    },
  });
  return updated!;
}

/* Public: published plans (landing page, billing page) ------------------- */

export type PublicPlan = {
  id: string;
  slug: string;
  kind: "paid" | "trial";
  name: string;
  description: string;
  /** USD. */
  priceMonthly: number | null;
  priceYearly: number | null;
  limits: PlanLimits;
  features: string[];
  highlighted: boolean;
  badge: string | null;
  ctaLabel: string | null;
  trialDays: number;
  trialRequiresCard: boolean;
};

export async function listPublishedPlans(db: Database): Promise<PublicPlan[]> {
  const [rows, settings] = await Promise.all([
    db
      .select()
      .from(plan)
      .where(eq(plan.status, "published"))
      .orderBy(asc(plan.sortOrder), asc(plan.createdAt)),
    getBillingSettings(db),
  ]);
  return rows.map((row) => {
    const prices = planPrices(row, settings);
    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      name: row.name,
      description: row.description,
      priceMonthly: prices ? prices.monthlyCents / 100 : null,
      priceYearly: prices ? prices.yearlyCents / 100 : null,
      limits: limitsOf(row),
      features: row.features ?? [],
      highlighted: row.highlighted,
      badge: row.badge,
      ctaLabel: row.ctaLabel,
      trialDays: row.trialDays,
      trialRequiresCard: row.trialRequiresCard,
    };
  });
}

/** Whether billing applies: at least one published plan exists. */
export async function billingActive(db: Database): Promise<boolean> {
  const rows = await db
    .select({ id: plan.id })
    .from(plan)
    .where(eq(plan.status, "published"))
    .limit(1);
  return rows.length > 0;
}

/** Plans by id (archived ones included), for subscriptions. */
export async function plansById(db: Database, ids: string[]): Promise<Map<string, PlanRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(plan).where(inArray(plan.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
