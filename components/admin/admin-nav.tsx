"use client";

import {
  ActivityIcon,
  Building2Icon,
  CreditCardIcon,
  GaugeIcon,
  KeyRoundIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: GaugeIcon },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2Icon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/plans", label: "Plans & pricing", icon: CreditCardIcon },
  { href: "/admin/activity", label: "Activity", icon: ActivityIcon },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
  { href: "/admin/account", label: "My account", icon: KeyRoundIcon },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="grid gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "bg-brand-soft font-medium text-brand-text"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSignOut() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await authClient.signOut();
          router.push("/sign-in");
          router.refresh();
        })
      }
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <LogOutIcon aria-hidden="true" className="size-4" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function StopImpersonating() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await authClient.admin.stopImpersonating();
          router.push("/admin/users");
          router.refresh();
        })
      }
      className="rounded-md bg-background px-2.5 py-1 text-xs font-semibold text-foreground"
    >
      {pending ? "Stopping…" : "Stop impersonating"}
    </button>
  );
}
