"use client";

import { LayoutTemplate } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { demoProduct, formatMoney } from "./data";
import { MockupFrame } from "./mockup-frame";
import { FakeButton, PanelLabel, ProductPhoto } from "./primitives";
import { StatusBadge } from "./status";
import { useCycle, useMockupMotion } from "./use-mockup-motion";

const savePct = Math.round((1 - demoProduct.price / demoProduct.compareAtPrice) * 100);

export type ShopifyPageMockupProps = { className?: string };

/** Shopify product page drafted from the store template: variants, price, compare-at, Draft. */
export function ShopifyPageMockup({ className }: ShopifyPageMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { active, reduced } = useMockupMotion(ref);
  const [cycled] = useCycle(demoProduct.variants.length, 2400, active);
  const variantIndex = reduced ? 0 : cycled;
  const variant = demoProduct.variants[variantIndex];
  /** Gallery image follows the cycle too (all editions share the same look). */
  const imageIndex = variantIndex % demoProduct.gallery.length;

  return (
    <div ref={ref} className={cn("w-full min-w-0", className)}>
      <MockupFrame
        title="Shopify page"
        label={`Shopify product page preview for ${demoProduct.name}, built from the store's template: ${demoProduct.variants.length} editions in ${demoProduct.color.label.toLowerCase()}, price ${formatMoney(demoProduct.price)}, compare-at price ${formatMoney(demoProduct.compareAtPrice)}, saved as a draft.`}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <LayoutTemplate className="size-3.5 shrink-0" />
              <span className="truncate font-mono">templates/product.json</span>
            </span>
            <StatusBadge tone="neutral">Draft</StatusBadge>
          </div>

          <div className="grid gap-3 rounded-lg border border-border bg-background p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-1.5 sm:grid-cols-1">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
                {demoProduct.gallery.map((photo, k) => (
                  <motion.div
                    key={photo.src.src}
                    className="absolute inset-0"
                    initial={false}
                    animate={{ opacity: k === imageIndex ? 1 : 0 }}
                    transition={{ duration: active ? 0.45 : 0 }}
                  >
                    <ProductPhoto
                      photo={photo}
                      alt={k === 0 ? undefined : ""}
                      sizes="(min-width: 1024px) 200px, (min-width: 640px) 288px, 220px"
                      className="size-full"
                    />
                  </motion.div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {demoProduct.gallery.map((photo, k) => (
                  <ProductPhoto
                    key={photo.src.src}
                    photo={photo}
                    alt=""
                    sizes="64px"
                    className={cn(
                      "aspect-square w-full rounded-md transition-opacity",
                      k === imageIndex ? "ring-2 ring-brand" : "opacity-60",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="min-w-0 space-y-2.5">
              <div>
                <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  Demo Store
                </p>
                <p className="text-sm font-semibold sm:text-base">{demoProduct.name}</p>
              </div>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono">
                <span className="text-base font-semibold">{formatMoney(demoProduct.price)}</span>
                <span className="text-xs text-muted-foreground line-through">
                  {formatMoney(demoProduct.compareAtPrice)}
                </span>
                <StatusBadge tone="success" dot={false} className="font-sans">
                  Save {savePct}%
                </StatusBadge>
              </p>
              <div>
                <PanelLabel>Color · {demoProduct.color.label}</PanelLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/70 px-2 py-0.5 text-[10px] font-medium sm:text-[11px]">
                    <span
                      className="size-2.5 rounded-full border border-black/15"
                      style={{ backgroundColor: demoProduct.color.swatch }}
                    />
                    {demoProduct.color.label}
                  </span>
                </div>
              </div>
              <div>
                <PanelLabel>Edition · {variant.label}</PanelLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {demoProduct.variants.map((v, i) => (
                    <span
                      key={v.id}
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] transition-colors sm:text-[11px]",
                        i === variantIndex
                          ? "border-brand-border bg-brand-soft font-medium text-brand-text"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {v.label}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <PanelLabel>Pack</PanelLabel>
                <div className="mt-1.5 flex gap-1.5">
                  {demoProduct.bundles.map((b, i) => (
                    <span
                      key={b}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[10px] sm:text-[11px]",
                        i === 0
                          ? "border-foreground/70 font-medium"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
              <span className="block rounded-md bg-foreground py-1.5 text-center text-[11px] font-medium text-background sm:text-xs">
                Add to cart
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">
              {demoProduct.variants.length * demoProduct.bundles.length} variants · SKU{" "}
              <span className="font-mono">{demoProduct.sku}</span>
            </span>
            <FakeButton variant="primary">Approve page</FakeButton>
          </div>
        </div>
      </MockupFrame>
    </div>
  );
}
