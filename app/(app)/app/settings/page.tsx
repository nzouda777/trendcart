import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/app-shell";
import { SettingsForm } from "@/components/app/settings-form";
import { PageSkeleton, Section } from "@/components/app/surface";
import { can } from "@/lib/auth/permissions";
import { getWorkspaceSettings } from "@/lib/services";

import { getPageContext } from "../_lib/page-context";
import { updateSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

// Session reads stay behind Suspense so the route keeps a static shell.
export default function SettingsPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Settings"
        description="Which AI does what, how much it may spend each month, and how long each AI step may take."
      />
      <Suspense fallback={<PageSkeleton panels={2} />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

async function SettingsContent() {
  const { ctx, role } = await getPageContext();
  const settings = await getWorkspaceSettings(ctx);
  const canEdit = can(role, "workspace:update");

  return (
    <Section
      id="ai-settings"
      title="AI"
      description={
        canEdit ? (
          <>
            Spending so far is on the{" "}
            <Link href="/app/usage" className="underline underline-offset-4">
              Usage
            </Link>{" "}
            page.
          </>
        ) : (
          "Only workspace owners can change these settings."
        )
      }
    >
      <SettingsForm settings={settings} canEdit={canEdit} onSubmit={updateSettingsAction} />
    </Section>
  );
}
