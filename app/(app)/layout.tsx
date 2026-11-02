import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireWorkspacePage } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: { default: "App", template: "%s · Trendcart" },
  robots: { index: false, follow: false },
};

/** Every app page needs a session and an active workspace; otherwise redirect. */
async function WorkspaceGate({ children }: { children: ReactNode }) {
  await requireWorkspacePage();
  return children;
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
