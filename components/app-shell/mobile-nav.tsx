"use client";

import { MenuIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/** Prerender-safe stand-in for MobileNav (which reads the runtime pathname). */
export function MobileNavFallback() {
  return (
    <Button variant="ghost" size="icon" aria-label="Open navigation" disabled>
      <MenuIcon aria-hidden="true" />
    </Button>
  );
}

/** Below lg: the sidebar lives in a sheet. It closes itself after navigating. */
export function MobileNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Remember where the sheet was opened; a route change closes it without an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;

  return (
    <Sheet open={open} onOpenChange={(next) => setOpenedAt(next ? pathname : null)}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation">
          <MenuIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Workspace, brand, pages and account.
        </SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
