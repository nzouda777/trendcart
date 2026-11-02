import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { hasPermission } from "@/lib/auth/guards";
import { AUTH_PATHS } from "@/lib/auth/paths";
import { getMyWorkspaces, requireWorkspacePage } from "@/lib/auth/session";
import { getActiveBrand, listBrands } from "@/lib/tenant/active-brand";

import { BrandSwitcher } from "./brand-switcher";
import { SidebarNav, SidebarNavFallback } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

/*
 * Sidebar content. The static parts (logo, nav) prerender into the shell;
 * the session parts stream in behind their own Suspense boundaries.
 * The session getters are request-cached, so rendering this twice (desktop
 * aside + mobile sheet) does not query twice.
 */

async function Switchers() {
  const ctx = await requireWorkspacePage();
  const [workspaces, brands] = await Promise.all([getMyWorkspaces(), listBrands(ctx)]);
  const activeBrand = await getActiveBrand(ctx, brands);
  return (
    <div className="grid gap-2">
      <WorkspaceSwitcher
        workspaces={workspaces.map(({ id, name, role }) => ({ id, name, role }))}
        activeId={ctx.workspaceId}
      />
      <BrandSwitcher
        brands={brands.map(({ id, name, country }) => ({ id, name, country }))}
        activeId={activeBrand?.id ?? null}
        canCreate={hasPermission(ctx, "brand:create")}
      />
    </div>
  );
}

async function RoleNav() {
  const ctx = await requireWorkspacePage();
  return <SidebarNav role={ctx.actor.role} />;
}

async function User() {
  const { actor } = await requireWorkspacePage();
  return <UserMenu name={actor.name} email={actor.email} role={actor.role} />;
}

function SwitchersSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      <div className="h-[3.25rem] animate-pulse rounded-lg bg-surface-2" />
      <div className="h-[3.25rem] animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}

export function SidebarContent() {
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <Link
        href={AUTH_PATHS.home}
        className="w-fit rounded-md px-1"
        aria-label="Trendcart app home"
      >
        <Logo />
      </Link>
      <Suspense fallback={<SwitchersSkeleton />}>
        <Switchers />
      </Suspense>
      <Suspense fallback={<SidebarNavFallback />}>
        <RoleNav />
      </Suspense>
      <div className="mt-auto border-t border-border pt-3">
        <Suspense fallback={<div className="h-12 animate-pulse rounded-lg bg-surface-2" />}>
          <User />
        </Suspense>
      </div>
    </div>
  );
}
