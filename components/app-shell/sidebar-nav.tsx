"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { can, type Role } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

import { APP_NAV, isNavActive } from "./nav";

/** Primary navigation. `role` filters items; omit it to show everything (while loading). */
export function SidebarNav({ role, onNavigate }: { role?: Role; onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} role={role} onNavigate={onNavigate} />;
}

/**
 * Prerender-safe fallback: no usePathname (runtime URL data), so it can sit in
 * the static shell. No item is highlighted until the real nav streams in.
 */
export function SidebarNavFallback() {
  return <NavList pathname={null} />;
}

function NavList({
  pathname,
  role,
  onNavigate,
}: {
  pathname: string | null;
  role?: Role;
  onNavigate?: () => void;
}) {
  const items = APP_NAV.filter((item) => !role || !item.permission || can(role, item.permission));

  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname !== null && isNavActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-brand-soft text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("size-4 shrink-0", active ? "text-brand-text" : undefined)}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
