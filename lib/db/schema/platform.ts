/**
 * Platform tables: managed by Trendcart platform admins (/admin), not by a
 * workspace. They have no workspace_id and are only read or written through
 * lib/platform (after requirePlatformAdmin), the Stripe webhook, and the
 * public pricing loader (published plans only).
 *
 * The per-workspace subscription lives in business.ts (`workspaceSubscription`,
 * workspace-scoped) so the app reads it through the scoped data layer.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PlanLimits } from "../../domain/billing";

import { user } from "./auth";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A subscription plan shown on the landing page and sold with Stripe Checkout. */
export const plan = pgTable(
  "plan",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Stable public id, e.g. "growth". */
    slug: text("slug").notNull(),
    /** paid: sold with Stripe (optional Stripe trial). trial: free, time-limited, no Stripe. */
    kind: text("kind").$type<"paid" | "trial">().notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** USD cents per month (paid plans). */
    priceMonthlyCents: integer("price_monthly_cents"),
    /** Yearly price = monthly x this. Null: the platform default (platform_setting billing). */
    yearlyMultiplier: numeric("yearly_multiplier", { precision: 6, scale: 2, mode: "number" }),
    limits: jsonb("limits").$type<PlanLimits>().notNull(),
    /** Bullet list shown on the landing page. */
    features: jsonb("features").$type<string[]>().notNull(),
    highlighted: boolean("highlighted").notNull().default(false),
    badge: text("badge"),
    ctaLabel: text("cta_label"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** draft: hidden; published: on the landing page and buyable; archived: hidden, kept for existing subscribers. */
    status: text("status").$type<"draft" | "published" | "archived">().notNull().default("draft"),
    /** paid: Stripe trial days (0 = none). trial: length of the free trial. */
    trialDays: integer("trial_days").notNull().default(0),
    /** paid plans with a Stripe trial: collect a card at checkout. */
    trialRequiresCard: boolean("trial_requires_card").notNull().default(true),
    stripeProductId: text("stripe_product_id"),
    stripeMonthlyPriceId: text("stripe_monthly_price_id"),
    stripeYearlyPriceId: text("stripe_yearly_price_id"),
    /** Amounts (cents) the current Stripe prices were created with: a change creates new prices. */
    stripeMonthlyCents: integer("stripe_monthly_cents"),
    stripeYearlyCents: integer("stripe_yearly_cents"),
    createdAt: tz("created_at").defaultNow().notNull(),
    updatedAt: tz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("plan_slug_uidx").on(t.slug),
    check("plan_kind_check", sql`${t.kind} in ('paid', 'trial')`),
    check("plan_status_check", sql`${t.status} in ('draft', 'published', 'archived')`),
  ],
);

/** Platform-wide settings, one JSON value per key (e.g. "billing"). */
export const platformSetting = pgTable("platform_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: tz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/** Stripe webhook events already handled (Stripe can deliver twice). */
export const stripeEvent = pgTable(
  "stripe_event",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    receivedAt: tz("received_at").defaultNow().notNull(),
    processedAt: tz("processed_at"),
    error: text("error"),
  },
  (t) => [index("stripe_event_received_idx").on(t.receivedAt)],
);

/** Every platform admin action (plans, workspaces, users, settings). */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    adminUserId: text("admin_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    workspaceId: text("workspace_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: tz("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("platform_audit_created_idx").on(t.createdAt),
    index("platform_audit_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * A Shopify store that installed the public app from Shopify (App Store or
 * install link) and finished OAuth before any Trendcart workspace claimed it.
 * Shopify requires OAuth right after install, before any app UI (App Store
 * requirement 2.3.2), so the token is parked here, encrypted, until a signed-in
 * user picks the workspace and brand (lib/integrations/shopify/app-store-install).
 * No workspace_id: it belongs to no tenant yet. Read and written only by that
 * module and the Shopify webhooks; rows expire after a day.
 */
export const shopifyPendingInstall = pgTable(
  "shopify_pending_install",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    shopDomain: text("shop_domain").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: tz("token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    /** sha256 of the claim secret held in the installing browser's cookie. */
    claimHash: text("claim_hash").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shopify_pending_install_shop_uidx").on(t.shopDomain),
    index("shopify_pending_install_expires_idx").on(t.expiresAt),
  ],
);

export const platformTables = {
  plan,
  platformSetting,
  stripeEvent,
  platformAuditLog,
  shopifyPendingInstall,
};
