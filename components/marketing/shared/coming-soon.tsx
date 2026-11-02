import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { landing } from "@/content/landing";

export type ComingSoonProps = {
  /** Page heading, e.g. "Sign in". */
  title: string;
  description: string;
};

/** Full-page "Coming soon" placeholder used by /sign-in and /sign-up. */
export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="relative isolate flex min-h-dvh flex-1 flex-col overflow-hidden bg-grid">
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
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-5 pb-24 text-center"
      >
        <p className="rounded-full border border-brand-border bg-brand-soft px-3 py-1 font-mono text-xs tracking-[0.18em] text-brand-text uppercase">
          Coming soon
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="text-pretty text-muted-foreground">{description}</p>
        <Button asChild variant="outline" size="xl" className="mt-2">
          <Link href={siteConfig.links.home}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Back to home
          </Link>
        </Button>
      </main>
    </div>
  );
}
