"use client";

import { useId, useState } from "react";

/*
 * Single-series bar chart (brand color, no legend: the card title names the
 * series). Thin bars with 4px rounded tops on the baseline, 2px gaps, a
 * recessive grid, a hover / focus tooltip per bar (hit target = the whole
 * column), and a table view with the exact values.
 */
export function BarChart({
  data,
  label,
  unit = "count",
  height = 160,
}: {
  data: { key: string; label: string; value: number }[];
  /** Accessible name, e.g. "New users per day, last 30 days". */
  label: string;
  /** How values read (a string, not a function: this is a client component). */
  unit?: "count" | "usd";
  height?: number;
}) {
  const format = (v: number) =>
    unit === "usd"
      ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
      : v.toLocaleString("en-US");
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = [max, max / 2, 0];
  const w = 100 / Math.max(1, data.length);

  return (
    <div className="grid gap-2">
      <div className="relative" style={{ height }}>
        <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
          {ticks.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
                {format(Math.round(t * 100) / 100)}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ))}
        </div>
        <div
          role="group"
          aria-label={label}
          className="absolute inset-y-0 right-0 left-12 flex items-end"
          onMouseLeave={() => setActive(null)}
        >
          {data.map((d, i) => (
            <button
              key={d.key}
              type="button"
              aria-label={`${d.label}: ${format(d.value)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="group relative flex h-full items-end justify-center outline-none"
              style={{ width: `${w}%` }}
            >
              <span
                className="block w-[calc(100%-2px)] max-w-6 rounded-t-[4px] bg-brand transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-ring"
                style={{
                  height: `${(d.value / max) * 100}%`,
                  minHeight: d.value > 0 ? 2 : 0,
                  opacity: active === null || active === i ? 1 : 0.45,
                }}
              />
              {active === i ? (
                <span className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-md">
                  <span className="text-muted-foreground">{d.label}</span>{" "}
                  <span className="font-semibold tabular-nums">{format(d.value)}</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between pl-12 text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Show as table
        </summary>
        <table id={`${id}-table`} className="mt-2 w-full text-left">
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-border">
                <td className="py-1 text-muted-foreground">{d.label}</td>
                <td className="py-1 text-right font-medium tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
