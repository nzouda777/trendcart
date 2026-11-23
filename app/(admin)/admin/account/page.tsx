import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { AdminTitle, Card, Pill } from "@/components/admin/ui";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";
import { getSession } from "@/lib/auth/session";
import { requireAdminPage } from "@/lib/platform/guard";

import { changeAdminPasswordAction } from "./actions";

export const metadata: Metadata = { title: "My account" };

export default async function AdminAccountPage() {
  const admin = await requireAdminPage();
  const session = await getSession();
  const twoFactor = Boolean(session?.user.twoFactorEnabled);
  return (
    <div className="grid max-w-3xl gap-5">
      <AdminTitle
        title="My account"
        description={`${admin.name} · ${admin.email}. Forgot the password? Run pnpm admin:password --email ${admin.email} in a terminal.`}
      />
      <Card title="Password">
        <ChangePasswordForm onChange={changeAdminPasswordAction} />
      </Card>
      <Card
        title="Two-factor authentication"
        description="Strongly recommended for admin accounts: they can act on every workspace."
        actions={<Pill tone={twoFactor ? "good" : "warning"}>{twoFactor ? "On" : "Off"}</Pill>}
      >
        <TwoFactorSettings enabled={twoFactor} />
      </Card>
    </div>
  );
}
