import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
  // Own canonical, not the inherited "/".
  alternates: { canonical: siteConfig.links.signIn },
};

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in"
      description={`Welcome back to ${siteConfig.name}.`}
      footer={
        <>
          New to {siteConfig.name}?{" "}
          <Link
            href={siteConfig.links.signUp}
            className="font-medium text-brand-text underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
