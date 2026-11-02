import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app-shell";
import { Pill } from "@/components/app/badges";
import { formatDate } from "@/components/app/format";
import { ListSkeleton, PageSkeleton, Section } from "@/components/app/surface";
import {
  InviteForm,
  MemberRoleSelect,
  PendingInvitations,
  RemoveMemberButton,
} from "@/components/app/team/team-controls";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/auth/permissions";
import { listMembers } from "@/lib/services";

import { getPageContext } from "../_lib/page-context";

export const metadata: Metadata = { title: "Team" };

// Session reads stay behind Suspense so the route keeps a static shell.
export default function TeamPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TeamContent />
    </Suspense>
  );
}

async function TeamContent() {
  const { ctx, role } = await getPageContext();
  const isOwner = role === "owner";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Team and roles"
        description={
          isOwner
            ? "Invite people and choose what they can do."
            : "People in this workspace. Only owners can invite or change roles."
        }
      />

      <Section id="members" title="Members">
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <Members />
        </Suspense>
      </Section>

      {isOwner ? (
        <>
          <Section
            id="invite"
            title="Invite someone"
            description="They get an email with a link valid for 7 days."
          >
            <InviteForm workspaceId={ctx.workspaceId} />
          </Section>
          <Section id="invitations" title="Pending invitations">
            <PendingInvitations workspaceId={ctx.workspaceId} />
          </Section>
        </>
      ) : null}

      <Section id="roles" title="Roles">
        <dl className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r} className="rounded-xl border border-border bg-background p-4">
              <dt className="text-sm font-medium">{ROLE_LABELS[r]}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

async function Members() {
  const { ctx, role } = await getPageContext();
  const members = await listMembers(ctx);
  const isOwner = role === "owner";

  return (
    <ul className="grid gap-2" aria-label="Members">
      {members.map((m) => (
        <li
          key={m.memberId}
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-sm font-medium"
            >
              {(m.name || m.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{m.name || m.email}</span>
                {m.isCurrentUser ? <Pill tone="neutral">You</Pill> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {m.email} · Joined {formatDate(m.joinedAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && !m.isCurrentUser ? (
              <>
                <MemberRoleSelect
                  memberId={m.memberId}
                  name={m.name || m.email}
                  role={m.role}
                  workspaceId={ctx.workspaceId}
                />
                <RemoveMemberButton
                  memberId={m.memberId}
                  name={m.name || m.email}
                  workspaceId={ctx.workspaceId}
                />
              </>
            ) : (
              <span className="text-sm text-muted-foreground">{ROLE_LABELS[m.role]}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
