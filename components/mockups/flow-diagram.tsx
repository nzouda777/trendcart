"use client";

import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { siShopify, siTiktok } from "simple-icons";

import { LogoIcon } from "@/components/brand/logo";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./status";
import { useMockupMotion } from "./use-mockup-motion";

function BrandGlyph({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-4 fill-current", className)}>
      <path d={path} />
    </svg>
  );
}

function Node({
  icon,
  title,
  meta,
  className,
  highlight = false,
}: {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 rounded-xl border p-2 sm:p-3",
        highlight ? "border-brand-border bg-brand-soft" : "border-border bg-surface",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-md sm:size-7",
          highlight ? "bg-background" : "bg-surface-2",
        )}
      >
        {icon}
      </span>
      <p className="mt-1.5 text-[11px] leading-tight font-medium break-words sm:text-sm">{title}</p>
      <div className="mt-1.5 min-w-0 sm:mt-2">{meta}</div>
    </div>
  );
}

/** Animated dashed connector. `fork` splits into two branches (top + bottom). */
function Connector({ fork = false, animate }: { fork?: boolean; animate: boolean }) {
  const paths = fork
    ? ["M0 50 C 50 50, 50 22, 100 22", "M0 50 C 50 50, 50 78, 100 78"]
    : ["M0 50 L100 50"];
  return (
    <div className="relative w-4 shrink-0 self-stretch sm:w-10">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full overflow-visible"
      >
        {paths.map((d) => (
          <g key={d}>
            <path
              d={d}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <motion.path
              d={d}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="6 14"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={animate ? { strokeDashoffset: [0, -40] } : { strokeDashoffset: 0 }}
              transition={
                animate ? { duration: 1.4, ease: "linear", repeat: Infinity } : { duration: 0 }
              }
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

export type FlowDiagramProps = {
  className?: string;
  /** Accessible description (landing passes `why.flowAriaLabel`). */
  ariaLabel?: string;
};

/** TikTok post → product → Shopify (draft page) + TikTok Ads (paused campaign). */
export function FlowDiagram({ className, ariaLabel }: FlowDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { active } = useMockupMotion(ref);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={
        ariaLabel ??
        `Flow: a TikTok post goes into ${siteConfig.name}, which prepares a Shopify draft page and a paused TikTok Ads campaign.`
      }
      className={cn(
        "w-full max-w-full min-w-0 rounded-2xl border border-border bg-surface-2/40 p-2.5 select-none sm:p-5",
        className,
      )}
    >
      <div aria-hidden="true" className="flex items-stretch">
        <div className="flex min-w-0 flex-1 items-center">
          <Node
            className="w-full"
            icon={<BrandGlyph path={siTiktok.path} />}
            title="TikTok post"
            meta={
              <span className="block truncate font-mono text-[9px] text-muted-foreground sm:text-[11px]">
                @demo.creator
              </span>
            }
          />
        </div>
        <Connector animate={active} />
        <div className="flex min-w-0 flex-1 items-center">
          <Node
            highlight
            className="w-full"
            icon={<LogoIcon className="size-4 sm:size-5" />}
            title={siteConfig.name}
            meta={
              <div className="flex flex-wrap gap-1">
                <span className="inline-flex shrink-0 items-center rounded-full border border-brand-border bg-background px-1.5 py-0.5 text-[9px] leading-4 font-medium whitespace-nowrap text-brand-text sm:text-[10px]">
                  AI + you
                </span>
              </div>
            }
          />
        </div>
        <Connector fork animate={active} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 sm:gap-3">
          <Node
            icon={<BrandGlyph path={siShopify.path} />}
            title="Shopify"
            meta={
              <StatusBadge tone="neutral" className="px-1.5 text-[9px] sm:text-[10px]">
                Draft page
              </StatusBadge>
            }
          />
          <Node
            icon={<BrandGlyph path={siTiktok.path} />}
            title="TikTok Ads"
            meta={
              <StatusBadge tone="paused" className="px-1.5 text-[9px] sm:text-[10px]">
                Paused
              </StatusBadge>
            }
          />
        </div>
      </div>
    </div>
  );
}
