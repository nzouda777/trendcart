"use client";

import { XIcon } from "lucide-react";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "tc:announcement-dismissed:";

/* Tiny external store: localStorage (when available) + in-memory fallback. */
const listeners = new Set<() => void>();
const dismissedInMemory = new Set<string>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readDismissed(id: string): boolean {
  if (dismissedInMemory.has(id)) return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(id: string) {
  dismissedInMemory.add(id);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, "1");
  } catch {
    // Private mode / storage disabled: the in-memory flag still hides the bar.
  }
  listeners.forEach((listener) => listener());
}

/** The server never knows about localStorage: always render the bar there. */
const getServerSnapshot = () => false;

export type AnnouncementBarDismissibleProps = {
  /** Message id; bumping it re-shows the bar for users who dismissed an older one. */
  id: string;
  dismissLabel: string;
  className?: string;
  children: ReactNode;
};

/**
 * Client shell of the announcement bar. `useSyncExternalStore` renders the
 * server snapshot (visible) during hydration, then hides the bar right after
 * mount when it was dismissed before, so there is no hydration mismatch.
 */
export function AnnouncementBarDismissible({
  id,
  dismissLabel,
  className,
  children,
}: AnnouncementBarDismissibleProps) {
  const getSnapshot = useCallback(() => readDismissed(id), [id]);
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden border-b bg-surface text-sm text-muted-foreground",
        className,
      )}
    >
      <div className="mx-auto flex min-h-10 w-full max-w-content items-center justify-center px-12 py-2 text-center sm:px-14">
        {children}
      </div>
      <button
        type="button"
        onClick={() => persistDismissed(id)}
        aria-label={dismissLabel}
        title={dismissLabel}
        className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:right-4"
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
