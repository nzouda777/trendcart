import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AcceptInvite } from "@/components/auth/accept-invite";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { getInvitationForCurrentUser } from "@/lib/auth/invitations";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Workspace invitation",
  robots: { index: false, follow: false },
};

async function Invite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = encodeURIComponent(AUTH_PATHS.invite(id));
  const session = await getSession();

  if (!session) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Sign in, or create an account with the email address the invitation was sent to.
        </p>
        <Button asChild size="xl">
          <Link href={`${AUTH_PATHS.signUp}?next=${back}`}>Create an account</Link>
        </Button>
        <Button asChild size="xl" variant="outline">
          <Link href={`${AUTH_PATHS.signIn}?next=${back}`}>Sign in</Link>
        </Button>
      </div>
    );
  }

  const invitation = await getInvitationForCurrentUser(id);
  if (!invitation) {
    return (
      <div className="grid gap-3 text-sm text-muted-foreground">
        <p>
          This invitation is no longer valid, or it was sent to a different email than{" "}
          <span className="font-medium text-foreground">{session.user.email}</span>.
        </p>
        <Button asChild size="xl" variant="outline">
          <Link href={AUTH_PATHS.home}>Go to the app</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <dl className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Workspace</dt>
          <dd className="font-medium">{invitation.workspaceName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Invited by</dt>
          <dd className="truncate">{invitation.inviterEmail}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <span className="rounded-full border border-brand-border bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text">
              {ROLE_LABELS[invitation.role]}
            </span>
          </dd>
        </div>
        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[invitation.role]}</p>
      </dl>
      <AcceptInvite invitationId={invitation.id} workspaceId={invitation.workspaceId} />
    </div>
  );
}

export default function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthShell title="You're invited" description="Join your team's workspace.">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface-2" />}>
        <Invite params={params} />
      </Suspense>
    </AuthShell>
  );
}
