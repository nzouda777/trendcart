import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { StopImpersonating } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminPage } from "@/lib/platform/guard";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Trendcart admin" },
  robots: { index: false, follow: false },
};

async function Gate({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <AdminShell name={admin.name} email={admin.email}>
      {admin.impersonating ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning px-4 py-2 text-sm font-medium text-background">
          You are impersonating a user. Admin actions are disabled.
          <StopImpersonating />
        </div>
      ) : null}
      {children}
    </AdminShell>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-dvh animate-pulse bg-surface" aria-hidden="true" />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
