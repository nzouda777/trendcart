import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { CreateWorkspaceForm } from "@/components/auth/create-workspace-form";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { requireSessionPage } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create a workspace",
  robots: { index: false, follow: false },
};

async function SignedInOnly() {
  await requireSessionPage(AUTH_PATHS.createWorkspace);
  return <CreateWorkspaceForm />;
}

export default function CreateWorkspacePage() {
  return (
    <AuthShell
      title="Create a workspace"
      description="A workspace holds your team, brands, Shopify stores and TikTok accounts. You will be its owner."
    >
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface-2" />}>
        <SignedInOnly />
      </Suspense>
    </AuthShell>
  );
}
