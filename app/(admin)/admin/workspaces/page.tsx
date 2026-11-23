import type { Metadata } from "next";
import Link from "next/link";

import { AdminTitle, Card, DataTable, Pill, shortDate, usd } from "@/components/admin/ui";
import { STATUS_LABELS, type SubscriptionStatus } from "@/lib/domain/billing";
import { requireAdminPage } from "@/lib/platform/guard";
import { listPlans } from "@/lib/platform/plans";
import { listWorkspaces } from "@/lib/platform/workspaces";

export const metadata: Metadata = { title: "Workspaces" };

const PAGE = 50;

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const admin = await requireAdminPage();
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const [{ rows, total }, plans] = await Promise.all([
    listWorkspaces(admin.db, { q: query.q, limit: PAGE, offset: (page - 1) * PAGE }),
    listPlans(admin.db),
  ]);
  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? "–";
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) =>
    `/admin/workspaces?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), page: String(p) })}`;

  return (
    <div className="grid gap-6">
      <AdminTitle title="Workspaces" description={`${total} workspace${total === 1 ? "" : "s"}.`} />
      <form className="flex max-w-md gap-2" role="search">
        <input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search by name or slug"
          aria-label="Search workspaces"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
        />
        <button className="h-10 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2">
          Search
        </button>
      </form>
      <Card>
        <DataTable
          caption="Workspaces"
          empty="No workspace found."
          head={[
            "Workspace",
            "Owner",
            "Plan",
            "Status",
            "Members",
            "Products",
            "AI this month",
            "Created",
          ]}
          rows={rows.map((w) => [
            <Link
              key="n"
              href={`/admin/workspaces/${w.id}`}
              className="font-medium hover:underline"
            >
              {w.name}
            </Link>,
            w.owner ? (
              <span key="o" className="text-xs">
                {w.owner.name}
                <br />
                <span className="text-muted-foreground">{w.owner.email}</span>
              </span>
            ) : (
              "–"
            ),
            planName(w.planId),
            w.suspended ? (
              <Pill key="s" tone="danger">
                Suspended
              </Pill>
            ) : w.subscriptionStatus ? (
              <Pill key="s" tone={w.access ? "good" : "warning"}>
                {STATUS_LABELS[w.subscriptionStatus as SubscriptionStatus] ?? w.subscriptionStatus}
                {w.subscriptionSource === "admin" ? " (granted)" : ""}
              </Pill>
            ) : (
              <Pill key="s">No plan</Pill>
            ),
            w.members,
            w.products,
            usd(w.aiCostMonthUsd),
            shortDate(w.createdAt),
          ])}
        />
      </Card>
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {page > 1 ? <Link href={link(page - 1)}>← Previous</Link> : null}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={link(page + 1)}>Next →</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
