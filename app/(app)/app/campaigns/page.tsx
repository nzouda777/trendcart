import { ChevronRightIcon, MegaphoneIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { Pill } from "@/components/app/badges";
import { PresetPanel } from "@/components/app/campaign-presets/preset-panel";
import { CampaignRowActions } from "@/components/app/campaigns/campaign-row-actions";
import { selectClass } from "@/components/app/form-controls";
import { formatDate, formatMoney, formatNumber } from "@/components/app/format";
import type { StatusTone } from "@/components/app/product-status";
import { ListSkeleton, PageSkeleton, Section } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import {
  CAMPAIGN_LIST_FILTERS,
  listCampaignPresets,
  listWorkspaceCampaigns,
  type CampaignListFilter,
  type CampaignListItemDTO,
} from "@/lib/services";
import type { BrandDTO } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import { getPageContext } from "../_lib/page-context";
import {
  createPresetAction,
  deletePresetAction,
  setDefaultPresetAction,
  updatePresetAction,
} from "../brands/preset-actions";
import {
  duplicateCampaignAction,
  launchDuplicateAction,
  pauseCampaignAction,
  pauseDuplicateAction,
  resumeCampaignAction,
  updateCampaignBudgetAction,
  updateDuplicateBudgetAction,
} from "../products/[id]/campaign-actions";

export const metadata: Metadata = { title: "Campaigns" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Tab = "campaigns" | "settings";

const FILTER_LABELS: Record<CampaignListFilter, string> = {
  all: "All",
  active: "Active",
  paused: "Paused",
  to_launch: "To launch",
  failed: "Failed",
};

const STATUS: Record<CampaignListItemDTO["status"], { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  creating: { label: "Creating on TikTok", tone: "running" },
  paused: { label: "Paused", tone: "action" },
  active: { label: "Active", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function hrefWith(q: { tab: Tab; brand: string; filter: CampaignListFilter }) {
  const p = new URLSearchParams();
  if (q.tab !== "campaigns") p.set("tab", q.tab);
  if (q.brand) p.set("brand", q.brand);
  if (q.tab === "campaigns" && q.filter !== "all") p.set("filter", q.filter);
  const qs = p.toString();
  return qs ? `/app/campaigns?${qs}` : "/app/campaigns";
}

// Session reads stay behind Suspense so the route keeps a static shell.
export default function CampaignsPage(props: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CampaignsContent {...props} />
    </Suspense>
  );
}

async function CampaignsContent({ searchParams }: { searchParams: SearchParams }) {
  const [params, { role, brands, activeBrand }] = await Promise.all([
    searchParams,
    getPageContext(),
  ]);
  const tab: Tab = one(params.tab) === "settings" ? "settings" : "campaigns";
  const rawBrand = one(params.brand);
  const validBrand = brands.some((b) => b.id === rawBrand);
  // Settings are per brand: never "all" there.
  const brand =
    tab === "settings"
      ? validBrand
        ? rawBrand!
        : (activeBrand?.id ?? brands[0]?.id ?? "")
      : rawBrand === "all" || validBrand
        ? rawBrand!
        : (activeBrand?.id ?? "all");
  const rawFilter = one(params.filter) ?? "all";
  const filter: CampaignListFilter = (CAMPAIGN_LIST_FILTERS as readonly string[]).includes(
    rawFilter,
  )
    ? (rawFilter as CampaignListFilter)
    : "all";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Campaigns"
        description="Every TikTok campaign of the workspace, its duplicates, and the saved campaign settings of each brand."
      />

      <nav aria-label="Campaign sections" className="flex gap-1 border-b border-border">
        {(
          [
            ["campaigns", "Campaigns"],
            ["settings", "Campaign settings"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={hrefWith({
              tab: key,
              brand: key === "settings" && brand === "all" ? "" : brand,
              filter,
            })}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm transition-colors",
              tab === key
                ? "border-brand font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {brands.length === 0 ? (
        <EmptyState
          icon={MegaphoneIcon}
          title="No brand yet"
          description="Create a brand and connect a TikTok Ads account to prepare campaigns."
          action={
            <Button asChild size="lg">
              <Link href="/app/brands">Go to Brands</Link>
            </Button>
          }
        />
      ) : tab === "settings" ? (
        <>
          <BrandFilter brands={brands} value={brand} tab={tab} filter={filter} allowAll={false} />
          <Suspense key={`settings:${brand}`} fallback={<ListSkeleton rows={4} />}>
            <SettingsTab brand={brands.find((b) => b.id === brand) ?? brands[0]!} role={role} />
          </Suspense>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav aria-label="Filter by status" className="-mx-1 overflow-x-auto px-1">
              <ul className="flex gap-1">
                {CAMPAIGN_LIST_FILTERS.map((key) => (
                  <li key={key}>
                    <Link
                      href={hrefWith({ tab, brand, filter: key })}
                      aria-current={filter === key ? "page" : undefined}
                      className={cn(
                        "inline-flex h-8 items-center rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
                        filter === key
                          ? "bg-brand-soft font-medium text-foreground"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {FILTER_LABELS[key]}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {brands.length > 1 ? (
              <BrandFilter brands={brands} value={brand} tab={tab} filter={filter} allowAll />
            ) : null}
          </div>
          <Suspense key={`${brand}:${filter}`} fallback={<ListSkeleton rows={5} />}>
            <CampaignList brand={brand} filter={filter} brands={brands} role={role} />
          </Suspense>
        </>
      )}
    </div>
  );
}

function BrandFilter({
  brands,
  value,
  tab,
  filter,
  allowAll,
}: {
  brands: BrandDTO[];
  value: string;
  tab: Tab;
  filter: CampaignListFilter;
  allowAll: boolean;
}) {
  return (
    <form method="get" action="/app/campaigns" className="flex items-center gap-2">
      {tab !== "campaigns" ? <input type="hidden" name="tab" value={tab} /> : null}
      {tab === "campaigns" && filter !== "all" ? (
        <input type="hidden" name="filter" value={filter} />
      ) : null}
      <label htmlFor="campaign-brand-filter" className="text-sm text-muted-foreground">
        Brand
      </label>
      <select
        id="campaign-brand-filter"
        name="brand"
        defaultValue={value}
        className={cn(selectClass, "h-8 w-48")}
      >
        {allowAll ? <option value="all">All brands</option> : null}
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

async function CampaignList({
  brand,
  filter,
  brands,
  role,
}: {
  brand: string;
  filter: CampaignListFilter;
  brands: BrandDTO[];
  role: Parameters<typeof can>[0];
}) {
  const { ctx } = await getPageContext();
  const items = await listWorkspaceCampaigns(ctx, {
    brandId: brand === "all" ? undefined : brand,
    filter,
  });

  if (items.length === 0) {
    return (
      <EmptyState
        icon={MegaphoneIcon}
        title={filter === "all" ? "No campaigns yet" : "No campaigns match this filter"}
        description={
          filter === "all"
            ? "A paused campaign is prepared after a product's videos are approved (GATE 3)."
            : "Try another status or brand."
        }
        action={
          filter === "all" ? (
            <Button asChild variant="outline" size="lg">
              <Link href="/app/products">Go to Products</Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="lg">
              <Link href={hrefWith({ tab: "campaigns", brand, filter: "all" })}>Show all</Link>
            </Button>
          )
        }
      />
    );
  }

  // Duplicate presets of each brand that has a campaign in the list.
  const brandIds = [...new Set(items.map((i) => i.brandId))];
  const presetsByBrand = new Map(
    await Promise.all(
      brandIds.map(
        async (id) =>
          [
            id,
            (await listCampaignPresets(ctx, { brandId: id, kind: "duplicate" })).map((x) => ({
              id: x.id,
              name: x.name,
              isDefault: x.isDefault,
            })),
          ] as const,
      ),
    ),
  );
  const rights = {
    launch: can(role, "campaign:launch"),
    pause: can(role, "campaign:pause"),
    budget: can(role, "campaign:budget"),
    duplicate: can(role, "campaign:create"),
  };

  // 72 h totals per currency (never summed across currencies).
  const byCurrency = new Map<string, { spend: number; revenue: number }>();
  for (const i of items) {
    if (!i.currency) continue;
    const t = byCurrency.get(i.currency) ?? { spend: 0, revenue: 0 };
    t.spend += i.totals.spend;
    t.revenue += i.totals.revenue;
    byCurrency.set(i.currency, t);
  }
  const counts = {
    active: items.filter((i) => i.status === "active").length,
    paused: items.filter((i) => i.status === "paused").length,
    duplicates: items.filter((i) => i.kind === "duplicate").length,
  };

  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Campaigns", formatNumber(items.length)],
          ["Active", formatNumber(counts.active)],
          ["Paused", formatNumber(counts.paused)],
          ["Duplicates", formatNumber(counts.duplicates)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {byCurrency.size > 0 ? (
        <p className="text-sm text-muted-foreground">
          Last 72 hours:{" "}
          {[...byCurrency.entries()]
            .map(
              ([cur, t]) =>
                `${formatMoney(Math.round(t.spend * 100) / 100, cur)} spent, ${formatMoney(Math.round(t.revenue * 100) / 100, cur)} revenue`,
            )
            .join(" · ")}
        </p>
      ) : null}

      <ul className="grid gap-3" aria-label={`Campaigns, ${items.length} shown`}>
        {items.map((i) => (
          <CampaignItem
            key={i.id}
            i={i}
            multiBrand={brands.length > 1}
            presets={presetsByBrand.get(i.brandId) ?? []}
            rights={rights}
          />
        ))}
      </ul>
    </div>
  );
}

function CampaignItem({
  i,
  multiBrand,
  presets,
  rights,
}: {
  i: CampaignListItemDTO;
  multiBrand: boolean;
  presets: { id: string; name: string; isDefault: boolean }[];
  rights: { launch: boolean; pause: boolean; budget: boolean; duplicate: boolean };
}) {
  const status = STATUS[i.status];
  const b = i.budget;
  const money = (n: number) => (i.currency ? formatMoney(n, i.currency) : String(n));
  const main = i.kind === "main";
  return (
    <li className="grid gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{i.name}</span>
            <Pill tone={status.tone}>{status.label}</Pill>
            {i.spendingUnknown ? <Pill tone="danger">May be spending</Pill> : null}
            <Pill tone="neutral">{main ? "Test campaign" : "Duplicate"}</Pill>
          </p>
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/app/products/${i.productId}`}
              className="inline-flex items-center gap-0.5 text-foreground underline-offset-4 hover:underline"
            >
              {i.productName ?? "Unidentified product"}
              <ChevronRightIcon aria-hidden="true" className="size-3" />
            </Link>
            {multiBrand && i.brandName ? ` · ${i.brandName}` : ""}
            {i.advertiserName ? ` · ${i.advertiserName}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {i.presetName ?? "Built-in settings"} · {money(b.amount)}{" "}
            {b.mode === "daily" ? "per day" : "in total"},{" "}
            {b.level === "campaign" ? "campaign budget" : "each ad group"} · {i.adGroupCount} ad
            group{i.adGroupCount === 1 ? "" : "s"} ·{" "}
            {i.launchedAt
              ? `launched ${formatDate(i.launchedAt)}`
              : `created ${formatDate(i.createdAt)}`}
          </p>
        </div>
        <CampaignRowActions
          kind={i.kind}
          productId={i.productId}
          status={i.status}
          launched={!!i.launchedAt}
          spendingUnknown={i.spendingUnknown}
          readyToLaunch={i.productStatus === "ready_to_launch"}
          canDuplicateSource={!!i.launchedAt && i.onTikTok}
          advertiser={i.advertiserName ?? "the TikTok Ads account"}
          currency={i.currency}
          budget={b}
          adGroupCount={i.adGroupCount}
          minBudget={i.minBudget}
          maxBudget={i.maxBudget}
          budgetUpdatable={i.budgetUpdatable}
          presets={presets}
          can={rights}
          onPause={
            main
              ? pauseCampaignAction.bind(null, i.productId)
              : pauseDuplicateAction.bind(null, i.id)
          }
          onResume={
            main
              ? resumeCampaignAction.bind(null, i.productId)
              : launchDuplicateAction.bind(null, i.id)
          }
          onBudget={
            main
              ? updateCampaignBudgetAction.bind(null, i.productId)
              : updateDuplicateBudgetAction.bind(null, i.id)
          }
          onDuplicate={duplicateCampaignAction.bind(null, i.id)}
        />
      </div>
      {i.launchedAt ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ["Spend (72 h)", money(i.totals.spend)],
            ["Impressions", formatNumber(i.totals.impressions)],
            ["Clicks", formatNumber(i.totals.clicks)],
            ["Conversions", formatNumber(i.totals.conversions)],
            ["ROAS", i.totals.roas === null ? "–" : String(i.totals.roas)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

async function SettingsTab({ brand, role }: { brand: BrandDTO; role: Parameters<typeof can>[0] }) {
  const { ctx } = await getPageContext();
  return (
    <Section
      id="campaign-settings"
      title={`Campaign settings of ${brand.name}`}
      description="Named setups for brand new test campaigns and for campaign duplicates. The default one of each kind is preselected."
    >
      <PresetPanel
        brandCurrency={brand.currency}
        brandCountry={brand.country}
        defaultTestBudget={brand.defaultTestBudget}
        presets={await listCampaignPresets(ctx, { brandId: brand.id })}
        canEdit={can(role, "campaign:update")}
        onCreate={createPresetAction.bind(null, brand.id)}
        onUpdate={updatePresetAction}
        onDelete={deletePresetAction}
        onSetDefault={setDefaultPresetAction}
      />
    </Section>
  );
}
