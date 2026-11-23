import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { ForbiddenError } from "@/lib/auth/errors";
import {
  brand,
  plan,
  platformAuditLog,
  platformSetting,
  stripeEvent,
  workspaceSettings,
  workspaceSubscription,
} from "@/lib/db/schema";
import type { AdminContext } from "@/lib/platform/guard";
import { createPlan, listPublishedPlans, syncPlanToStripe, updatePlan } from "@/lib/platform/plans";
import { setStripeForTests } from "@/lib/platform/stripe";
import { handleStripeEvent, syncStripeSubscription } from "@/lib/platform/stripe-webhook";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { getAiBudget, resolveAiCap } from "@/lib/ai/metering";
import { setWorkspaceAiCap } from "@/lib/platform/workspaces";

import { getBillingOverview, startFreeTrial } from "../billing";
import { createBrand } from "../brands";
import { loadEntitlement } from "../internal/entitlements";
import { getWorkspaceSettings, updateWorkspaceSettings } from "../settings";
import { newBrandInput, setupTestEnv, type TestEnv } from "./helpers";

/*
 * M5: plans, entitlements, free trials, plan limits, Stripe price changes and
 * the webhook sync. Stripe is a fake recording calls (no network).
 */

let env: TestEnv;
let admin: AdminContext;

beforeAll(async () => {
  env = await setupTestEnv();
  admin = {
    adminUserId: env.a.owner.actor.userId,
    name: "Admin",
    email: "admin@test",
    impersonating: false,
    db: env.db,
  };
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  await env.db.delete(workspaceSubscription);
  await env.db.delete(workspaceSettings);
  await env.db.delete(stripeEvent);
  await env.db.delete(platformAuditLog);
  await env.db.delete(platformSetting);
  await env.db.delete(plan);
  await env.db.delete(brand);
  setStripeForTests(fakeStripe() as unknown as Stripe);
});
afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  setStripeForTests(null);
});

type Calls = { prices: Record<string, unknown>[]; archived: string[]; products: number };
let calls: Calls;
function fakeStripe(subscription?: Partial<Stripe.Subscription>) {
  calls = { prices: [], archived: [], products: 0 };
  let seq = 0;
  return {
    products: {
      create: async () => ({ id: `prod_${++calls.products}` }),
      update: async () => ({}),
    },
    prices: {
      create: async (p: Record<string, unknown>) => {
        calls.prices.push(p);
        return { id: `price_${++seq}` };
      },
      update: async (id: string, p: { active?: boolean }) => {
        if (p.active === false) calls.archived.push(id);
        return {};
      },
    },
    subscriptions: { retrieve: async () => subscription },
  };
}

const paidInput = {
  slug: "growth",
  kind: "paid" as const,
  name: "Growth",
  priceMonthly: 79,
  limits: { brands: 2 },
  features: ["Everything"],
  status: "published" as const,
};

const trialInput = {
  slug: "trial",
  kind: "trial" as const,
  name: "Free trial",
  trialDays: 7,
  limits: { brands: 1 },
  status: "published" as const,
};

describe("plans and Stripe prices", () => {
  it("creates monthly and yearly prices (x10 by default) and replaces them on a price change", async () => {
    const created = await createPlan(admin, paidInput);
    expect(created.stripeMonthlyCents).toBe(7900);
    expect(created.stripeYearlyCents).toBe(79000);
    expect(calls.prices.map((p) => (p.recurring as { interval: string }).interval)).toEqual([
      "month",
      "year",
    ]);

    const updated = await updatePlan(admin, created.id, { ...paidInput, priceMonthly: 99 });
    expect(updated.stripeMonthlyCents).toBe(9900);
    expect(updated.stripeMonthlyPriceId).not.toBe(created.stripeMonthlyPriceId);
    // Old prices archived: existing subscribers keep them, new ones pay 99.
    expect(calls.archived).toEqual(
      expect.arrayContaining([created.stripeMonthlyPriceId, created.stripeYearlyPriceId]),
    );

    // Same amount again: no new price.
    const before = calls.prices.length;
    await syncPlanToStripe(admin, created.id);
    expect(calls.prices.length).toBe(before);

    const published = await listPublishedPlans(env.db);
    expect(published[0]).toMatchObject({ priceMonthly: 99, priceYearly: 990, name: "Growth" });
  });

  it("uses the platform yearly multiplier and a plan override", async () => {
    await env.db
      .insert(platformSetting)
      .values({ key: "billing", value: { yearlyMultiplier: 11 } });
    const a = await createPlan(admin, { ...paidInput, slug: "plan-a" });
    const b = await createPlan(admin, { ...paidInput, slug: "plan-b", yearlyMultiplier: 9 });
    expect(a.stripeYearlyCents).toBe(86900);
    expect(b.stripeYearlyCents).toBe(71100);
  });

  it("refuses to publish a paid plan without Stripe", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(createPlan(admin, paidInput)).rejects.toMatchObject({
      code: "precondition_failed",
    });
    const draft = await createPlan(admin, { ...paidInput, status: "draft" });
    expect(draft.stripeProductId).toBeNull();
  });
});

