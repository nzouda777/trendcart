import "server-only";

import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { hasAccess } from "@/lib/domain/billing";
import {
  auditLog,
  brand,
  campaign,
  invitation,
  member,
  organization,
  product,
  shopifyConnection,
  shopifyProduct,
  tiktokAdConnection,
  tiktokPost,
  tiktokProfileConnection,
  usageMonthly,
  user,
  workspaceSettings,
  workspaceSubscription,
} from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { writePlatformAudit } from "./audit";
import type { AdminContext } from "./guard";
import { getPlan } from "./plans";
import { getStripe, isStripeConfigured } from "./stripe";

/*
 * Workspaces seen by platform admins: list, detail, and actions (suspend,
 * AI budget, grant a plan, extend or end a trial, cancel the Stripe
 * subscription, delete). Every action is written to platform_audit_log and,
 * when it changes the workspace, to its own audit log too.
 */

const DAY = 86_400_000;

export type AdminWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  owner: { name: string; email: string } | null;
  members: number;
  products: number;
  planId: string | null;
  subscriptionStatus: string | null;
  subscriptionSource: string | null;
  access: boolean;
  suspended: boolean;
  aiCostMonthUsd: number;
};

export async function listWorkspaces(
  db: AdminContext["db"],
  input: { q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminWorkspaceRow[]; total: number }> {
  const q = input.q?.trim();
  const where = q
    ? or(ilike(organization.name, `%${q}%`), ilike(organization.slug, `%${q}%`))
    : undefined;
  const [orgs, [total]] = await Promise.all([
    db
      .select()
      .from(organization)
      .where(where)
      .orderBy(desc(organization.createdAt))
      .limit(input.limit ?? 50)
      .offset(input.offset ?? 0),
    db.select({ c: count() }).from(organization).where(where),
  ]);
  const ids = orgs.map((o) => o.id);
  if (ids.length === 0) return { rows: [], total: Number(total?.c ?? 0) };
  const month = new Date().toISOString().slice(0, 7);
  const [members, owners, products, subs, settings, usage] = await Promise.all([
    db
      .select({ ws: member.organizationId, c: count() })
      .from(member)
      .where(inArray(member.organizationId, ids))
      .groupBy(member.organizationId),
    db
      .select({ ws: member.organizationId, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(inArray(member.organizationId, ids), eq(member.role, "owner"))),
    db
      .select({ ws: product.workspaceId, c: count() })
      .from(product)
      .where(inArray(product.workspaceId, ids))
      .groupBy(product.workspaceId),
    db.select().from(workspaceSubscription).where(inArray(workspaceSubscription.workspaceId, ids)),
    db.select().from(workspaceSettings).where(inArray(workspaceSettings.workspaceId, ids)),
    db
      .select()
      .from(usageMonthly)
      .where(and(inArray(usageMonthly.workspaceId, ids), eq(usageMonthly.month, month))),
  ]);
  const now = new Date();
  const rows = orgs.map((o): AdminWorkspaceRow => {
    const sub = subs.find((s) => s.workspaceId === o.id) ?? null;
    const set = settings.find((s) => s.workspaceId === o.id);
    const owner = owners.find((x) => x.ws === o.id);
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      createdAt: o.createdAt.toISOString(),
      owner: owner ? { name: owner.name, email: owner.email } : null,
      members: Number(members.find((m) => m.ws === o.id)?.c ?? 0),
      products: Number(products.find((p) => p.ws === o.id)?.c ?? 0),
      planId: sub?.planId ?? null,
      subscriptionStatus: sub?.status ?? null,
      subscriptionSource: sub?.source ?? null,
      access: hasAccess(sub, now),
      suspended: !!set?.suspendedAt,
      aiCostMonthUsd: Number(usage.find((u) => u.workspaceId === o.id)?.aiCostUsd ?? 0),
    };
  });
  return { rows, total: Number(total?.c ?? 0) };
}

export async function getWorkspaceDetail(db: AdminContext["db"], workspaceId: string) {
  const [org] = await db.select().from(organization).where(eq(organization.id, workspaceId));
  if (!org) throw new ServiceError("invalid_input", "This workspace does not exist.");
  const c = (rows: { c: number }[]) => Number(rows[0]?.c ?? 0);
  const [
    members,
    invitations,
    brands,
    stores,
    adAccounts,
    profiles,
    products,
    campaigns,
    sub,
    settings,
    usage,
    audit,
  ] = await Promise.all([
    db
      .select({
        id: member.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
        banned: user.banned,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, workspaceId)),
    db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, workspaceId), eq(invitation.status, "pending"))),
    db.select({ c: count() }).from(brand).where(eq(brand.workspaceId, workspaceId)),
    db
      .select({ shop: shopifyConnection.shopDomain, status: shopifyConnection.status })
      .from(shopifyConnection)
      .where(eq(shopifyConnection.workspaceId, workspaceId)),
    db
      .select({ name: tiktokAdConnection.name, status: tiktokAdConnection.status })
      .from(tiktokAdConnection)
      .where(eq(tiktokAdConnection.workspaceId, workspaceId)),
    db
      .select({ name: tiktokProfileConnection.displayName, status: tiktokProfileConnection.status })
      .from(tiktokProfileConnection)
      .where(eq(tiktokProfileConnection.workspaceId, workspaceId)),
    db.select({ c: count() }).from(product).where(eq(product.workspaceId, workspaceId)),
    db
      .select({ status: campaign.status, c: count() })
      .from(campaign)
      .where(eq(campaign.workspaceId, workspaceId))
      .groupBy(campaign.status),
    db
      .select()
      .from(workspaceSubscription)
      .where(eq(workspaceSubscription.workspaceId, workspaceId)),
    db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)),
    db
      .select()
      .from(usageMonthly)
      .where(eq(usageMonthly.workspaceId, workspaceId))
      .orderBy(desc(usageMonthly.month))
      .limit(6),
    db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId))
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
  ]);
  return {
    org,
    members,
    invitations,
    brands: c(brands),
    stores,
    adAccounts,
    profiles,
    products: c(products),
    campaigns,
    subscription: sub[0] ?? null,
    settings: settings[0] ?? null,
    usage,
    audit,
  };
}

