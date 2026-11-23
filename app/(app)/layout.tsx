import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { headers } from "next/headers";

import { StopImpersonating } from "@/components/admin/admin-nav";
import { BillingWall } from "@/components/app/billing-wall";
import { OPEN_WITHOUT_PLAN, PATH_HEADER } from "@/lib/auth/paths";
import { getSession, requireWorkspacePage } from "@/lib/auth/session";
import { getAccessState } from "@/lib/services/billing";

export const metadata: Metadata = {
  title: { default: "App", template: "%s · Trendcart" },
  robots: { index: false, follow: false },
};

/**
 * Every app page needs a session and an active workspace (otherwise redirect),
 * and, once billing applies, a subscription giving access: without one, pages
 * other than billing / security / guide show the billing wall.
 */
async function WorkspaceGate({ children }: { children: ReactNode }) {
  const ctx = await requireWorkspacePage();
  const [entitlement, session, path] = await Promise.all([
    getAccessState(ctx),
    getSession(),
    headers().then((h) => h.get(PATH_HEADER) ?? ""),
  ]);
  const impersonatedBy = (session?.session as { impersonatedBy?: string | null } | undefined)
    ?.impersonatedBy;
  const open = OPEN_WITHOUT_PLAN.some((p) => path === p || path.startsWith(`${p}/`));
  return (
    <>
      {impersonatedBy ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning px-4 py-2 text-sm font-medium text-background">
          Admin view: you are signed in as {session?.user.email}.
          <StopImpersonating />
        </div>
      ) : null}
      {entitlement.access || open ? (
        children
      ) : (
        <BillingWall
          suspended={!!entitlement.suspended}
          reason={entitlement.suspended?.reason}
          isOwner={ctx.actor.role === "owner"}
        />
      )}
    </>
  );
}

function PageSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-64 animate-pulse rounded-2xl bg-surface" />
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <WorkspaceGate>{children}</WorkspaceGate>
      </Suspense>
    </AppShell>
  );
}
