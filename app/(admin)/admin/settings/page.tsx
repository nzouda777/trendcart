import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";
import type { Metadata } from "next";

import { ActionButton } from "@/components/admin/action-button";
import { AdminTitle, Card, Pill } from "@/components/admin/ui";
import { siteConfig } from "@/config/site";
import { requireAdminPage } from "@/lib/platform/guard";
import { getBillingSettings } from "@/lib/platform/plans";
import { stripeMode } from "@/lib/platform/stripe";
import { HANDLED_EVENTS } from "@/lib/platform/stripe-webhook";

import { updateMultiplierAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  const Icon = ok ? CheckCircle2Icon : CircleAlertIcon;
  return (
    <li className="flex items-start gap-2.5">
      <Icon
        aria-hidden="true"
        className={ok ? "mt-0.5 size-4 text-brand-text" : "mt-0.5 size-4 text-warning"}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </li>
  );
}

export default async function AdminSettingsPage() {
  const admin = await requireAdminPage();
  const settings = await getBillingSettings(admin.db);
  const mode = stripeMode();
  const webhookUrl = `${siteConfig.canonicalUrl}/api/stripe/webhook`;

  return (
    <div className="grid max-w-3xl gap-5">
      <AdminTitle
        title="Settings"
        description="Platform-wide billing settings and payment setup."
      />

      <Card
        title="Yearly price"
        description="Yearly price = monthly price × this number, for every plan that does not set its own. Changing it creates new yearly Stripe prices for those plans; current yearly subscribers keep their price."
        actions={
          <ActionButton
            label="Change"
            title="Change the yearly multiplier"
            description="Applies to new subscribers of every plan using the default."
            input={{
              label: "Yearly = monthly ×",
              type: "number",
              required: true,
              placeholder: String(settings.yearlyMultiplier),
            }}
            onConfirm={updateMultiplierAction}
          />
        }
      >
        <p className="text-3xl font-semibold tabular-nums">× {settings.yearlyMultiplier}</p>
      </Card>

      <Card
        title="Stripe"
        description="Payments use Stripe Checkout and the Stripe customer portal (hosted by Stripe): card details never reach Trendcart."
        actions={
          <Pill tone={mode === "live" ? "good" : mode === "test" ? "warning" : "danger"}>
            {mode === "off" ? "Not configured" : `${mode} mode`}
          </Pill>
        }
      >
        <ul className="grid gap-3 text-sm">
          <Check
            ok={mode !== "off"}
            label="STRIPE_SECRET_KEY"
            hint="Secret key (sk_live_… in production, sk_test_… to test), in the Vercel environment variables."
          />
          <Check
            ok={!!process.env.STRIPE_WEBHOOK_SECRET?.trim()}
            label="STRIPE_WEBHOOK_SECRET"
            hint="Signing secret of the webhook endpoint below (whsec_…)."
          />
          <li className="rounded-lg bg-surface-2 p-3 text-xs">
            <p className="font-medium">Webhook endpoint to add in Stripe (Developers › Webhooks)</p>
            <code className="mt-1 block break-all">{webhookUrl}</code>
            <p className="mt-2 font-medium">Events</p>
            <code className="mt-1 block leading-relaxed break-words">
              {[...HANDLED_EVENTS].join(", ")}
            </code>
          </li>
          <li className="text-xs text-muted-foreground">
            Customer portal: enable it once in Stripe (Settings › Billing › Customer portal) so
            owners can change card, plan and billing period, or cancel.
          </li>
        </ul>
      </Card>
    </div>
  );
}
