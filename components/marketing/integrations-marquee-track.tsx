"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type IntegrationsMarqueeTrackProps = {
  /** One `<ul>` of logos. Rendered twice in the moving track (the copy is `aria-hidden`). */
  list: ReactNode;
  pauseLabel: string;
  playLabel: string;
  className?: string;
};

/**
 * Infinite CSS marquee (`animate-marquee`, translateX -50% over two identical
 * halves). Pauses on hover and via a toggle button (keyboard-reachable,
 * WCAG 2.2.2). Under reduced motion the track is replaced by a static,
 * wrapped row (pure CSS, so server and client markup match).
 */
export function IntegrationsMarqueeTrack({
  list,
  pauseLabel,
  playLabel,
  className,
}: IntegrationsMarqueeTrackProps) {
  const [paused, setPaused] = useState(false);

  return (
    <div
      data-paused={paused}
      className={cn("group/marquee flex min-w-0 items-center gap-3", className)}
    >
      {/* Animated (default) */}
      <div className="min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] motion-reduce:hidden">
        <div className="flex w-max animate-marquee [--marquee-duration:36s] group-hover/marquee:[animation-play-state:paused] group-data-[paused=true]/marquee:[animation-play-state:paused]">
          <div className="shrink-0">{list}</div>
          <div aria-hidden="true" className="shrink-0">
            {list}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? playLabel : pauseLabel}
        aria-pressed={paused}
        title={paused ? playLabel : pauseLabel}
        className="grid size-8 shrink-0 place-items-center rounded-full border bg-surface text-muted-foreground transition-colors hover:text-foreground motion-reduce:hidden"
      >
        {paused ? (
          <PlayIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <PauseIcon aria-hidden="true" className="size-3.5" />
        )}
      </button>

      {/* Reduced motion: static wrapped row */}
      <div className="hidden w-full motion-reduce:block [&_ul]:flex-wrap [&_ul]:justify-center [&_ul]:gap-y-4 [&_ul]:pr-0">
        {list}
      </div>
    </div>
  );
}
