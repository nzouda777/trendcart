import { Building2Icon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { BrandForm } from "@/components/app/brand-form";
import { Pill } from "@/components/app/badges";
import { formatMoney, formatPercent } from "@/components/app/format";
import { PageSkeleton, Section } from "@/components/app/surface";
import { can } from "@/lib/auth/permissions";

import { getPageContext } from "../_lib/page-context";
import { createBrandAction } from "./actions";

export const metadata: Metadata = { title: "Brands" };

// Session reads stay behind Suspense so the route keeps a static shell.
export default function BrandsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BrandsContent />
    </Suspense>
  );
}

async function BrandsContent() {
  const { role, brands, activeBrand } = await getPageContext();
  const canCreate = can(role, "brand:create");

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Brands"
        description="Each brand has its own Shopify store, TikTok accounts, proxy and market settings."
      />

      {brands.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="No brands yet"
          description={
            canCreate
              ? "Create a brand below to start importing products."
              : "Ask a workspace owner to add a brand."
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Brands">
          {brands.map((b) => (
            <li key={b.id}>
              <Link
                href={`/app/brands/${b.id}`}
                className="group flex h-full items-start gap-4 rounded-2xl border border-border bg-surface p-4 transition-colors outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-border bg-brand-soft font-semibold text-brand-text">
                  {b.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1 gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{b.name}</span>
                    {activeBrand?.id === b.id ? <Pill tone="success">Active</Pill> : null}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {b.country} · {b.language} · {b.currency}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Test budget {formatMoney(b.defaultTestBudget, b.currency)} · Min margin{" "}
                    {formatPercent(b.minMargin)} · Proxy{" "}
                    {b.proxy.configured ? (b.proxy.enabled ? "on" : "off") : "none"}
                  </span>
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <Section
          id="new-brand"
          title="Add a brand"
          description="The new brand becomes the active brand in the sidebar."
        >
          <BrandForm mode="create" compact onSubmit={createBrandAction.bind(null, "brands")} />
        </Section>
      ) : null}
    </div>
  );
}