describe("entitlements", () => {
  it("leaves the app open while no plan is published", async () => {
    const e = await loadEntitlement(env.a.owner.db);
    expect(e).toMatchObject({ billingActive: false, access: true });
    await createBrand(env.a.owner, newBrandInput("One"));
    await createBrand(env.a.owner, newBrandInput("Two"));
  });

  it("requires a plan once one is published, then applies its limits", async () => {
    const trial = await createPlan(admin, trialInput);
    await expect(createBrand(env.a.owner, newBrandInput())).rejects.toMatchObject({
      reason: "subscription_required",
    });

    // Only the owner starts the trial.
    await expect(startFreeTrial(env.a.media_buyer, { planId: trial.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await startFreeTrial(env.a.owner, { planId: trial.id });
    const overview = await getBillingOverview(env.a.viewer);
    expect(overview).toMatchObject({ access: true, trialUsed: true });
    expect(overview.subscription).toMatchObject({ source: "trial", status: "trialing" });

    await createBrand(env.a.owner, newBrandInput("First"));
    await expect(createBrand(env.a.owner, newBrandInput("Second"))).rejects.toMatchObject({
      reason: "plan_limit",
    });

    // One trial per workspace.
    await expect(startFreeTrial(env.a.owner, { planId: trial.id })).rejects.toMatchObject({
      code: "invalid_state",
    });

    // After the end date, access stops.
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect((await loadEntitlement(env.a.owner.db, later)).access).toBe(false);
  });

  it("an admin edit to the plan's limits applies at once", async () => {
    const trial = await createPlan(admin, trialInput);
    await startFreeTrial(env.a.owner, { planId: trial.id });
    await createBrand(env.a.owner, newBrandInput("First"));
    await updatePlan(admin, trial.id, { ...trialInput, limits: { brands: 3 } });
    await createBrand(env.a.owner, newBrandInput("Second"));
  });

  it("a suspended workspace has no access", async () => {
    await createScopedDb(env.db, env.wsA).insert(workspaceSettings, { suspendedAt: new Date() });
    await expect(createBrand(env.a.owner, newBrandInput())).rejects.toMatchObject({
      reason: "workspace_suspended",
    });
  });
});

describe("Stripe webhook", () => {
  function subscription(status: Stripe.Subscription.Status, planId: string): Stripe.Subscription {
    return {
      id: "sub_1",
      object: "subscription",
      status,
      customer: "cus_1",
      metadata: { workspaceId: env.wsA, planId },
      cancel_at_period_end: false,
      canceled_at: null,
      trial_end: null,
      items: {
        data: [
          {
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
            price: {
              id: "price_1",
              unit_amount: 7900,
              recurring: { interval: "month" },
              metadata: {},
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  it("stores the subscription and gives access, then removes it on cancel", async () => {
    const paid = await createPlan(admin, paidInput);
    await syncStripeSubscription(env.db, subscription("active", paid.id));
    const [row] = await env.db
      .select()
      .from(workspaceSubscription)
      .where(eq(workspaceSubscription.workspaceId, env.wsA));
    expect(row).toMatchObject({
      source: "stripe",
      status: "active",
      unitAmountCents: 7900,
      interval: "month",
      planId: paid.id,
      stripeCustomerId: "cus_1",
    });
    expect((await loadEntitlement(env.a.owner.db)).access).toBe(true);

    await syncStripeSubscription(env.db, subscription("canceled", paid.id));
    expect((await loadEntitlement(env.a.owner.db)).access).toBe(false);
  });

  it("processes an event once and re-reads the subscription from Stripe", async () => {
    const paid = await createPlan(admin, paidInput);
    const stripe = fakeStripe(subscription("active", paid.id));
    const event = {
      id: "evt_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", object: "subscription" } },
    } as unknown as Stripe.Event;
    expect(await handleStripeEvent(env.db, event, stripe as unknown as Stripe)).toBe("processed");
    expect(await handleStripeEvent(env.db, event, stripe as unknown as Stripe)).toBe("duplicate");
    expect((await loadEntitlement(env.a.owner.db)).access).toBe(true);
    expect((await env.db.select().from(stripeEvent))[0]?.processedAt).toBeTruthy();
  });
});

describe("AI budget capped at the plan", () => {
  it("resolves admin value, then owner value capped at the plan, then plan, then default", () => {
    const base = { adminCap: null, ownerCap: null, planCap: null, defaultCap: 50 };
    expect(resolveAiCap(base)).toBe(50);
    expect(resolveAiCap({ ...base, ownerCap: 80 })).toBe(80);
    expect(resolveAiCap({ ...base, planCap: 20 })).toBe(20);
    expect(resolveAiCap({ ...base, planCap: 20, ownerCap: 80 })).toBe(20);
    expect(resolveAiCap({ ...base, planCap: 20, ownerCap: 5 })).toBe(5);
    expect(resolveAiCap({ ...base, planCap: 20, ownerCap: 5, adminCap: 200 })).toBe(200);
  });

  it("refuses an owner budget above the plan, caps an older one, lets the admin go above", async () => {
    // An owner value saved before the plan existed.
    await updateWorkspaceSettings(env.a.owner, { aiMonthlyCapUsd: 300 });
    const trial = await createPlan(admin, { ...trialInput, limits: { aiMonthlyCapUsd: 25 } });
    await startFreeTrial(env.a.owner, { planId: trial.id });

    expect((await getAiBudget(env.a.owner.db)).capUsd).toBe(25);
    const settings = await getWorkspaceSettings(env.a.viewer);
    expect(settings.aiMonthlyCapUsd.value).toBe(25);
    expect(settings.aiCap).toEqual({ planMax: 25, adminOverride: null });

    await expect(
      updateWorkspaceSettings(env.a.owner, { aiMonthlyCapUsd: 26 }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "plan_limit" });
    await updateWorkspaceSettings(env.a.owner, { aiMonthlyCapUsd: 10 });
    expect((await getAiBudget(env.a.owner.db)).capUsd).toBe(10);

    await setWorkspaceAiCap(admin, env.wsA, 500);
    expect((await getAiBudget(env.a.owner.db)).capUsd).toBe(500);
    await setWorkspaceAiCap(admin, env.wsA, null);
    expect((await getAiBudget(env.a.owner.db)).capUsd).toBe(10);
  });
});
