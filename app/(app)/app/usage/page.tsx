import { GaugeIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { formatMonth, formatNumber, formatUsd } from "@/components/app/format";
import { PageSkeleton, Section } from "@/components/app/surface";
import { can } from "@/lib/auth/permissions";
import { getUsage, listUsage } from "@/lib/services";
import type { UsageDTO } from "@/lib/services/types";

import { getPageContext } from "../_lib/page-context";

export const metadata: Metadata = { title: "Usage" };

// Session reads stay behind Suspense so the route keeps a static shell.
export default function UsagePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

async function UsageContent() {
  const { role } = await getPageContext();
  if (!can(role, "usage:read")) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Usage" />
        <EmptyState
          icon={LockIcon}
          title="Usage is visible to media buyers and owners"
          description="Ask a workspace owner if you need these numbers."
        />
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Usage"
        description="AI cost and paid API calls for this workspace, per calendar month (UTC)."
      />
      <Suspense fallback={<PageSkeleton panels={2} />}>
        <UsageData />
      </Suspense>
    </div>
  );
}

async function UsageData() {
  const { ctx } = await getPageContext();
  const [current, history] = await Promise.all([getUsage(ctx), listUsage(ctx, 12)]);
  // Oldest → newest for the chart; include the current month even when empty.
  const months = [...history].reverse();
  if (!months.some((m) => m.month === current.month)) months.push(current);

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Tile
          label={`AI cost, ${formatMonth(current.month)}`}
          value={formatUsd(current.aiCostUsd)}
        />
        <Tile
          label={`Paid API calls, ${formatMonth(current.month)}`}
          value={formatNumber(current.apiCalls)}
        />
      </dl>

      <Section
        id="ai-cost"
        title="AI cost per month"
        description="Claude, ChatGPT, Gemini and Perplexity calls made while preparing products."
      >
        {months.every((m) => m.aiCostUsd === 0 && m.apiCalls === 0) ? (
          <EmptyState
            as="h3"
            icon={GaugeIcon}
            title="No usage yet"
            description="Costs appear here once products are analyzed."
            className="py-8"
          />
        ) : (
          <div className="grid gap-6">
            <CostChart months={months} />
            <UsageTable months={[...months].reverse()} />
          </div>
        )}
      </Section>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

/** Single-series bar chart (brand hue). Hover or focus a bar for its value; the table is the text view. */
function CostChart({ months }: { months: UsageDTO[] }) {
  const max = Math.max(...months.map((m) => m.aiCostUsd), 0.01);
  return (
    <figure className="grid gap-2">
      <figcaption className="sr-only">
        AI cost per month, bar chart. The same data is in the table below.
      </figcaption>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>USD</span>
        <span className="tabular-nums">max {formatUsd(max)}</span>
      </div>
      <div
        aria-hidden="true"
        className="relative flex h-48 items-end gap-0.5 border-b border-border-strong"
      >
        {months.map((m) => {
          const pct = (m.aiCostUsd / max) * 100;
          return (
            <div
              key={m.month}
              className="group relative flex h-full flex-1 items-end justify-center"
            >
              <div
                className="w-full max-w-10 rounded-t bg-brand transition-opacity group-hover:opacity-80 motion-reduce:transition-none"
                style={{ height: `${Math.max(pct, m.aiCostUsd > 0 ? 1.5 : 0)}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow group-hover:block">
                <span className="text-muted-foreground">{formatMonth(m.month)}</span>{" "}
                <span className="tabular-nums">{formatUsd(m.aiCostUsd)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex gap-0.5 text-[0.7rem] text-muted-foreground">
        {months.map((m, i) => (
          <span key={m.month} className="flex-1 truncate text-center">
            {/* Label every other month on narrow screens to avoid collisions. */}
            <span className={i % 2 === months.length % 2 ? "" : "hidden sm:inline"}>
              {formatMonth(m.month).slice(0, 3)}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function UsageTable({ months }: { months: UsageDTO[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left text-xs text-muted-foreground">
          Monthly breakdown
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              Month
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              AI cost
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Paid API calls
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {formatMonth(m.month)}
              </th>
              <td className="py-2 pr-4 text-right tabular-nums">{formatUsd(m.aiCostUsd)}</td>
              <td className="py-2 text-right tabular-nums">{formatNumber(m.apiCalls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
