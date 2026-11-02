import { Building2Icon, CheckCircle2Icon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { HealthBadge, ProductStatusBadge } from "@/components/app/badges";
import { GATE_META, whoApproves } from "@/components/app/product-status";
import { ProductThumb } from "@/components/app/product-thumb";
import { ListSkeleton, PageSkeleton, Section } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import { can, gatePermission } from "@/lib/auth/permissions";
import { listConnections, listProducts } from "@/lib/services";
import type { BrandDTO, ConnectionHealth } from "@/lib/services/types";

import { getPageContext } from "./_lib/page-context";

export const metadata: Metadata = { title: "Overview" };

// Session reads stay behind Suspense so the route keeps a static shell.
export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton panels={2} />}>
      <OverviewContent />
    </Suspense>
  );
}

async function OverviewContent() {
  const { ctx, role, brands, activeBrand } = await getPageContext();

  if (brands.length === 0) {
    if (can(role, "brand:create")) redirect("/app/onboarding");
    return (
      <div className="grid gap-6">
        <PageHeader title="Overview" description={`Signed in as ${ctx.actor.name}.`} />
        <EmptyState
          icon={Building2Icon}
          title="No brands yet"
          description="A workspace owner needs to add a brand before products can be imported."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Overview"
        description={activeBrand ? `Working on ${activeBrand.name}.` : undefined}
        actions={
          can(role, "product:create") ? (
            <Button asChild size="lg">
              <Link href="/app/import">
                <PlusIcon aria-hidden="true" />
                Import a product
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Section
        id="waiting"
        title="Waiting for a decision"
        description="Products paused at an approval gate."
        actions={
          <Link
            href="/app/products?status=action&brand=all"
            className="text-sm text-brand-text underline-offset-4 hover:underline"
          >
            See all
          </Link>
        }
      >
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <Waiting brands={brands} />
        </Suspense>
      </Section>
      {activeBrand && can(role, "connection:read") ? (
        <Section
          id="health"
          title="Connections"
          description={`Health of ${activeBrand.name}'s store and TikTok accounts.`}
          actions={
            <Link
              href="/app/connections"
              className="text-sm text-brand-text underline-offset-4 hover:underline"
            >
              Manage
            </Link>
          }
        >
          <Suspense fallback={<ListSkeleton rows={1} />}>
            <Health brand={activeBrand} />
          </Suspense>
        </Section>
      ) : null}
    </div>
  );
}

async function Waiting({ brands }: { brands: BrandDTO[] }) {
  const { ctx, role } = await getPageContext();
  const { items } = await listProducts(ctx, {
    status: [
      "awaiting_product_confirmation",
      "awaiting_supplier_choice",
      "awaiting_content_approval",
      "ready_to_launch",
    ],
    limit: 6,
  });
  if (items.length === 0) {
    return (
      <EmptyState
        as="h3"
        icon={CheckCircle2Icon}
        title="Nothing waiting"
        description="Products that need a confirmation or approval show up here."
        className="py-8"
      />
    );
  }
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  return (
    <ul className="grid gap-2" aria-label="Products waiting for a decision">
      {items.map((p) => {
        const gate = p.gate;
        const yours = gate ? can(role, gatePermission(gate)) : false;
        return (
          <li key={p.id}>
            <Link
              href={`/app/products/${p.id}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-colors outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProductThumb src={p.thumbnailUrl} className="size-11" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">
                  {p.name ?? "Unidentified product"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {brands.length > 1 ? `${brandName.get(p.brandId) ?? ""} · ` : ""}
                  {gate
                    ? yours
                      ? `Gate ${GATE_META[gate].number}: ${GATE_META[gate].action}`
                      : `Waiting for: ${whoApproves(gate)}`
                    : null}
                </span>
              </span>
              <ProductStatusBadge status={p.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

async function Health({ brand }: { brand: BrandDTO }) {
  const { ctx } = await getPageContext();
  const data = await listConnections(ctx, brand.id);
  const groups: { label: string; items: { health: ConnectionHealth }[] }[] = [
    { label: "Shopify", items: data.shopify },
    { label: "TikTok Ads", items: data.tiktokAds },
    { label: "TikTok profiles", items: data.tiktokProfiles },
  ];
  const rank: Record<ConnectionHealth, number> = { green: 0, orange: 1, red: 2 };
  return (
    <ul className="grid gap-2 sm:grid-cols-3" aria-label="Connection health">
      {groups.map((g) => {
        const worst = g.items.reduce<ConnectionHealth | null>(
          (acc, c) => (acc === null || rank[c.health] > rank[acc] ? c.health : acc),
          null,
        );
        return (
          <li
            key={g.label}
            className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background p-3"
          >
            <span className="text-sm">
              {g.label}
              <span className="ml-1 text-xs text-muted-foreground">({g.items.length})</span>
            </span>
            {worst ? (
              <HealthBadge health={worst} />
            ) : (
              <span className="text-xs text-muted-foreground">Not connected</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
