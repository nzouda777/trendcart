import { ChevronLeftIcon, ChevronRightIcon, PackageIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { ProductStatusBadge } from "@/components/app/badges";
import { selectClass } from "@/components/app/form-controls";
import { formatDate, formatMoney, hostOf } from "@/components/app/format";
import { GATE_META, STEP_LABELS } from "@/components/app/product-status";
import { ProductThumb } from "@/components/app/product-thumb";
import { ListSkeleton, PageSkeleton } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import type { ProductStatus } from "@/lib/domain/contracts";
import { listProducts } from "@/lib/services";
import type { BrandDTO } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import { getPageContext } from "../_lib/page-context";

export const metadata: Metadata = { title: "Products" };

const PAGE_SIZE = 20;

const FILTERS = {
  all: { label: "All", statuses: undefined },
  action: {
    label: "Needs action",
    statuses: [
      "awaiting_product_confirmation",
      "awaiting_supplier_choice",
      "awaiting_content_approval",
      "ready_to_launch",
    ],
  },
  running: {
    label: "In progress",
    statuses: [
      "imported",
      "analyzing",
      "sourcing",
      "building_page_and_videos",
      "preparing_campaign",
    ],
  },
  failed: { label: "Failed", statuses: ["failed"] },
  launched: { label: "Launched", statuses: ["launched"] },
} satisfies Record<string, { label: string; statuses: ProductStatus[] | undefined }>;

type FilterKey = keyof typeof FILTERS;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function hrefWith(base: { brand: string; status: FilterKey; page: number }) {
  const p = new URLSearchParams();
  if (base.brand) p.set("brand", base.brand);
  if (base.status !== "all") p.set("status", base.status);
  if (base.page > 1) p.set("page", String(base.page));
  const qs = p.toString();
  return qs ? `/app/products?${qs}` : "/app/products";
}

// Session reads stay behind Suspense so the route keeps a static shell.
export default function ProductsPage(props: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProductsContent {...props} />
    </Suspense>
  );
}

async function ProductsContent({ searchParams }: { searchParams: SearchParams }) {
  const [params, { role, brands, activeBrand }] = await Promise.all([
    searchParams,
    getPageContext(),
  ]);

  const rawBrand = one(params.brand);
  const brand =
    rawBrand === "all" || brands.some((b) => b.id === rawBrand)
      ? rawBrand!
      : (activeBrand?.id ?? "all");
  const rawStatus = one(params.status) ?? "all";
  const status: FilterKey = rawStatus in FILTERS ? (rawStatus as FilterKey) : "all";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(params.page) ?? "1", 10) || 1));
  const canImport = can(role, "product:create");

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Products"
        description="Every imported product and where it is in the pipeline."
        actions={
          canImport && brands.length > 0 ? (
            <Button asChild size="lg">
              <Link href="/app/import">
                <PlusIcon aria-hidden="true" />
                Import
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filter by status" className="-mx-1 overflow-x-auto px-1">
          <ul className="flex gap-1">
            {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
              <li key={key}>
                <Link
                  href={hrefWith({ brand, status: key, page: 1 })}
                  aria-current={status === key ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
                    status === key
                      ? "bg-brand-soft font-medium text-foreground"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {FILTERS[key].label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {brands.length > 1 ? <BrandFilter brands={brands} value={brand} status={status} /> : null}
      </div>

      <Suspense key={`${brand}:${status}:${page}`} fallback={<ListSkeleton rows={6} />}>
        <ProductList
          brand={brand}
          status={status}
          page={page}
          brands={brands}
          canImport={canImport}
        />
      </Suspense>
    </div>
  );
}

function BrandFilter({
  brands,
  value,
  status,
}: {
  brands: BrandDTO[];
  value: string;
  status: FilterKey;
}) {
  return (
    <form method="get" action="/app/products" className="flex items-center gap-2">
      {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
      <label htmlFor="brand-filter" className="text-sm text-muted-foreground">
        Brand
      </label>
      <select
        id="brand-filter"
        name="brand"
        defaultValue={value}
        className={cn(selectClass, "h-8 w-48")}
      >
        <option value="all">All brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="lg" className="h-8">
        Apply
      </Button>
    </form>
  );
}

async function ProductList({
  brand,
  status,
  page,
  brands,
  canImport,
}: {
  brand: string;
  status: FilterKey;
  page: number;
  brands: BrandDTO[];
  canImport: boolean;
}) {
  const { ctx } = await getPageContext();
  const { items, total } = await listProducts(ctx, {
    brandId: brand === "all" ? undefined : brand,
    status: FILTERS[status].statuses,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (items.length === 0) {
    const filtered = status !== "all" || page > 1;
    return (
      <EmptyState
        icon={PackageIcon}
        title={filtered ? "No products match this filter" : "No products yet"}
        description={
          filtered
            ? "Try another status or brand."
            : "Import a TikTok video or a product link to get started."
        }
        action={
          filtered ? (
            <Button asChild variant="outline" size="lg">
              <Link href={hrefWith({ brand, status: "all", page: 1 })}>Show all</Link>
            </Button>
          ) : canImport && brands.length > 0 ? (
            <Button asChild size="lg">
              <Link href="/app/import">Import a product</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2" aria-label={`Products, ${total} total`}>
        {items.map((p) => {
          const b = brandById.get(p.brandId);
          return (
            <li key={p.id}>
              <Link
                href={`/app/products/${p.id}`}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition-colors outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring sm:gap-4"
              >
                <ProductThumb src={p.thumbnailUrl} className="size-12 sm:size-14" />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="truncate font-medium">{p.name ?? "Unidentified product"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.sourceType === "tiktok_video" ? "TikTok" : hostOf(p.sourceUrl)}
                    {b && brands.length > 1 ? ` · ${b.name}` : ""} · {formatDate(p.createdAt)}
                  </span>
                  {p.gate ? (
                    <span className="text-xs text-warning sm:hidden">
                      Gate {GATE_META[p.gate].number}: {GATE_META[p.gate].action}
                    </span>
                  ) : null}
                </span>
                <span className="hidden text-right text-sm tabular-nums md:block">
                  {p.sellingPrice !== null && b ? formatMoney(p.sellingPrice, b.currency) : null}
                </span>
                <span className="grid shrink-0 justify-items-end gap-0.5">
                  <ProductStatusBadge status={p.status} />
                  {p.status === "failed" && p.failedStep ? (
                    <span className="text-xs text-danger">
                      {STEP_LABELS[p.failedStep] ?? p.failedStep}
                    </span>
                  ) : null}
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Button asChild variant="outline" size="lg">
              <Link href={hrefWith({ brand, status, page: page - 1 })}>
                <ChevronLeftIcon aria-hidden="true" />
                Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="outline" size="lg">
              <Link href={hrefWith({ brand, status, page: page + 1 })}>
                Next
                <ChevronRightIcon aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
