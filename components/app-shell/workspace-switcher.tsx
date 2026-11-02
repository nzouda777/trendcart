"use client";

import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { authClient } from "@/lib/auth/client";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  switcherTriggerClass,
} from "./menu";

export type WorkspaceOption = { id: string; name: string; role: Role };

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md border border-brand-border bg-brand-soft text-xs font-semibold text-brand-text"
    >
      {name.trim().charAt(0).toUpperCase() || "W"}
    </span>
  );
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceOption[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = workspaces.find((w) => w.id === activeId);

  function select(id: string) {
    if (id === activeId) return;
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.organization.setActive({ organizationId: id });
      if (failure) {
        setError(failure.message ?? "Could not switch workspace.");
        return;
      }
      router.push(AUTH_PATHS.home);
      router.refresh();
    });
  }

  return (
    <div>
      <Menu>
        <MenuTrigger className={switcherTriggerClass} aria-busy={pending} disabled={pending}>
          <Initial name={active?.name ?? "?"} />
          <span className="grid min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">Workspace</span>
            <span className="truncate font-medium">{active?.name ?? "Select a workspace"}</span>
          </span>
          <ChevronsUpDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Workspaces</MenuLabel>
          <MenuRadioGroup value={activeId} onValueChange={select}>
            {workspaces.map((w) => (
              <MenuRadioItem key={w.id} value={w.id}>
                <Initial name={w.name} />
                <span className="grid min-w-0">
                  <span className="truncate">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABELS[w.role]}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem asChild>
            <Link href={AUTH_PATHS.createWorkspace}>
              <PlusIcon aria-hidden="true" />
              Create workspace
            </Link>
          </MenuItem>
        </MenuContent>
      </Menu>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
