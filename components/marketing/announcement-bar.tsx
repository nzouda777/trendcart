import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { landing } from "@/content/landing";

import { AnnouncementBarDismissible } from "./announcement-bar-dismissible";

/**
 * Top of the page chrome: the skip link (first focusable element on the page,
 * so it lives here rather than in the navbar, and stays when the bar is
 * dismissed) + the dismissible early-access announcement.
 */
export function AnnouncementBar() {
  const { announcement, nav } = landing;

  return (
    <>
      <a
        href="#main-content"
        className="sr-only rounded-lg border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100"
      >
        {nav.skipToContentLabel}
      </a>
      <AnnouncementBarDismissible id={announcement.id} dismissLabel={announcement.dismissLabel}>
        <p className="text-pretty">
          <span>{announcement.message}</span>
          {announcement.link ? (
            <>
              {" "}
              <Link
                href={announcement.link.href}
                className="group inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 hover:underline"
              >
                {announcement.link.label}
                <ArrowRightIcon
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </>
          ) : null}
        </p>
      </AnnouncementBarDismissible>
    </>
  );
}
