"use client";

import {
  Check,
  CircleCheck,
  Film,
  FolderOpen,
  Link2,
  Megaphone,
  Rocket,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { motion, type Variants } from "motion/react";
import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

import {
  demoCampaign,
  demoProduct,
  demoTiktokUrl,
  demoVideos,
  formatMoney,
  selectedMargin,
  supplierMatches,
} from "./data";
import {
  AdThumb,
  CheckIcon,
  FakeButton,
  PanelLabel,
  ProductPhoto,
  TreeRow,
  VariantChips,
  VideoPoster,
} from "./primitives";
import { StatusBadge } from "./status";

/* Shared, presentational step views used by PipelineMockup and HowItWorksMockup. */

/** When true, views render their final state with no entrance animation. */
export const StaticMotionContext = createContext(false);

function useInitial<T>(value: T): T | false {
  return useContext(StaticMotionContext) ? false : value;
}

export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

/* -------------------------------------------------------------------------- */

export function ImportView({
  typing = false,
  preload = false,
}: {
  typing?: boolean;
  /** Preload the video poster (hero only, above the fold). */
  preload?: boolean;
}) {
  return (
    <motion.div
      variants={listVariants}
      initial={useInitial("hidden")}
      animate="show"
      className="space-y-3"
    >
      <motion.div variants={itemVariants}>
        <PanelLabel>Import from TikTok</PanelLabel>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-brand-border bg-background px-2.5 ring-2 ring-brand-soft">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            <motion.span
              className="truncate font-mono text-[11px] sm:text-xs"
              initial={useInitial(typing ? { clipPath: "inset(0 100% 0 0)" } : false)}
              animate={{ clipPath: "inset(0 0% 0 0)" }}
              transition={{ duration: 1.1, ease: "linear", delay: 0.2 }}
            >
              {demoTiktokUrl}
            </motion.span>
          </div>
          <FakeButton variant="primary">Import</FakeButton>
        </div>
      </motion.div>
      <motion.div
        variants={itemVariants}
        className="flex gap-3 rounded-lg border border-border bg-surface-2/60 p-2.5"
      >
        <VideoPoster
          photo={demoVideos[0].poster}
          duration={demoVideos[0].duration}
          sizes="80px"
          preload={preload}
          className="aspect-[9/14] w-16 shrink-0 sm:w-20"
        />
        <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
          <p className="text-xs font-medium">@demo.creator</p>
          <p className="line-clamp-2 text-[11px] text-muted-foreground">
            this tiny projector turned my ceiling into a cinema #homedecor #demo
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <StatusBadge tone="neutral">Video linked, not stored</StatusBadge>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function IdentifyView() {
  return (
    <motion.div
      variants={listVariants}
      initial={useInitial("hidden")}
      animate="show"
      className="space-y-3"
    >
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-2">
        <PanelLabel className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-brand-text" /> Product identified
        </PanelLabel>
        <span className="font-mono text-[10px] text-muted-foreground">
          {demoProduct.confidence}% match
        </span>
      </motion.div>
      <motion.div variants={itemVariants} className="flex gap-3">
        <ProductPhoto alt="" sizes="80px" className="size-16 shrink-0 sm:size-20" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{demoProduct.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{demoProduct.category}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-brand"
              initial={useInitial({ width: "0%" })}
              animate={{ width: `${demoProduct.confidence}%` }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
      </motion.div>
      <motion.ul variants={listVariants} className="space-y-1.5">
        {demoProduct.sellingPoints.map((point) => (
          <motion.li
            key={point}
            variants={itemVariants}
            className="flex items-center gap-2 text-[11px] sm:text-xs"
          >
            <Check className="size-3.5 shrink-0 text-success" />
            <span className="truncate">{point}</span>
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  );
}

export function SourceView() {
  const m = selectedMargin;
  return (
    <motion.div
      variants={listVariants}
      initial={useInitial("hidden")}
      animate="show"
      className="space-y-3"
    >
      <motion.div variants={itemVariants}>
        <PanelLabel>Supplier matches</PanelLabel>
      </motion.div>
      <div className="space-y-1.5">
        {supplierMatches.map((s, i) => (
          <motion.div
            key={s.id}
            variants={itemVariants}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] sm:text-xs",
              i === 0 ? "border-brand-border bg-brand-soft" : "border-border bg-surface-2/50",
            )}
          >
            <span
              className={cn(
                "grid size-3.5 shrink-0 place-items-center rounded-full border",
                i === 0 ? "border-brand bg-brand" : "border-border-strong",
              )}
            >
              {i === 0 ? <span className="size-1.5 rounded-full bg-brand-foreground" /> : null}
            </span>
            <ProductPhoto
              photo={s.image}
              alt=""
              sizes="24px"
              className="size-5 shrink-0 rounded-sm"
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="font-mono">{formatMoney(s.cost)}</span>
            <span className="hidden font-mono text-muted-foreground sm:inline">{s.shipDays}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-4 gap-1.5 rounded-lg border border-border bg-surface-2/60 p-2 text-center"
      >
        {[
          ["Price", formatMoney(m.price)],
          ["Cost", formatMoney(m.cost + m.shipping)],
          ["Fees", formatMoney(m.fees)],
        ].map(([k, v]) => (
          <div key={k}>
            <p className="text-[10px] text-muted-foreground">{k}</p>
            <p className="font-mono text-[11px] sm:text-xs">{v}</p>
          </div>
        ))}
        <div className="rounded-md border border-brand-border bg-brand-soft">
          <p className="text-[10px] text-brand-text">Margin</p>
          <p className="font-mono text-[11px] font-semibold text-brand-text sm:text-xs">
            {m.marginPct.toFixed(1)}%
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function PageView() {
  return (
    <motion.div
      variants={listVariants}
      initial={useInitial("hidden")}
      animate="show"
      className="space-y-3"
    >
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-2">
        <PanelLabel>Shopify · product page</PanelLabel>
        <StatusBadge tone="neutral">Draft</StatusBadge>
      </motion.div>
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 rounded-lg border border-border bg-background p-2.5"
      >
        <div className="space-y-1.5">
          <ProductPhoto sizes="(min-width: 640px) 208px, 96px" className="aspect-[4/3] w-full" />
          <div className="grid grid-cols-3 gap-1">
            {demoProduct.gallery.map((photo, k) => (
              <ProductPhoto
                key={photo.src.src}
                photo={photo}
                alt=""
                sizes="64px"
                className={cn(
                  "aspect-square w-full rounded-sm",
                  k === 0 ? "ring-1 ring-brand" : "opacity-80",
                )}
              />
            ))}
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="truncate text-sm font-semibold">{demoProduct.name}</p>
          <p className="flex items-baseline gap-2 font-mono">
            <span className="text-sm font-semibold">{formatMoney(demoProduct.price)}</span>
            <span className="text-[11px] text-muted-foreground line-through">
              {formatMoney(demoProduct.compareAtPrice)}
            </span>
          </p>
          <VariantChips />
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded bg-surface-2" />
            <div className="h-1.5 w-4/5 rounded bg-surface-2" />
          </div>
          <span className="block rounded-md bg-foreground py-1.5 text-center text-[11px] font-medium text-background">
            Add to cart
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function VideosView() {
  return (
    <motion.div
      variants={listVariants}
      initial={useInitial("hidden")}
      animate="show"
      className="space-y-3"
    >
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-2">
        <PanelLabel className="flex items-center gap-1.5">
          <Film className="size-3" /> Video library
        </PanelLabel>
        <span className="font-mono text-[10px] text-muted-foreground">3 candidates</span>
      </motion.div>
      <div className="grid grid-cols-3 gap-2">
        {demoVideos.map((v) => {
          const states = Object.values(v.checks);
          const tone = states.includes("fail")
            ? "danger"
            : states.includes("warn")
              ? "warning"
              : "success";
          return (
            <motion.div
              key={v.id}
              variants={itemVariants}
              className="overflow-hidden rounded-lg border border-border bg-surface-2/60"
            >
              <VideoPoster
                photo={v.poster}
                duration={v.duration}
                sizes="(min-width: 640px) 176px, 80px"
                className="aspect-[5/6] w-full rounded-none"
              />
              <div className="flex items-center justify-between gap-1 p-1.5">
                <span className="flex gap-0.5">
                  <CheckIcon state={v.checks.format} className="size-3" />
                  <CheckIcon state={v.checks.length} className="size-3" />
                  <CheckIcon state={v.checks.claims} className="size-3" />
                </span>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    tone === "success"
                      ? "bg-success"
                      : tone === "warning"
                        ? "bg-warning"
                        : "bg-danger",
                  )}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
      <motion.p
        variants={itemVariants}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      >
        <TriangleAlert className="size-3 shrink-0 text-warning" />
        <span className="truncate">{demoVideos[1].note}</span>
      </motion.p>
    </motion.div>
  );
}

export function CampaignView({ compact = false }: { compact?: boolean }) {
  return (
    <motion.div
      variants={listVariants}
      initial={useInitial("hidden")}
      animate="show"
      className="space-y-2.5"
    >
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-2">
        <PanelLabel>TikTok Ads · campaign</PanelLabel>
        <span className="font-mono text-[10px] text-muted-foreground">{demoCampaign.budget}</span>
      </motion.div>
      <motion.div
        variants={itemVariants}
        className="space-y-1 rounded-lg border border-border bg-surface-2/50 p-2 text-[11px] sm:text-xs"
      >
        <TreeRow
          icon={<Megaphone className="size-3.5 text-foreground" />}
          label={demoCampaign.name}
        />
        {demoCampaign.adGroups.slice(0, compact ? 1 : 2).map((g) => (
          <div key={g.name} className="space-y-1 pl-4">
            <TreeRow
              icon={<FolderOpen className="size-3.5 text-muted-foreground" />}
              label={g.name}
            />
            {g.ads.slice(0, compact ? 1 : 2).map((ad) => (
              <div key={ad} className="pl-4">
                <TreeRow icon={<AdThumb ad={ad} />} label={ad} />
              </div>
            ))}
          </div>
        ))}
      </motion.div>
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <CircleCheck className="size-3.5 shrink-0 text-success" />
          <span className="truncate">Checklist 4/4</span>
        </span>
        <FakeButton variant="primary">
          <Rocket className="size-3" /> Approve &amp; launch
        </FakeButton>
      </motion.div>
    </motion.div>
  );
}
