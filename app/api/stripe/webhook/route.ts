import type { NextRequest } from "next/server";

import { handleStripeWebhookRequest } from "@/lib/platform/stripe-webhook";

/*
 * Stripe webhook. In the Stripe Dashboard (Developers > Webhooks), add the
 * endpoint https://<site>/api/stripe/webhook with the events listed in
 * /admin/settings (HANDLED_EVENTS) and put its signing secret in
 * STRIPE_WEBHOOK_SECRET.
 *
 * The signature is checked on the raw body (request.text()) before anything
 * else. 400: bad signature (Stripe does not retry). 500: handling failed
 * (Stripe retries). 503: Stripe is not configured.
 */
export async function POST(request: NextRequest) {
  const result = await handleStripeWebhookRequest(
    await request.text(),
    request.headers.get("stripe-signature"),
  );
  return new Response(result.body, { status: result.status });
}
