"use client";

import { ChevronsUpDownIcon, PlusIcon, TagIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setActiveBrandAction } from "@/lib/tenant/actions";

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

export type BrandOption = { id: string; name: string; country: string };

/** Picks the brand the app works on (stores, TikTok accounts and proxy are per brand). */
export function BrandSwitcher({
  brands,
  activeId,
  canCreate,
}: {
  brands: BrandOption[];
  activeId: string | null;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = brands.find((b) => b.id === activeId);

  if (brands.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong px-2.5 py-2 text-sm">
        <p className="text-muted-foreground">No brands yet.</p>
        {canCreate ? (
          <Link
            href="/app/brands"
            className="mt-1 inline-flex items-center gap-1 font-medium text-brand-text underline-offset-4 hover:underline"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add a brand
          </Link>
        ) : null}
      </div>
    );
  }

  function select(id: string) {
    if (id === activeId) return;
    setError(null);
    startTransition(async () => {
      const result = await setActiveBrandAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <Menu>
        <MenuTrigger className={switcherTriggerClass} aria-busy={pending} disabled={pending}>
          <TagIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="grid min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">Brand</span>
            <span className="truncate font-medium">{active?.name ?? "Select a brand"}</span>
          </span>
          <ChevronsUpDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Brands</MenuLabel>
          <MenuRadioGroup value={activeId ?? ""} onValueChange={select}>
            {brands.map((b) => (
              <MenuRadioItem key={b.id} value={b.id}>
                <span className="truncate">{b.name}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{b.country}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {canCreate ? (
            <>
              <MenuSeparator />
              <MenuItem asChild>
                <Link href="/app/brands">
                  <PlusIcon aria-hidden="true" />
                  Manage brands
                </Link>
              </MenuItem>
            </>
          ) : null}
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
