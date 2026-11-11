import type { SVGProps } from "react";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * Raw logo geometry, shared with non-React consumers (the OG image via
 * `next/og`). An outlined lightning bolt, traced from `public/logo.jpeg`. One
 * closed stroke, in one solid color. The favicons are image files in app/,
 * made from `public/favicon-black.jpeg`.
 */
export const LOGO_ICON = {
  viewBox: "0 0 32 32",
  size: 32,
  strokeWidth: 2.25,
  paths: {
    /** Outlined lightning bolt, leaning right. */
    bolt: "M21 2.5L7.5 18.5h7.25L11 29.5l14-16.25h-7.25L21 2.5z",
  },
  /**
   * Fixed brand greens for static renders (no CSS variables there).
   * `onDark`: Shopify logo green, for black/dark backgrounds.
   * `onLight`: Shopify admin green, for white/light backgrounds.
   */
  colors: { onDark: "#95BF47", onLight: "#008060" },
} as const;

export const LOGO_ICON_PATHS = [LOGO_ICON.paths.bolt] as const;

/**
 * Standalone SVG markup of the icon, for `ImageResponse`
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
  /** Icon variant; also drops the green from the wordmark when `mono`. */
  variant?: LogoIconVariant;
};

/**
 * Bolt icon + "TREND CART" wordmark (bold, uppercase, second word in brand
 * green). Screen readers get the plain brand name. Wrap in a link where needed.
 */
export function Logo({ className, iconClassName, wordmarkClassName, variant }: LogoProps) {
  const { lead, accent } = siteConfig.wordmark;
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <LogoIcon variant={variant} className={iconClassName} />
      <span
        className={cn(
          "font-sans text-lg leading-none font-bold tracking-wide uppercase",
          wordmarkClassName,
        )}
      >
        <span className="sr-only">{siteConfig.name}</span>
        <span aria-hidden="true">
          {lead} <span className={cn(variant !== "mono" && "text-brand-text")}>{accent}</span>
        </span>
      </span>
    </span>
  );
}