/* Actions -------------------------------------------------------------------- */

function noImpersonation(admin: AdminContext) {
  if (admin.impersonating) {
    throw new ServiceError("invalid_state", "Stop impersonating before using admin actions.");
  }
}

async function ensureWorkspace(admin: AdminContext, workspaceId: string) {
  const [org] = await admin.db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, workspaceId));
  if (!org) throw new ServiceError("invalid_input", "This workspace does not exist.");
  return org;
}

async function upsertSettings(
  admin: AdminContext,
  workspaceId: string,
  patch: Partial<typeof workspaceSettings.$inferInsert>,
) {
  const scoped = createScopedDb(admin.db, workspaceId);
  const current = await scoped.findFirst(workspaceSettings);
  if (current) {
    await scoped.update(workspaceSettings, { ...patch, updatedBy: admin.adminUserId }, undefined);
  } else {
    await scoped.insert(workspaceSettings, { ...patch, updatedBy: admin.adminUserId });
  }
}

const reasonSchema = z.string().trim().max(300).optional();

export async function suspendWorkspace(
  admin: AdminContext,
  workspaceId: string,
  reason?: string,
): Promise<void> {
  noImpersonation(admin);
  await ensureWorkspace(admin, workspaceId);
  const r = reasonSchema.parse(reason) || null;
  await upsertSettings(admin, workspaceId, { suspendedAt: new Date(), suspendedReason: r });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.suspend",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { reason: r },
  });
}

export async function unsuspendWorkspace(admin: AdminContext, workspaceId: string): Promise<void> {
  noImpersonation(admin);
  await ensureWorkspace(admin, workspaceId);
  await upsertSettings(admin, workspaceId, { suspendedAt: null, suspendedReason: null });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.unsuspend",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
  });
}

/** Null = back to the plan / default AI budget. */
export async function setWorkspaceAiCap(
  admin: AdminContext,
  workspaceId: string,
  capUsd: number | null,
): Promise<void> {
  noImpersonation(admin);
  const v = z.number().min(0).max(100_000).nullable().parse(capUsd);
  await ensureWorkspace(admin, workspaceId);
  await upsertSettings(admin, workspaceId, { adminAiMonthlyCapUsd: v });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.ai_cap",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { capUsd: v },
  });
}

const grantSchema = z.object({
  planId: z.string().min(1),
  /** Days of access; null = until an admin ends it. */
  days: z.number().int().min(1).max(3650).nullable(),
  note: z.string().trim().max(300).optional(),
});

/** Gives a workspace a plan without payment (partner, support, test). */
export async function grantPlan(
  admin: AdminContext,
  workspaceId: string,
  input: z.input<typeof grantSchema>,
): Promise<void> {
  noImpersonation(admin);
  const v = grantSchema.parse(input);
  await ensureWorkspace(admin, workspaceId);
  const planRow = await getPlan(admin.db, v.planId);
  const scoped = createScopedDb(admin.db, workspaceId);
  const current = await scoped.findFirst(workspaceSubscription);
  if (current?.source === "stripe" && hasAccess(current, new Date())) {
    throw new ServiceError(
      "invalid_state",
      "This workspace pays with Stripe. Cancel its Stripe subscription first.",
    );
  }
  const now = new Date();
  const values = {
    planId: planRow.id,
    source: "admin" as const,
    status: "active" as const,
    interval: null,
    unitAmountCents: 0,
    endsAt: v.days ? new Date(now.getTime() + v.days * DAY) : null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    adminNote: v.note || null,
    subscribedBy: admin.adminUserId,
  };
  if (current) await scoped.update(workspaceSubscription, values, undefined);
  else await scoped.insert(workspaceSubscription, values);
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.grant_plan",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { planId: planRow.id, plan: planRow.name, days: v.days, note: v.note ?? null },
  });
}

