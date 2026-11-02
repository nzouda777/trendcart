import { ChevronRight, CircleCheck, CircleX, Play, TriangleAlert } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { demoProduct, demoVideos, type CheckState, type SamplePhoto } from "./data";
import { StatusBadge } from "./status";

/* Static building blocks shared by the mockups (server-safe, no motion). */

/** Non-focusable fake button. */
export function FakeButton({
  children,
  variant = "secondary",
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap sm:text-xs",
        variant === "primary"
          ? "bg-brand text-brand-foreground"
          : "border border-border bg-surface-2 text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Real sample photo (next/image, `fill` + object-cover) in a sized box.
 * Pass `sizes` matching the rendered width so mobile downloads a small file.
 * Use px values per breakpoint: a `vw` value makes next/image drop every
 * candidate below 640w × ratio, so small thumbs would fetch 256–640w files.
 */
export function ProductPhoto({
  photo = demoProduct.image,
  sizes,
  alt,
  preload = false,
  className,
  children,
}: {
  photo?: SamplePhoto;
  /** Rendered width hint, e.g. "96px". */
  sizes: string;
  /** Defaults to the photo's description; pass "" when a text label sits next to it. */
  alt?: string;
  /** Only for the above-the-fold hero frame. */
  preload?: boolean;
  className?: string;
  /** Overlays (play button, duration chips...). */
  children?: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-surface-2", className)}>
      <Image
        src={photo.src}
        alt={alt ?? photo.alt}
        fill
        sizes={sizes}
        preload={preload}
        draggable={false}
        className="object-cover"
        style={{ objectPosition: photo.position }}
      />
      {children}
    </div>
  );
}

/** Vertical TikTok-style video poster: photo crop + play button + duration. */
export function VideoPoster({
  photo,
  duration,
  sizes,
  preload = false,
  className,
  children,
}: {
  photo: SamplePhoto;
  duration: string;
  sizes: string;
  preload?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <ProductPhoto
      photo={photo}
      alt=""
      sizes={sizes}
      preload={preload}
      className={cn("rounded-md", className)}
    >
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-7 place-items-center rounded-full bg-black/45">
          <Play className="size-3.5 fill-white text-white" />
        </span>
      </span>
      <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white">
        {duration}
      </span>
      {children}
    </ProductPhoto>
  );
}

/** Tiny creative preview for an ad row ("Ad 1 · vid-01" → that video's poster). */
export function AdThumb({ ad }: { ad: string }) {
  const video = demoVideos.find((v) => ad.endsWith(v.id)) ?? demoVideos[0];
  return (
    <ProductPhoto
      photo={video.poster}
      alt=""
      sizes="20px"
      className="h-4 w-3 shrink-0 rounded-[3px]"
    />
  );
}

export function CheckIcon({ state, className }: { state: CheckState; className?: string }) {
  if (state === "pass") return <CircleCheck className={cn("size-3.5 text-success", className)} />;
  if (state === "warn") return <TriangleAlert className={cn("size-3.5 text-warning", className)} />;
  return <CircleX className={cn("size-3.5 text-danger", className)} />;
}

export function VariantChips({ active = 0 }: { active?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {demoProduct.variants.map((v, i) => (
        <span
          key={v.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] sm:text-[11px]",
            i === active
              ? "border-brand-border bg-brand-soft font-medium text-brand-text"
              : "border-border text-muted-foreground",
          )}
        >
          {v.label}
        </span>
      ))}
    </div>
  );
}

export function TreeRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-surface px-1.5 py-1">
      <ChevronRight className="size-3 shrink-0 rotate-90 text-muted-foreground" />
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <StatusBadge tone="paused">Paused</StatusBadge>
    </div>
  );
}
