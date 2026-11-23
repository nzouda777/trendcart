"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/components/app/action-result";
import { siteConfig } from "@/config/site";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { openBillingPortal, startCheckout, startFreeTrial } from "@/lib/services/billing";

import { runAction } from "../_lib/action";

const OWNER_ONLY = "Only the workspace owner can manage billing.";
const billingUrl = (query = "") => `${siteConfig.url}${AUTH_PATHS.billing}${query}`;

function explain<T>(result: ActionResult<T>): ActionResult<T> {
  return !result.ok && result.code === "forbidden" ? { ...result, error: OWNER_ONLY } : result;
}

/** Redirects to Stripe Checkout (hosted). */
export async function checkoutAction(input: {
  planId: string;
  interval: "month" | "year";
}): Promise<ActionResult> {
  const result = explain(
    await runAction((ctx) =>
      startCheckout(ctx, input, {
        successUrl: billingUrl("?checkout=success"),
        cancelUrl: billingUrl("?checkout=cancel"),
      }),
    ),
  );
  if (!result.ok) return result;
  redirect(result.data.url);
}

/** Redirects to the Stripe customer portal (hosted). */
export async function portalAction(): Promise<ActionResult> {
  const result = explain(await runAction((ctx) => openBillingPortal(ctx, billingUrl())));
  if (!result.ok) return result;
  redirect(result.data.url);
}

export async function startTrialAction(planId: string): Promise<ActionResult> {
  const result = explain(
    await runAction(async (ctx) => {
      await startFreeTrial(ctx, { planId });
      return undefined;
    }),
  );
  if (result.ok) refresh();
  return result;
}
