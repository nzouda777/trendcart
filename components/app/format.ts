/*
 * Formatting helpers. Deterministic (fixed locale, UTC) so a value formatted
 * on the server and on the client is identical (no hydration mismatch).
 */

const LOCALE = "en-US";

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatUsd(amount: number, digits = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 2),
  }).format(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

/** 0..1 → "32%". */
export function formatPercent(rate: number | null | undefined, digits = 0): string {
  if (rate === null || rate === undefined) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(rate);
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "—";
}

/** "Oct 25, 2026, 14:03 UTC". */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? `${dateTimeFmt.format(new Date(iso))} UTC` : "—";
}

/** "2026-10" → "October 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Host of a URL for compact display ("www.tiktok.com"). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * "just now", "3 minutes ago", "2 hours ago", "1 day ago" relative to `nowMs`.
 * Pass the clock explicitly and call it on the server (or in a client effect):
 * a value that depends on the current time must not be computed during a
 * client render, or the hydrated text would not match the server's.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
