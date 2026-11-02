"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const SCROLL_THRESHOLD = 8;

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

const getSnapshot = () => window.scrollY > SCROLL_THRESHOLD;
const getServerSnapshot = () => false;

/**
 * Sticky `<header>` that knows whether the page is scrolled. Re-renders only
 * when the boolean flips; children (the nav) are server-rendered.
 * Descendants style themselves with `group-data-[scrolled=true]/header:`.
 */
export function NavbarShell({ children }: { children: ReactNode }) {
  const scrolled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <header
      data-scrolled={scrolled}
      className={cn(
        "group/header sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300",
        "supports-backdrop-filter:backdrop-blur-xl supports-backdrop-filter:backdrop-saturate-150",
        scrolled
          ? "border-border bg-background/80 shadow-[0_8px_32px_-16px_rgba(0,0,0,0.35)]"
          : "border-transparent bg-background/40",
      )}
    >
      {children}
    </header>
  );
}
