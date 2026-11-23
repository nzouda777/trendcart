import {
  BanIcon,
  CalendarPlusIcon,
  CircleOffIcon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { GrantPlanButton } from "@/components/admin/grant-plan";
import { AdminTitle, Card, DataTable, Pill, dateTime, shortDate, usd } from "@/components/admin/ui";
import { hasAccess, STATUS_LABELS } from "@/lib/domain/billing";
import { isAccessError } from "@/lib/auth/errors";
import { requireAdminPage } from "@/lib/platform/guard";
import { listPlans } from "@/lib/platform/plans";
import { getWorkspaceDetail } from "@/lib/platform/workspaces";
import { ServiceError } from "@/lib/services/errors";

import {
  aiCapAction,
  cancelSubscriptionAction,
  deleteWorkspaceAction,
  endAccessAction,
  extendTrialAction,
  grantPlanAction,
  suspendAction,
  unsuspendAction,
} from "../actions";

export const metadata: Metadata = { title: "Workspace" };

const SOURCE = { stripe: "Stripe", trial: "Free trial", admin: "Granted by an admin" } as const;

export default async function WorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  let d;
  try {
    d = await getWorkspaceDetail(admin.db, id);
  } catch (error) {
    if (error instanceof ServiceError || isAccessError(error)) notFound();
    throw error;
  }
  const plans = await listPlans(admin.db);
  const sub = d.subscription;
  const planRow = sub?.planId ? plans.find((p) => p.id === sub.planId) : undefined;
  const suspended = !!d.settings?.suspendedAt;
  const access = hasAccess(sub, new Date());

  return (
    <div className="grid gap-5">
      <Link
        href="/admin/workspaces"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All workspaces
      </Link>
      <AdminTitle
        title={d.org.name}
        description={`Created ${shortDate(d.org.createdAt)} · ${d.members.length} member(s) · ${d.products} product(s) · ${d.brands} brand(s)`}
        actions={
          suspended ? (
            <Pill tone="danger">
              Suspended{d.settings?.suspendedReason ? `: ${d.settings.suspendedReason}` : ""}
            </Pill>
          ) : (
            <Pill tone={access ? "good" : "warning"}>
              {access ? "Has access" : "No active plan"}
            </Pill>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Subscription">
          {sub ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Plan</dt>
                <dd className="font-medium">{planRow?.name ?? "Deleted plan"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd>{SOURCE[sub.source]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>{STATUS_LABELS[sub.status] ?? sub.status}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pays</dt>
                <dd>
                  {sub.unitAmountCents
                    ? `${usd(sub.unitAmountCents / 100)} / ${sub.interval ?? "period"}`
                    : "Nothing"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {sub.source === "stripe" ? "Renews / ends" : "Access ends"}
                </dt>
                <dd>
                  {sub.source === "stripe"
                    ? shortDate(
                        sub.trialEndsAt && sub.status === "trialing"
                          ? sub.trialEndsAt
                          : sub.currentPeriodEnd,
                      )
                    : sub.endsAt
                      ? shortDate(sub.endsAt)
                      : "No end"}
                  {sub.cancelAtPeriodEnd ? " (cancels)" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Free trial used</dt>
                <dd>{sub.trialUsedAt ? shortDate(sub.trialUsedAt) : "No"}</dd>
              </div>
              {sub.stripeSubscriptionId ? (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Stripe</dt>
                  <dd className="font-mono text-xs break-all">
                    {sub.stripeSubscriptionId} · {sub.stripeCustomerId}
                  </dd>
                </div>
              ) : null}
              {sub.adminNote ? (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Admin note</dt>
                  <dd>{sub.adminNote}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            <GrantPlanButton
              plans={plans
                .filter((p) => p.status !== "archived")
                .map((p) => ({ id: p.id, name: p.name, status: p.status }))}
              onGrant={grantPlanAction.bind(null, d.org.id)}
            />
            {sub && (sub.source !== "stripe" || sub.status === "trialing") ? (
              <ActionButton
                label="Extend"
                icon={<CalendarPlusIcon aria-hidden="true" />}
                title="Extend access?"
                description={
                  sub.source === "stripe"
                    ? "Moves the end of the Stripe trial (the customer is charged later)."
                    : "Adds days to the free trial or the grant."
                }
                input={{ label: "Days to add", type: "number", required: true }}
                onConfirm={extendTrialAction.bind(null, d.org.id)}
              />
            ) : null}
            {sub && sub.source !== "stripe" && access ? (
              <ActionButton
                label="End access now"
                icon={<CircleOffIcon aria-hidden="true" />}
                title="End this free trial or grant now?"
                description="The workspace loses access until it chooses a plan."
                destructive
                onConfirm={endAccessAction.bind(null, d.org.id)}
              />
            ) : null}
            {sub?.source === "stripe" && access ? (
              <>
                <ActionButton
                  label="Cancel at period end"
                  icon={<XCircleIcon aria-hidden="true" />}
                  title="Cancel at the end of the paid period?"
                  description="Stripe stops renewing it; access stays until the period ends."
                  onConfirm={cancelSubscriptionAction.bind(null, d.org.id, "period_end")}
                />
                <ActionButton
                  label="Cancel now"
                  variant="destructive"
                  destructive
                  title="Cancel the Stripe subscription now?"
                  description="Access stops immediately. No refund is issued by Trendcart (do it in Stripe if needed)."
                  onConfirm={cancelSubscriptionAction.bind(null, d.org.id, "now")}
                />
              </>
            ) : null}
          </div>
        </Card>

        <Card title="Controls">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">AI budget override</dt>
              <dd>
                {d.settings?.adminAiMonthlyCapUsd != null
                  ? usd(Number(d.settings.adminAiMonthlyCapUsd))
                  : "None (plan or default)"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">AI this month</dt>
              <dd>{usd(Number(d.usage[0]?.aiCostUsd ?? 0))}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            <ActionButton
              label="AI budget"
              icon={<SparklesIcon aria-hidden="true" />}
              title="Set this workspace's monthly AI budget"
              description="Overrides the plan's AI budget. Leave empty to go back to the plan or the default."
              input={{ label: "USD per month", type: "number", placeholder: "Plan / default" }}
              onConfirm={aiCapAction.bind(null, d.org.id)}
            />
            {suspended ? (
              <ActionButton
                label="Unsuspend"
                icon={<PlayIcon aria-hidden="true" />}
                title="Unsuspend this workspace?"
                description="Its members can use the app again."
                onConfirm={unsuspendAction.bind(null, d.org.id)}
              />
            ) : (
              <ActionButton
                label="Suspend"
                icon={<BanIcon aria-hidden="true" />}
                destructive
                title="Suspend this workspace?"
                description="Members keep their accounts but cannot use the app (imports, approvals, launches). Running TikTok campaigns are not paused: pause them first if needed."
                input={{ label: "Reason (shown to members)", placeholder: "Optional" }}
                onConfirm={suspendAction.bind(null, d.org.id)}
              />
            )}
          </div>
        </Card>
      </div>

      <Card title="Members">
        <DataTable
          caption="Members"
          head={["Name", "Email", "Role", "Joined", ""]}
          rows={d.members.map((m) => [
            m.name,
            m.email,
            m.role,
            shortDate(m.createdAt),
            m.banned ? (
              <Pill key="b" tone="danger">
                Banned
              </Pill>
            ) : (
              <Link
                key="u"
                href={`/admin/users?q=${encodeURIComponent(m.email)}`}
                className="text-brand-text hover:underline"
              >
                Manage user
              </Link>
            ),
          ])}
        />
        {d.invitations.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Pending invitations: {d.invitations.map((i) => `${i.email} (${i.role})`).join(", ")}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Shopify stores">
          <ul className="grid gap-1 text-sm">
            {d.stores.length ? (
              d.stores.map((s) => (
                <li key={s.shop} className="flex justify-between gap-2">
                  <span className="truncate">{s.shop}</span>
                  <Pill tone={s.status === "active" ? "good" : "warning"}>{s.status}</Pill>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">None</li>
            )}
          </ul>
        </Card>
        <Card title="TikTok Ads accounts">
          <ul className="grid gap-1 text-sm">
            {d.adAccounts.length ? (
              d.adAccounts.map((s, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <Pill tone={s.status === "active" ? "good" : "warning"}>{s.status}</Pill>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">None</li>
            )}
          </ul>
        </Card>
        <Card title="Campaigns">
          <ul className="grid gap-1 text-sm">
            {d.campaigns.length ? (
              d.campaigns.map((c) => (
                <li key={c.status} className="flex justify-between gap-2">
                  <span>{c.status}</span>
                  <span className="font-semibold tabular-nums">{Number(c.c)}</span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">None</li>
            )}
          </ul>
        </Card>
      </div>

      <Card title="Workspace activity" description="Its own audit log, newest first.">
        <DataTable
          caption="Workspace audit log"
          head={["When", "Action", "Target"]}
          rows={d.audit.map((a) => [
            dateTime(a.createdAt),
            <code key="a" className="text-xs">
              {a.action}
            </code>,
            <span key="t" className="text-xs text-muted-foreground">
              {a.targetType ?? ""} {a.targetId ?? ""}
            </span>,
          ])}
        />
      </Card>

      <Card
        title="Delete workspace"
        description="Removes the workspace and all its Trendcart data. Nothing is deleted on Shopify or TikTok."
        className="border-danger/30"
      >
        <ActionButton
          label="Delete workspace"
          variant="destructive"
          destructive
          icon={<Trash2Icon aria-hidden="true" />}
          title={`Delete ${d.org.name}?`}
          description="This cannot be undone. Type the workspace name to confirm."
          input={{ label: "Workspace name", required: true, placeholder: d.org.name }}
          onConfirm={deleteWorkspaceAction.bind(null, d.org.id)}
        />
      </Card>
    </div>
  );
}
