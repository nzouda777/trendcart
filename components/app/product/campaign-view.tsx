import { BarChart3Icon } from "lucide-react";

import type { CampaignDTO, CampaignStatus } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import { Pill } from "../badges";
import { formatDateTime, formatMoney, formatNumber, formatPercent } from "../format";
import type { StatusTone } from "../product-status";
import { DetailList } from "../surface";

/*
 * Read-only campaign views (server-safe): the summary of the spec sent to
 * TikTok, and the hourly results. Every figure comes from the CampaignDTO.
 */

type Spec = CampaignDTO["config"];

const OBJECTIVE_LABEL: Record<Spec["objective"], string> = {
  WEB_CONVERSIONS: "Website conversions",
  TRAFFIC: "Traffic",
};

const BID_LABEL = { lowest_cost: "Lowest cost", cost_cap: "Cost cap" } as const;
const GENDER_LABEL = { all: "All genders", male: "Male", female: "Female" } as const;

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  creating: { label: "Creating on TikTok", tone: "running" },
  paused: { label: "Paused", tone: "action" },
  active: { label: "Active", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  const meta = CAMPAIGN_STATUS_META[status];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

export function campaignCounts(spec: Spec) {
  const adGroups = spec.adGroups.length;
  const ads = spec.adGroups.reduce((n, g) => n + g.ads.length, 0);
  const countries = [...new Set(spec.adGroups.flatMap((g) => g.countries))];
  return { adGroups, ads, countries };
}

/** "€20.00 per day per ad group" (from the spec, in the brand currency). */
export function budgetLabel(spec: Spec, currency: string): string {
  const per = spec.budget.mode === "daily" ? " per day" : " in total";
  const level = spec.budget.level === "ad_group" ? " per ad group" : "";
  return `${formatMoney(spec.budget.amount, currency)}${per}${level}`;
}

/** Highest spend the budget allows (per day for a daily budget). */
export function budgetCeiling(spec: Spec, currency: string): string {
  const n = spec.budget.level === "ad_group" ? spec.adGroups.length : 1;
  const per = spec.budget.mode === "daily" ? " per day" : " in total";
  return `${formatMoney(spec.budget.amount * n, currency)}${per}`;
}

/**
 * Campaign → ad groups → ads, with the budget, targeting and ad texts. Every
 * entity shows the campaign's state (paused until GATE 4).
 */
export function CampaignSummary({
  campaign,
  currency,
}: {
  campaign: CampaignDTO;
  currency: string;
}) {
  const spec = campaign.config;
  const { adGroups, ads, countries } = campaignCounts(spec);
  const entityStatus: CampaignStatus = campaign.status === "active" ? "active" : "paused";
  return (
    <div className="grid gap-5">
      <DetailList
        className="sm:grid-cols-3"
        items={[
          { label: "Campaign", value: spec.name },
          { label: "Objective", value: OBJECTIVE_LABEL[spec.objective] },
          { label: "Budget", value: budgetLabel(spec, currency) },
          {
            label: "Ad account",
            value: campaign.advertiserName
              ? `${campaign.advertiserName}${campaign.advertiserId ? ` (${campaign.advertiserId})` : ""}`
              : "Disconnected account",
          },
          { label: "Countries", value: countries.join(", ") || "—" },
          {
            label: "Structure",
            value: `${adGroups} ad group${adGroups === 1 ? "" : "s"}, ${ads} ad${ads === 1 ? "" : "s"}`,
          },
          {
            label: "Landing page",
            value: <span className="font-mono text-xs break-all">{spec.landingPageUrl}</span>,
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        Amounts are shown in {currency}, the brand currency. TikTok charges in the ad
        account&rsquo;s currency.
      </p>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {spec.name}
          <CampaignStatusPill status={entityStatus} />
        </div>
        <ul className="grid gap-3 border-l border-border pl-4" aria-label="Ad groups">
          {spec.adGroups.map((g) => (
            <li key={g.name} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{g.name}</span>
                <CampaignStatusPill status={entityStatus} />
              </div>
              <p className="text-xs text-muted-foreground">
                {g.countries.join(", ")} · {GENDER_LABEL[g.gender ?? "all"]}
                {g.ageGroups?.length ? ` · Ages ${g.ageGroups.join(", ")}` : ""} ·{" "}
                {BID_LABEL[g.bidStrategy]}
                {g.bidAmount ? ` ${formatMoney(g.bidAmount, currency)}` : ""}
              </p>
              <ul
                className="grid gap-2 border-l border-border pl-4"
                aria-label={`Ads of ${g.name}`}
              >
                {g.ads.map((ad) => (
                  <li
                    key={ad.name}
                    className="grid gap-1 rounded-lg border border-border bg-background p-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{ad.name}</span>
                      <CampaignStatusPill status={entityStatus} />
                    </div>
                    <p className="text-sm text-pretty">&ldquo;{ad.adText}&rdquo;</p>
                    <p className="text-muted-foreground">
                      Button: {ad.callToAction} · Identity:{" "}
                      {ad.identity.type === "custom"
                        ? ad.identity.displayName
                        : "Spark Ads (creator post)"}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const hourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function hourLabel(iso: string) {
  return `${hourFmt.format(new Date(iso))} UTC`;
}

/**
 * Results of the last 72 hours: totals, a spend-per-hour bar chart (decorative;
 * the table below carries the same data for assistive tech) and the hourly table.
 */
export function CampaignStats({
  campaign,
  currency,
  syncedLabel,
}: {
  campaign: CampaignDTO;
  currency: string;
  /** "3 minutes ago", computed on the server. */
  syncedLabel: string | null;
}) {
  const { totals, stats } = campaign;
  const money = (n: number) => formatMoney(n, currency);
  const synced = campaign.statsSyncedAt ? (
    <p className="text-xs text-muted-foreground">
      Stats synced{" "}
      <time dateTime={campaign.statsSyncedAt} title={formatDateTime(campaign.statsSyncedAt)}>
        {syncedLabel ?? formatDateTime(campaign.statsSyncedAt)}
      </time>
      . TikTok reports hourly; recent hours can still change.
    </p>
  ) : null;

  if (stats.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
          <BarChart3Icon aria-hidden="true" className="size-5 shrink-0" />
          <p>
            No stats yet. TikTok reports results by the hour; they appear here after the next hourly
            sync.
          </p>
        </div>
        {synced}
      </div>
    );
  }

  const max = Math.max(...stats.map((s) => s.spend), 0);
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Spend" value={money(totals.spend)} />
        <Tile label="Impressions" value={formatNumber(totals.impressions)} />
        <Tile label="Clicks" value={formatNumber(totals.clicks)} />
        <Tile label="CTR" value={formatPercent(totals.ctr, 2)} />
        <Tile label="Conversions" value={formatNumber(totals.conversions)} />
        <Tile label="Revenue" value={money(totals.revenue)} />
        <Tile label="ROAS" value={totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`} />
      </dl>

      <figure className="grid gap-2">
        <figcaption className="text-sm font-medium">
          Spend per hour{" "}
          <span className="font-normal text-muted-foreground">
            ({stats.length} hour{stats.length === 1 ? "" : "s"} reported, last 72 hours)
          </span>
        </figcaption>
        <div
          aria-hidden="true"
          className="flex h-40 items-end gap-0.5 border-b border-border-strong"
        >
          {stats.map((s) => (
            <div
              key={s.hour}
              title={`${hourLabel(s.hour)}: ${money(s.spend)} spend, ${formatNumber(s.clicks)} clicks, ${formatNumber(s.conversions)} conversions`}
              className="group flex h-full min-w-0 flex-1 items-end hover:bg-surface-2"
            >
              <div
                className={cn(
                  "w-full rounded-t-[4px] bg-brand group-hover:bg-brand-hover",
                  s.spend === 0 && "bg-transparent",
                )}
                style={{ height: max > 0 ? `${(s.spend / max) * 100}%` : "0%" }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">
          <span>{hourLabel(stats[0]!.hour)}</span>
          <span>Peak {money(max)}</span>
          <span>{hourLabel(stats[stats.length - 1]!.hour)}</span>
        </div>
      </figure>

      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm outline-none select-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50">
          Hourly table
        </summary>
        <div className="max-h-96 overflow-auto border-t border-border">
          <table className="w-full text-right text-xs tabular-nums">
            <caption className="sr-only">Hourly results, newest first</caption>
            <thead className="sticky top-0 bg-surface text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Hour (UTC)
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Spend
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Impr.
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Clicks
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Conv.
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {[...stats].reverse().map((s) => (
                <tr key={s.hour} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {hourLabel(s.hour)}
                  </th>
                  <td className="px-3 py-1.5">{money(s.spend)}</td>
                  <td className="px-3 py-1.5">{formatNumber(s.impressions)}</td>
                  <td className="px-3 py-1.5">{formatNumber(s.clicks)}</td>
                  <td className="px-3 py-1.5">{formatNumber(s.conversions)}</td>
                  <td className="px-3 py-1.5">{money(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {synced}
    </div>
  );
}
