import type { Metadata } from "next";
import Link from "next/link";

import { AdminTitle, Card, DataTable, Pill, dateTime } from "@/components/admin/ui";
import {
  listConnectionIssues,
  listFailedJobs,
  listPlatformAudit,
  listStripeEvents,
  listWorkspaceAudit,
} from "@/lib/platform/activity";
import { requireAdminPage } from "@/lib/platform/guard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };

const TABS = [
  { id: "admin", label: "Admin actions" },
  { id: "workspaces", label: "Workspace audit" },
  { id: "jobs", label: "Failed steps" },
  { id: "connections", label: "Connections" },
  { id: "stripe", label: "Stripe events" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function meta(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "";
  return JSON.stringify(value).slice(0, 160);
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const admin = await requireAdminPage();
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "admin";

  let content: React.ReactNode;
  if (tab === "admin") {
    const rows = await listPlatformAudit(admin.db);
    content = (
      <DataTable
        caption="Admin actions"
        head={["When", "Admin", "Action", "Target", "Details"]}
        rows={rows.map((r) => [
          dateTime(r.createdAt),
          r.adminEmail ?? "–",
          <code key="a" className="text-xs">
            {r.action}
          </code>,
          r.workspaceId ? (
            <Link
              key="w"
              href={`/admin/workspaces/${r.workspaceId}`}
              className="text-xs text-brand-text hover:underline"
            >
              workspace
            </Link>
          ) : (
            <span key="t" className="text-xs text-muted-foreground">
              {r.targetType ?? ""}
            </span>
          ),
          <span key="m" className="font-mono text-[11px] break-all text-muted-foreground">
            {meta(r.metadata)}
          </span>,
        ])}
      />
    );
  } else if (tab === "workspaces") {
    const rows = await listWorkspaceAudit(admin.db);
    content = (
      <DataTable
        caption="Workspace audit"
        head={["When", "Workspace", "By", "Action", "Details"]}
        rows={rows.map((r) => [
          dateTime(r.createdAt),
          <Link key="w" href={`/admin/workspaces/${r.workspaceId}`} className="hover:underline">
            {r.workspaceName ?? r.workspaceId}
          </Link>,
          r.actorEmail ?? "System",
          <code key="a" className="text-xs">
            {r.action}
          </code>,
          <span key="m" className="font-mono text-[11px] break-all text-muted-foreground">
            {meta(r.metadata)}
          </span>,
        ])}
      />
    );
  } else if (tab === "jobs") {
    const rows = await listFailedJobs(admin.db);
    content = (
      <DataTable
        caption="Failed steps"
        empty="No failed step."
        head={["When", "Workspace", "Product", "Step", "Attempts", "Error"]}
        rows={rows.map((r) => [
          dateTime(r.updatedAt),
          <Link key="w" href={`/admin/workspaces/${r.workspaceId}`} className="hover:underline">
            {r.workspaceName ?? r.workspaceId}
          </Link>,
          r.productName ?? r.productId,
          <code key="s" className="text-xs">
            {r.step}
          </code>,
          r.attempts,
          <span key="e" className="text-xs break-words text-danger">
            {(r.error ?? "").slice(0, 200)}
          </span>,
        ])}
      />
    );
  } else if (tab === "connections") {
    const rows = await listConnectionIssues(admin.db);
    content = (
      <DataTable
        caption="Connections needing attention"
        empty="Every connection is healthy."
        head={["Since", "Workspace", "Kind", "Account", "Status"]}
        rows={rows.map((r) => [
          dateTime(r.updatedAt),
          <Link key="w" href={`/admin/workspaces/${r.workspaceId}`} className="hover:underline">
            {r.workspaceName}
          </Link>,
          r.kind,
          r.name ?? "–",
          <Pill key="s" tone={r.status === "expiring" ? "warning" : "danger"}>
            {r.status}
          </Pill>,
        ])}
      />
    );
  } else {
    const rows = await listStripeEvents(admin.db);
    content = (
      <DataTable
        caption="Stripe events"
        empty="No Stripe event received yet."
        head={["Received", "Event", "Type", "Result"]}
        rows={rows.map((r) => [
          dateTime(r.receivedAt),
          <code key="i" className="text-[11px]">
            {r.id}
          </code>,
          <code key="t" className="text-xs">
            {r.type}
          </code>,
          r.error && !r.processedAt ? (
            <Pill key="r" tone="danger">
              {r.error.slice(0, 80)}
            </Pill>
          ) : r.processedAt ? (
            <Pill key="r" tone="good">
              Processed
            </Pill>
          ) : (
            <Pill key="r" tone="warning">
              Pending
            </Pill>
          ),
        ])}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <AdminTitle
        title="Activity"
        description="What happened across Trendcart, newest first (last 100)."
      />
      <nav aria-label="Activity" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/activity?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm",
              t.id === tab
                ? "bg-brand-soft font-medium text-brand-text"
                : "text-muted-foreground hover:bg-surface-2",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Card>{content}</Card>
    </div>
  );
}
