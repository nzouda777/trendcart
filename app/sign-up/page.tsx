import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { siteConfig } from "@/config/site";
import { integrationsMode } from "@/lib/auth/mail";

export const metadata: Metadata = {
  title: "Get started",
  robots: { index: false, follow: true },
  // Own canonical, not the inherited "/".
  alternates: { canonical: siteConfig.links.signUp },
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Then create a workspace for your team, brands and stores."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={siteConfig.links.signIn}
            className="font-medium text-brand-text underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm mockEmail={integrationsMode() === "mock"} />
    </AuthShell>
  );
}
