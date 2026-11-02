"use client";

import { LogOutIcon, MoonIcon, ShieldCheckIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTransition } from "react";

import { authClient } from "@/lib/auth/client";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";

import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "./menu";

export function UserMenu({ name, email, role }: { name: string; email: string; role: Role }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";

  function signOut() {
    startTransition(async () => {
      await authClient.signOut();
      router.push(AUTH_PATHS.signIn);
      router.refresh();
    });
  }

  return (
    <Menu>
      <MenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-surface-2 data-[state=open]:bg-surface-2"
        aria-label={`Account menu for ${name}`}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold"
        >
          {initials}
        </span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[role]}</span>
        </span>
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-64">
        <MenuLabel className="grid">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate font-normal">{email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={AUTH_PATHS.security}>
            <ShieldCheckIcon aria-hidden="true" />
            Security and two-factor
          </Link>
        </MenuItem>
        <MenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          <SunIcon aria-hidden="true" className="hidden dark:block" />
          <MoonIcon aria-hidden="true" className="block dark:hidden" />
          <span className="dark:hidden">Dark theme</span>
          <span className="hidden dark:inline">Light theme</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={signOut} disabled={pending}>
          <LogOutIcon aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
