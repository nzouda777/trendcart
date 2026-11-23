import { z } from "zod";

/*
 * Plans, subscriptions and entitlements (pure, no I/O).
 *
 * - Plans are defined by platform admins (/admin/plans), in USD. Yearly
 *   price = monthly x multiplier (platform default 10, overridable per plan).
 * - A workspace has at most one subscription row: from Stripe Checkout
 *   (source "stripe"), from a free trial plan (source "trial", no Stripe), or
 *   granted by an admin (source "admin").
 * - Billing applies only once at least one plan is published: before that the
 *   app stays open (nothing to buy yet) with no plan limits.
 */

export const CURRENCY = "usd";
export const DEFAULT_YEARLY_MULTIPLIER = 10;

/** Null = unlimited. */
export const planLimitsSchema = z.object({
  brands: z.number().int().min(0).max(10_000).nullable().default(null),
  stores: z.number().int().min(0).max(10_000).nullable().default(null),
  seats: z.number().int().min(1).max(10_000).nullable().default(null),
  productsPerMonth: z.number().int().min(0).max(1_000_000).nullable().default(null),
  /** Monthly AI + paid API budget for the workspace (USD). */
  aiMonthlyCapUsd: z.number().min(0).max(100_000).nullable().default(null),
});
export type PlanLimits = z.output<typeof planLimitsSchema>;

export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  brands: "Brands",
  stores: "Shopify stores",
  seats: "Team seats",
  productsPerMonth: "Products per month",
  aiMonthlyCapUsd: "AI budget per month (USD)",
};

export const planKindSchema = z.enum(["paid", "trial"]);
export const planStatusSchema = z.enum(["draft", "published", "archived"]);

export const planInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Use lowercase letters, digits and dashes."),
    kind: planKindSchema,
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).default(""),
    /** USD per month, e.g. 29 or 29.99 (paid plans). */
    priceMonthly: z.number().positive().max(100_000).nullable().default(null),
    /** Null: the platform default multiplier. */
    yearlyMultiplier: z.number().min(1).max(24).nullable().default(null),
    limits: planLimitsSchema.prefault({}),
    features: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    highlighted: z.boolean().default(false),
    badge: z.string().trim().max(30).nullable().default(null),
    ctaLabel: z.string().trim().max(40).nullable().default(null),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    status: planStatusSchema.default("draft"),
    trialDays: z.number().int().min(0).max(730).default(0),
    trialRequiresCard: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.kind === "paid" && p.priceMonthly === null) {
      ctx.addIssue({ code: "custom", path: ["priceMonthly"], message: "Set the monthly price." });
    }
    if (p.kind === "trial" && p.trialDays < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["trialDays"],
        message: "A free trial needs a length in days.",
      });
    }
  });
export type PlanInput = z.input<typeof planInputSchema>;
export type ParsedPlanInput = z.output<typeof planInputSchema>;

export const toCents = (usd: number) => Math.round(usd * 100);
export const fromCents = (cents: number) => Math.round(cents) / 100;

/** Yearly price in cents for a monthly price and multiplier (rounded to the cent). */
export function yearlyCents(monthlyCents: number, multiplier: number): number {
  return Math.round(monthlyCents * multiplier);
}

/** Stripe subscription statuses, plus our own for trial / admin rows. */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "canceled",
  "paused",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionSource = "stripe" | "trial" | "admin";

/** Statuses that give access to the app (past_due: Stripe is retrying the payment). */
const ACCESS = new Set<SubscriptionStatus>(["trialing", "active", "past_due"]);

export type SubscriptionLike = {
  status: SubscriptionStatus;
  source: SubscriptionSource;
  /** Trial or admin grant end; access stops after it. */
  endsAt: Date | null;
};

export function hasAccess(sub: SubscriptionLike | null | undefined, now: Date): boolean {
  if (!sub || !ACCESS.has(sub.status)) return false;
  if (sub.source !== "stripe" && sub.endsAt && sub.endsAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Payment failed (retrying)",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Expired before payment",
  canceled: "Canceled",
  paused: "Paused",
  expired: "Expired",
};

/** The limit check every service uses: null limit = unlimited. */
export function withinLimit(limit: number | null, used: number, adding = 1): boolean {
  return limit === null || used + adding <= limit;
}
