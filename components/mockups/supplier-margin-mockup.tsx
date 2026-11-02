"use client";

import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { computeMargin, demoProduct, formatMoney, supplierMatches } from "./data";
import { MockupFrame } from "./mockup-frame";
import { FakeButton, PanelLabel, ProductPhoto } from "./primitives";
import { StatusBadge } from "./status";
import { useAnimatedNumber, useCycle, useMockupMotion } from "./use-mockup-motion";

const rows = supplierMatches.map((s) => ({
  ...s,
  margin: computeMargin(demoProduct.price, s.cost, s.shipping),
}));
const bestId = rows.reduce((best, r) => (r.margin.marginPct > best.margin.marginPct ? r : best)).id;

export type SupplierMarginMockupProps = { className?: string };

/** Supplier matches table + live margin calculator (values computed from data). */
export function SupplierMarginMockup({ className }: SupplierMarginMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduced } = useMockupMotion(ref);
  const [cycled] = useCycle(rows.length, 3200, active);
  const selected = reduced ? 0 : cycled;
  const m = rows[selected].margin;

  const cost = useAnimatedNumber(m.cost, active);
  const shipping = useAnimatedNumber(m.shipping, active);
  const fees = useAnimatedNumber(m.fees, active);
  const profit = useAnimatedNumber(m.profit, active);
  const pct = useAnimatedNumber(m.marginPct, active);

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title="Source"
        label={`Supplier matches for ${demoProduct.name} with cost and shipping, and a margin calculator: selling price ${formatMoney(m.price)}, cost ${formatMoney(m.cost)}, shipping ${formatMoney(m.shipping)}, fees ${formatMoney(m.fees)}, margin ${m.marginPct.toFixed(1)}%.`}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <PanelLabel>Supplier matches · {rows.length}</PanelLabel>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {demoProduct.name}
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.25rem] gap-2 bg-surface-2/70 px-2.5 py-1.5 text-[10px] text-muted-foreground sm:grid-cols-[minmax(0,1fr)_4rem_4rem_4rem_3.5rem]">
              <span>Supplier</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Ship</span>
              <span className="hidden text-right sm:block">Delivery</span>
              <span className="text-right">Margin</span>
            </div>
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={cn(
                  "relative grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.25rem] items-center gap-2 border-t border-border px-2.5 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_4rem_4rem_4rem_3.5rem] sm:text-xs",
                )}
              >
                {i === selected ? (
                  <motion.span
                    layoutId={active ? "supplier-row" : undefined}
                    className="absolute inset-0 bg-brand-soft ring-1 ring-brand-border ring-inset"
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  />
                ) : null}
                <span className="relative flex min-w-0 items-center gap-1.5">
                  <ProductPhoto
                    photo={r.image}
                    alt=""
                    sizes="28px"
                    className="size-6 shrink-0 rounded-sm sm:size-7"
                  />
                  <span className="truncate">{r.name}</span>
                  {r.id === bestId ? (
                    <StatusBadge
                      tone="success"
                      dot={false}
                      className="hidden px-1.5 sm:inline-flex"
                    >
                      Best
                    </StatusBadge>
                  ) : null}
                </span>
                <span className="relative text-right font-mono">{formatMoney(r.cost)}</span>
                <span className="relative text-right font-mono">{formatMoney(r.shipping)}</span>
                <span className="relative hidden text-right font-mono text-muted-foreground sm:block">
                  {r.shipDays}
                </span>
                <span className="relative text-right font-mono text-brand-text">
                  {r.margin.marginPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-surface-2/50 p-2.5 sm:p-3">
            <PanelLabel>Margin calculator</PanelLabel>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4 sm:text-xs">
              <Field label="Selling price" value={formatMoney(m.price)} />
              <Field label="Cost" value={formatMoney(cost)} />
              <Field label="Shipping" value={formatMoney(shipping)} />
              <Field label="Fees (2.9% + $0.30)" value={formatMoney(fees)} />
            </div>
            <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-2.5">
              <div>
                <p className="text-[10px] text-muted-foreground">Profit / order</p>
                <p className="font-mono text-sm font-semibold">{formatMoney(profit)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Margin</p>
                <p className="font-mono text-lg leading-6 font-semibold text-brand-text">
                  {pct.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <FakeButton variant="primary">Choose supplier &amp; price</FakeButton>
          </div>
        </div>
      </MockupFrame>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono">{value}</p>
    </div>
  );
}
