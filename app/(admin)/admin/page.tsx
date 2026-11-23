import {
  AlertTriangleIcon,
  Building2Icon,
  CreditCardIcon,
  PackageIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BarChart } from "@/components/admin/bar-chart";
import { AdminTitle, Card, Pill, StatTile, dateTime, usd } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/platform/guard";
import { loadDashboard } from "@/lib/platform/metrics";
import { listPlans } from "@/lib/platform/plans";
import { stripeMode } from "@/lib/platform/stripe";

export const metadata: Metadata = { title: "Dashboard" };

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
}

export default async function AdminDashboard() {
  const admin = await requireAdminPage();
  const [d, plans] = await Promise.all([loadDashboard(admin.db), listPlans(admin.db)]);
  const planName = (id: string | null) =>
    id ? (plans.find((p) => p.id === id)?.name ?? "Deleted plan") : "No plan";
  const mode = stripeMode();
  const published = plans.filter((p) => p.status === "published").length;

  return (
    <div className="grid gap-6">
      <AdminTitle
        title="Dashboard"
        description="Trendcart at a glance. Every figure comes from Trendcart's own data and the subscriptions Stripe reported."
        actions={
          <>
            <Pill tone={mode === "live" ? "good" : mode === "test" ? "warning" : "danger"}>
              Stripe: {mode === "off" ? "not configured" : `${mode} mode`}
            </Pill>
            <Pill tone={published ? "good" : "warning"}>
              {published
                ? `${published} plan${published === 1 ? "" : "s"} published`
                : "Billing off: no plan published"}
            </Pill>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Monthly recurring revenue"
          value={usd(d.billing.mrrUsd)}
          hint={`${d.billing.payingSubscriptions} paying subscription${d.billing.payingSubscriptions === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Workspaces"
          value={d.totals.workspaces}
          hint={`+${d.last30.workspaces} in 30 days`}
        />
        <StatTile label="Users" value={d.totals.users} hint={`+${d.last30.users} in 30 days`} />
        <StatTile
          label={`AI cost, ${monthLabel(d.ai.month)}`}
          value={usd(d.ai.costUsd)}
          hint={`${d.ai.apiCalls.toLocaleString("en")} paid API calls`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Trials running" value={d.billing.trials} />
        <StatTile label="Admin grants" value={d.billing.adminGrants} />
        <StatTile
          label="Payment failed (retrying)"
          value={d.billing.pastDue}
          tone={d.billing.pastDue ? "warning" : "default"}
        />
        <StatTile label="Canceled in 30 days" value={d.billing.canceledLast30} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New users per day" description="Last 30 days, platform admins excluded.">
          <BarChart
            label="New users per day, last 30 days"
            data={d.signupsByDay.map((x) => ({
              key: x.day,
              label: new Date(x.day).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              }),
              value: x.users,
            }))}
          />
        </Card>
        <Card title="AI cost per month" description="All workspaces, last 6 months (USD).">
          {d.aiByMonth.length ? (
            <BarChart
              label="AI cost per month, last 6 months"
              format={(v) => `$${v}`}
              data={d.aiByMonth.map((m) => ({
                key: m.month,
                label: monthLabel(m.month),
                value: m.costUsd,
              }))}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No AI usage yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Activity" description="Totals since launch.">
          <ul className="grid gap-3 text-sm">
            {[
              { icon: Building2Icon, label: "Workspaces", value: d.totals.workspaces },
              { icon: PackageIcon, label: "Products imported", value: d.totals.products },
              {
                icon: SparklesIcon,
                label: "Campaigns launched",
                value: d.totals.campaignsLaunched,
              },
              {
                icon: CreditCardIcon,
                label: "Campaigns active now",
                value: d.totals.campaignsActive,
              },
              { icon: UsersIcon, label: "Suspended workspaces", value: d.totals.suspended },
            ].map(({ icon: Icon, label, value }) => (
              <li key={label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </span>
                <span className="font-semibold tabular-nums">{value}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Subscriptions by plan" description="Workspaces with access today.">
          {d.billing.byPlan.length ? (
            <ul className="grid gap-2 text-sm">
              {d.billing.byPlan
                .sort((a, b) => b.count - a.count)
                .map((p) => (
                  <li key={p.planId ?? "none"} className="flex justify-between gap-3">
                    <span>{planName(p.planId)}</span>
                    <span className="font-semibold tabular-nums">{p.count}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
          )}
        </Card>

        <Card title="Health" description="Things that may need you.">
          <ul className="grid gap-2 text-sm">
            {[
              {
                label: "Failed steps (7 days)",
                value: d.health.failedJobs7d,
                href: "/admin/activity?tab=jobs",
              },
              {
                label: "Connections to reconnect",
                value: d.health.connectionsNeedingAttention,
                href: "/admin/activity?tab=connections",
              },
              {
                label: "Stripe events in error",
                value: d.health.stripeEventErrors,
                href: "/admin/activity?tab=stripe",
              },
            ].map((h) => (
              <li key={h.label}>
                <Link
                  href={h.href}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                >
                  <span className="flex items-center gap-2">
                    {h.value > 0 ? (
                      <AlertTriangleIcon aria-hidden="true" className="size-4 text-warning" />
                    ) : null}
                    {h.label}
                  </span>
                  <Pill tone={h.value > 0 ? "warning" : "good"}>
                    {h.value > 0 ? h.value : "OK"}
                  </Pill>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        title="Recent admin actions"
        actions={
          <Link href="/admin/activity" className="text-xs text-brand-text hover:underline">
            See all
          </Link>
        }
      >
        {d.recentAdminActions.length ? (
          <ul className="grid gap-1.5 text-sm">
            {d.recentAdminActions.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2">
                <code className="text-xs">{a.action}</code>
                <span className="text-xs text-muted-foreground">{dateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No admin action yet.</p>
        )}
      </Card>
    </div>
  );
}
