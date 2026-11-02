"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type MouseEvent } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MenuLink = { label: string; href: string };

export type MobileMenuProps = {
  ariaLabel: string;
  links: readonly MenuLink[];
  signIn: MenuLink;
  getStarted: MenuLink;
  openMenuLabel: string;
  closeMenuLabel: string;
  className?: string;
};

/**
 * Mobile (< md) navigation in a shadcn `Sheet` (Radix Dialog: focus trap,
 * Escape to close, focus returns to the trigger). Anchor links close the sheet
 * first and scroll once the body scroll lock is released.
 */
export function MobileMenu({
  ariaLabel,
  links,
  signIn,
  getStarted,
  openMenuLabel,
  closeMenuLabel,
  className,
}: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const pendingHash = useRef<string | null>(null);

  function handleLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (href.startsWith("#") && href.length > 1) {
      event.preventDefault();
      pendingHash.current = href;
    }
    setOpen(false);
  }

  function handleCloseAutoFocus() {
    const hash = pendingHash.current;
    pendingHash.current = null;
    if (!hash) return;
    // Let Radix restore focus to the trigger, then scroll (CSS handles
    // smooth vs. instant via `scroll-behavior` + reduced motion).
    requestAnimationFrame(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView();
      window.history.pushState(null, "", hash);
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={openMenuLabel}
          className={cn("text-muted-foreground hover:text-foreground", className)}
        >
          <MenuIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={handleCloseAutoFocus}
        className="w-[85vw] max-w-sm gap-0 bg-background p-0 data-[side=right]:w-[85vw]"
      >
        <SheetHeader className="flex-row items-center justify-between border-b px-5 py-3">
          <SheetTitle asChild>
            <div>
              <Logo />
            </div>
          </SheetTitle>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={closeMenuLabel}
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <nav aria-label={ariaLabel} className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={(event) => handleLinkClick(event, link.href)}
                  className="flex items-center rounded-lg px-3 py-3 text-lg font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <SheetFooter className="gap-3 border-t px-5 py-5">
          <Button asChild variant="outline" size="xl" className="w-full">
            <Link href={signIn.href} onClick={(event) => handleLinkClick(event, signIn.href)}>
              {signIn.label}
            </Link>
          </Button>
          <Button asChild size="xl" className="w-full">
            <Link
              href={getStarted.href}
              onClick={(event) => handleLinkClick(event, getStarted.href)}
            >
              {getStarted.label}
            </Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
