import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { TwoFactorForm } from "@/components/auth/two-factor-form";

export const metadata: Metadata = {
  title: "Two-factor verification",
  robots: { index: false, follow: false },
};

export default function TwoFactorPage() {
  return (
    <AuthShell
      title="Two-factor verification"
      description="Enter the code from your authenticator app to finish signing in."
    >
      <TwoFactorForm />
    </AuthShell>
  );
}
