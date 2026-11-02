import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { landing } from "@/content/landing";

import { MobileMenu } from "./mobile-menu";
import { NavbarShell } from "./navbar-shell";

/**
 * Sticky, translucent navbar that shrinks on scroll (see `NavbarShell`).
 * The skip-to-content link is rendered first in the DOM by `AnnouncementBar`.
 */
export function Navbar() {
  const { nav } = landing;

  return (
    <NavbarShell>
      <nav
        aria-label={nav.ariaLabel}
        className="mx-auto flex h-16 w-full max-w-content items-center gap-3 px-5 transition-[height] duration-300 group-data-[scrolled=true]/header:h-14 sm:px-6 lg:px-8"
      >
        <Link
          href={siteConfig.links.home}
          aria-label={`${siteConfig.name} home`}
          className="mr-auto shrink-0 rounded-md md:mr-0"
        >
          <Logo />
        </Link>

        <ul className="hidden flex-1 items-center justify-center gap-0.5 text-sm md:flex lg:gap-1">
          {nav.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:px-3"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle label={nav.themeToggleLabel} />
          <Button
            asChild
            variant="ghost"
            size="lg"
            className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
          >
            <Link href={nav.signIn.href}>{nav.signIn.label}</Link>
          </Button>
          <Button asChild size="lg" className="px-3 md:px-3.5">
            <Link href={nav.getStarted.href}>{nav.getStarted.label}</Link>
          </Button>
          <MobileMenu
            className="md:hidden"
            ariaLabel={nav.ariaLabel}
            links={nav.links}
            signIn={nav.signIn}
            getStarted={nav.getStarted}
            openMenuLabel={nav.openMenuLabel}
            closeMenuLabel={nav.closeMenuLabel}
          />
        </div>
      </nav>
    </NavbarShell>
  );
}
