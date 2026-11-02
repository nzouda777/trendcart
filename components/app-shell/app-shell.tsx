import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { AUTH_PATHS } from "@/lib/auth/paths";

import { MobileNav, MobileNavFallback } from "./mobile-nav";
import { SidebarContent } from "./sidebar";

/**
 * Product app frame: fixed sidebar on lg+, top bar with a sheet below.
 * Pages render inside <main id="main-content">; use PageHeader + EmptyState.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur lg:hidden">
          <Suspense fallback={<MobileNavFallback />}>
            <MobileNav>
              <SidebarContent />
            </MobileNav>
          </Suspense>
          <Link href={AUTH_PATHS.home} className="rounded-md" aria-label="Trendcart app home">
            <Logo iconClassName="size-6" wordmarkClassName="text-base" />
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
