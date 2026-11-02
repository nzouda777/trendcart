import Link from "next/link";
import { siInstagram, siTiktok, siX, siYoutube, type SimpleIcon } from "simple-icons";

import { Logo } from "@/components/brand/logo";
import { siteConfig, type SocialLink } from "@/config/site";
import { landing } from "@/content/landing";
import { getCurrentYear } from "@/lib/current-year";

import { FooterNewsletter } from "./footer-newsletter";

const socialIcons: Record<SocialLink["id"], SimpleIcon> = {
  x: siX,
  tiktok: siTiktok,
  instagram: siInstagram,
  youtube: siYoutube,
};

function FooterLink({ href, children }: { href: string; children: string }) {
  const className =
    "rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground";
  // Internal routes use next/link; anchors and "#" placeholders stay plain.
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * Footer. Async server component: the year comes from the cached
 * `getCurrentYear()` (prerender-safe with `cacheComponents`, no hydration
 * mismatch).
 */
export async function Footer() {
  const { footer } = landing;
  const year = await getCurrentYear();

  return (
    <footer className="relative border-t bg-surface/30">
      <div className="mx-auto w-full max-w-content px-5 pt-16 pb-10 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
          {/* Brand + newsletter */}
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <Link
                href={siteConfig.links.home}
                aria-label={`${siteConfig.name} home`}
                className="self-start rounded-md"
              >
                <Logo />
              </Link>
              <p className="text-sm text-muted-foreground">{siteConfig.tagline}</p>
            </div>
            <FooterNewsletter {...footer.newsletter} />
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {footer.columns.map((column) => (
              <nav key={column.title} aria-labelledby={`footer-${column.title.toLowerCase()}`}>
                <h2
                  id={`footer-${column.title.toLowerCase()}`}
                  className="text-sm font-medium text-foreground"
                >
                  {column.title}
                </h2>
                <ul className="mt-4 flex flex-col gap-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <FooterLink href={link.href}>{link.label}</FooterLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col-reverse items-start gap-6 border-t pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            © {year} {siteConfig.name}. {footer.legalNote}
          </p>
          <ul aria-label={footer.socialsLabel} className="flex items-center gap-1">
            {siteConfig.socials.map((social) => (
              <li key={social.id}>
                <a
                  href={social.href}
                  aria-label={social.label}
                  title={social.label}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                    className="size-4"
                  >
                    <path d={socialIcons[social.id].path} />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
