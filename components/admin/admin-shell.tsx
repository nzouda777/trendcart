import { ShieldIcon } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { MobileNav, MobileNavFallback } from "@/components/app-shell/mobile-nav";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

import { AdminNav, AdminSignOut } from "./admin-nav";

function SidebarBody({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href="/admin"
        className="flex w-fit items-center gap-2 rounded-md px-1"
        aria-label="Admin home"
      >
        <Logo />
      </Link>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-brand-text uppercase">
        <ShieldIcon aria-hidden="true" className="size-3" />
        Platform admin
      </span>
      <AdminNav />
      <div className="mt-auto grid gap-2 border-t border-border pt-3">
        <div className="px-2.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <AdminSignOut />
          <ThemeToggle label="Switch theme" />
        </div>
      </div>
    </div>
  );
}

/** Admin frame: sidebar on lg+, sheet below. Separate from the workspace app shell. */
export function AdminShell({
  name,
  email,
  children,
}: {
  name: string;
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-1 bg-background">
      <a
        href="#admin-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarBody name={name} email={email} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur lg:hidden">
          <Suspense fallback={<MobileNavFallback />}>
            <MobileNav>
              <SidebarBody name={name} email={email} />
            </MobileNav>
          </Suspense>
          <Logo iconClassName="size-6" wordmarkClassName="text-base" />
          <span className="text-xs font-semibold text-brand-text">Admin</span>
        </header>
        <main id="admin-content" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