/** Adds days to a free trial or an admin grant, or moves a Stripe trial's end. */
export async function extendTrial(
  admin: AdminContext,
  workspaceId: string,
  days: number,
): Promise<void> {
  noImpersonation(admin);
  const d = z.number().int().min(1).max(365).parse(days);
  await ensureWorkspace(admin, workspaceId);
  const scoped = createScopedDb(admin.db, workspaceId);
  const sub = await scoped.findFirst(workspaceSubscription);
  if (!sub) throw new ServiceError("invalid_state", "This workspace has no subscription.");
  const now = new Date();
  if (sub.source === "stripe") {
    if (sub.status !== "trialing" || !sub.stripeSubscriptionId || !isStripeConfigured()) {
      throw new ServiceError(
        "invalid_state",
        "Only a Stripe subscription in trial can be extended.",
      );
    }
    const base = Math.max(sub.trialEndsAt?.getTime() ?? now.getTime(), now.getTime());
    const trialEnd = Math.floor((base + d * DAY) / 1000);
    await getStripe().subscriptions.update(sub.stripeSubscriptionId, {
      trial_end: trialEnd,
      proration_behavior: "none",
    });
    await scoped.update(
      workspaceSubscription,
      { trialEndsAt: new Date(trialEnd * 1000) },
      undefined,
    );
  } else {
    const base = Math.max(sub.endsAt?.getTime() ?? now.getTime(), now.getTime());
    const endsAt = new Date(base + d * DAY);
    await scoped.update(
      workspaceSubscription,
      {
        endsAt,
        ...(sub.source === "trial" ? { trialEndsAt: endsAt, status: "trialing" as const } : {}),
        ...(sub.source === "admin" ? { status: "active" as const } : {}),
      },
      undefined,
    );
  }
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.extend_trial",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { days: d, source: sub.source },
  });
}

/** Ends a free trial or an admin grant now. */
export async function endAccess(admin: AdminContext, workspaceId: string): Promise<void> {
  noImpersonation(admin);
  await ensureWorkspace(admin, workspaceId);
  const scoped = createScopedDb(admin.db, workspaceId);
  const sub = await scoped.findFirst(workspaceSubscription);
  if (!sub || sub.source === "stripe") {
    throw new ServiceError(
      "invalid_state",
      "Only a free trial or an admin grant can be ended here. Cancel Stripe subscriptions instead.",
    );
  }
  await scoped.update(
    workspaceSubscription,
    { status: "expired", endsAt: new Date(), canceledAt: new Date() },
    undefined,
  );
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.end_access",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { source: sub.source },
  });
}

/** Cancels the workspace's Stripe subscription, now or at the end of the period. */
export async function cancelStripeSubscription(
  admin: AdminContext,
  workspaceId: string,
  when: "now" | "period_end",
): Promise<void> {
  noImpersonation(admin);
  await ensureWorkspace(admin, workspaceId);
  const scoped = createScopedDb(admin.db, workspaceId);
  const sub = await scoped.findFirst(workspaceSubscription);
  if (sub?.source !== "stripe" || !sub.stripeSubscriptionId || !isStripeConfigured()) {
    throw new ServiceError("invalid_state", "This workspace has no Stripe subscription.");
  }
  const stripe = getStripe();
  if (when === "now") {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    await scoped.update(
      workspaceSubscription,
      { status: "canceled", canceledAt: new Date() },
      undefined,
    );
  } else {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    await scoped.update(workspaceSubscription, { cancelAtPeriodEnd: true }, undefined);
  }
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.cancel_subscription",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { when, stripeSubscriptionId: sub.stripeSubscriptionId },
  });
}

/**
 * Deletes a workspace and all its Trendcart data (brands, products,
 * campaigns, connections). Nothing is removed from Shopify or TikTok.
 * Refused while it pays with Stripe.
 */
export async function deleteWorkspace(
  admin: AdminContext,
  workspaceId: string,
  confirmName: string,
): Promise<void> {
  noImpersonation(admin);
  const org = await ensureWorkspace(admin, workspaceId);
  if (confirmName.trim() !== org.name) {
    throw new ServiceError("invalid_input", "Type the workspace name exactly to delete it.");
  }
  const [sub] = await admin.db
    .select()
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, workspaceId));
  if (sub?.source === "stripe" && hasAccess(sub, new Date())) {
    throw new ServiceError("invalid_state", "Cancel its Stripe subscription first.");
  }
  await admin.db.transaction(async (tx) => {
    // Rows behind RESTRICT foreign keys first (posts → profiles, campaigns →
    // ad accounts, Shopify pages → stores), then the workspace cascades the rest.
    await tx.delete(tiktokPost).where(eq(tiktokPost.workspaceId, workspaceId));
    await tx.delete(campaign).where(eq(campaign.workspaceId, workspaceId));
    await tx.delete(shopifyProduct).where(eq(shopifyProduct.workspaceId, workspaceId));
    await tx.delete(organization).where(eq(organization.id, workspaceId));
  });
  await writePlatformAudit(admin.db, {
    adminUserId: admin.adminUserId,
    action: "workspace.delete",
    targetType: "workspace",
    targetId: workspaceId,
    metadata: { name: org.name },
  });
}
