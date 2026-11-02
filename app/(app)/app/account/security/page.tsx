import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { requireSessionPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Security" };

// Per-user account page that reads the session up front; it is fine for its
// navigation to wait on the server.
export const instant = false;

export default async function SecurityPage() {
  const { user } = await requireSessionPage(AUTH_PATHS.security);
  const enabled = Boolean(user.twoFactorEnabled);

  return (
    <div className="grid max-w-xl gap-6">
      <PageHeader title="Security" description={`Account: ${user.email}`} />
      <section
        aria-labelledby="two-factor-heading"
        className="rounded-2xl border border-border bg-surface p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="two-factor-heading" className="text-base font-semibold">
            Two-factor authentication
          </h2>
          <span
            className={
              enabled
                ? "rounded-full border border-brand-border bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text"
                : "rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
            }
          >
            {enabled ? "On" : "Off"}
          </span>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          Ask for a code from an authenticator app (TOTP) every time you sign in on a new device.
        </p>
        <TwoFactorSettings enabled={enabled} />
      </section>
    </div>
  );
}
