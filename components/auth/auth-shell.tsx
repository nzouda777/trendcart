import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { siteConfig } from "@/config/site";
import { landing } from "@/content/landing";

export type AuthShellProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Small print under the card (e.g. "No account? Sign up"). */
  footer?: ReactNode;
};

/** Centered card layout shared by sign-in, sign-up, 2FA, workspace and invite pages. */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="relative isolate flex min-h-dvh flex-1 flex-col bg-grid">
      <header className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link
          href={siteConfig.links.home}
          className="rounded-md"
          aria-label={`${siteConfig.name} home`}
        >
          <Logo />
        </Link>
        <ThemeToggle label={landing.nav.themeToggleLabel} />
      </header>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pt-4 pb-24"
      >
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <div className="mt-2 text-sm text-pretty text-muted-foreground">{description}</div>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </main>
    </div>
  );
}
