import "server-only";

import Stripe from "stripe";

/*
 * Stripe client (stripe-node 23.2.0, pinned API version 2026-11-18.endive).
 * Built lazily so builds and tests never need the key. Hosted Checkout and
 * the hosted customer portal only: card data never reaches Trendcart.
 */

let client: Stripe | null = null;

export function isStripeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.STRIPE_SECRET_KEY?.trim();
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set: payments are not configured.");
  }
  client ??= new Stripe(key, { appInfo: { name: "Trendcart" } });
  return client;
}

/** Test hook. */
export function setStripeForTests(stripe: Stripe | null): void {
  client = stripe;
}

export function stripeMode(env: NodeJS.ProcessEnv = process.env): "test" | "live" | "off" {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return "off";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";
}
