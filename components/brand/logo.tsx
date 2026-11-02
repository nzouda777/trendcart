import type { SVGProps } from "react";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * Raw logo geometry, shared with non-React consumers (favicon, apple icon,
 * OG image via `next/og`). An upward trend line that ends, arrow first,
 * inside a shopping bag. All shapes are strokes, in one solid color.
 */
export const LOGO_ICON = {
  viewBox: "0 0 32 32",
  size: 32,
  strokeWidth: 2.25,
  paths: {
    /** Bag body (slightly tapered). */
    bag: "M13 13h15l-1.2 14.2a2 2 0 0 1-2 1.8H16.2a2 2 0 0 1-2-1.8L13 13z",
    /** Bag handle. */
    handle: "M17 13v-2a4 4 0 0 1 8 0v2",
    /** Trend line, rising into the bag. */
    trend: "M3 24.5l4.5-5L11 23l8.5-8.5",
    /** Arrow head at the end of the trend line. */
    arrow: "M15.5 14.5h4v4",
  },
  /**
   * Fixed brand greens for static renders (no CSS variables there).
   * `onDark`: Shopify logo green, for black/dark backgrounds.
   * `onLight`: Shopify admin green, for white/light backgrounds.
   */
  colors: { onDark: "#95BF47", onLight: "#008060" },
} as const;

export const LOGO_ICON_PATHS = [
  LOGO_ICON.paths.bag,
  LOGO_ICON.paths.handle,
  LOGO_ICON.paths.trend,
  LOGO_ICON.paths.arrow,
] as const;

/**
 * Standalone SVG markup of the icon, for `app/icon.svg`, `ImageResponse`
 * (`<img src={\`data:image/svg+xml,${encodeURIComponent(svg)}\`} />`) etc.
 * Stroke color defaults to the on-dark brand green; pass `color` to override
 * (e.g. `LOGO_ICON.colors.onLight` or `currentColor`).
 */
export function getLogoIconSvg({
  size = LOGO_ICON.size,
  color = LOGO_ICON.colors.onDark,
}: { size?: number; color?: string } = {}): string {
  const paths = LOGO_ICON_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${LOGO_ICON.viewBox}" fill="none" stroke="${color}" stroke-width="${LOGO_ICON.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export type LogoIconVariant = "brand" | "mono";

export type LogoIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /**
   * `brand` (default): solid brand green for the current theme (`text-brand`).
   * `mono`: inherits `currentColor` (black on light, white on dark, or any
   * `text-*` class you pass).
   */
  variant?: LogoIconVariant;
  /** Accessible name. Omit for decorative use (rendered `aria-hidden`). */
  title?: string;
};

/** Trendcart icon. Default size 1.75rem; override with `className` (e.g. `size-5`). */
export function LogoIcon({ variant = "brand", title, className, ...props }: LogoIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={LOGO_ICON.viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={LOGO_ICON.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-7 shrink-0", variant === "brand" && "text-brand", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {LOGO_ICON_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export type LogoProps = {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
  /** Icon variant; the wordmark always uses the current text color. */
  variant?: LogoIconVariant;
};

/** Icon + "Trendcart" wordmark (Geist Sans semibold). Wrap in a link where needed. */
export function Logo({ className, iconClassName, wordmarkClassName, variant }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <LogoIcon variant={variant} className={iconClassName} />
      <span
        className={cn(
          "font-sans text-lg leading-none font-semibold tracking-tight",
          wordmarkClassName,
        )}
      >
        {siteConfig.name}
      </span>
    </span>
  );
}
