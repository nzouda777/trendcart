import { z } from "zod";

import { IntegrationError, type HourlyStat } from "@/lib/domain/contracts";

import { TIKTOK_ADS_PROVIDER } from "./config";

/*
 * Hourly reporting (report/integrated/get, report_type BASIC,
 * data_level AUCTION_CAMPAIGN, dimensions campaign_id + stat_time_hour).
 *
 * TikTok reports hours in the ADVERTISER's time zone ("YYYY-MM-DD HH:00:00")
 * and an hourly query covers one day (start_date = end_date). We therefore:
 * 1. turn the UTC [from, to) window into the advertiser-local dates it spans,
 * 2. query each date (paginated),
 * 3. convert every stat_time_hour back to UTC and floor it to the UTC hour
 *    (sums the two halves in :30 zones),
 * 4. return exactly one HourlyStat per UTC hour in the window, zeros where
 *    TikTok has no row (same shape as the mock).
 */

export const HOUR_MS = 3_600_000;
/** Same cap as the mock: one month of hours per call. */
export const MAX_HOURS = 24 * 31;

export const REPORT_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "conversion",
  // Purchase value (named "rate" by TikTok) and ROAS as a fallback for it.
  "total_complete_payment_rate",
  "complete_payment_roas",
] as const;

export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(tz: string, t: number) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    s: Number(parts.second),
  };
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
export function tzOffsetMs(tz: string, t: number): number {
  const w = wallClock(tz, t);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000;
}

/** Advertiser-local date (YYYY-MM-DD) of a UTC instant. */
export function localDate(tz: string, t: number): string {
  const w = wallClock(tz, t);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** "YYYY-MM-DD HH:MM:SS" wall time in `tz` → UTC epoch ms. */
export function localToUtc(tz: string, wall: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(wall);
  if (!m) {
    throw new IntegrationError(TIKTOK_ADS_PROVIDER, "provider_error", `Bad report hour "${wall}".`);
  }
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Two passes settle DST transitions.
  let t = asUtc - tzOffsetMs(tz, asUtc);
  t = asUtc - tzOffsetMs(tz, t);
  return t;
}

/** Local dates covering the UTC hours [start, end). */
export function localDatesFor(tz: string, start: number, end: number): string[] {
  const dates: string[] = [];
  for (let t = start; t < end; t += HOUR_MS) {
    const d = localDate(tz, t);
    if (dates[dates.length - 1] !== d) dates.push(d);
  }
  return dates;
}

const metricNumber = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
    return Number.isFinite(n) ? n : 0;
  });

export const reportRowSchema = z.object({
  dimensions: z.object({
    campaign_id: z.union([z.string(), z.number()]).transform(String).optional(),
    stat_time_hour: z.string(),
  }),
  metrics: z.object({
    spend: metricNumber,
    impressions: metricNumber,
    clicks: metricNumber,
    conversion: metricNumber,
    total_complete_payment_rate: metricNumber,
    complete_payment_roas: metricNumber,
  }),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportDataSchema = z.object({
  list: z.array(reportRowSchema).default([]),
  page_info: z
    .object({ page: z.number().optional(), total_page: z.number().optional() })
    .optional(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Folds report rows into one HourlyStat per UTC hour of [start, end). */
export function foldHourlyStats(
  tz: string,
  rows: ReportRow[],
  start: number,
  end: number,
): HourlyStat[] {
  const acc = new Map<number, { spend: number; imp: number; clk: number; conv: number; rev: number }>();
  for (const r of rows) {
    const t = Math.floor(localToUtc(tz, r.dimensions.stat_time_hour) / HOUR_MS) * HOUR_MS;
    if (t < start || t >= end) continue;
    const m = r.metrics;
    const revenue = m.total_complete_payment_rate > 0 ? m.total_complete_payment_rate : m.spend * m.complete_payment_roas;
    const a = acc.get(t) ?? { spend: 0, imp: 0, clk: 0, conv: 0, rev: 0 };
    a.spend += m.spend;
    a.imp += m.impressions;
    a.clk += m.clicks;
    a.conv += m.conversion;
    a.rev += revenue;
    acc.set(t, a);
  }
  const stats: HourlyStat[] = [];
  for (let t = start; t < end && stats.length < MAX_HOURS; t += HOUR_MS) {
    const a = acc.get(t);
    stats.push({
      hour: new Date(t).toISOString(),
      spend: round2(Math.max(0, a?.spend ?? 0)),
      impressions: Math.max(0, Math.round(a?.imp ?? 0)),
      clicks: Math.max(0, Math.round(a?.clk ?? 0)),
      conversions: Math.max(0, Math.round(a?.conv ?? 0)),
      revenue: round2(Math.max(0, a?.rev ?? 0)),
    });
  }
  return stats;
}

/** Validates the window like the mock does; returns hour-floored [start, end). */
export function statsWindow(from: string, to: string): { start: number; end: number } {
  const start = Math.floor(Date.parse(from) / HOUR_MS) * HOUR_MS;
  const end = Date.parse(to);
  if (end < start) {
    throw new IntegrationError(TIKTOK_ADS_PROVIDER, "invalid_input", "`to` is before `from`.");
  }
  return { start, end: Math.min(end, start + MAX_HOURS * HOUR_MS) };
}
