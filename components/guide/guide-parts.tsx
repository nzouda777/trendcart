import { CircleAlertIcon, InfoIcon, LightbulbIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Building blocks of the in-app user guide (/app/guide). Server components,
 * no client state: the illustrations are the landing mockups.
 */

export type GuideTocItem = { id: string; label: string; group: string };

export function GuideSection({
  id,
  number,
  eyebrow,
  title,
  intro,
  illustration,
  children,
}: {
  id: string;
  number?: number;
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  /** Shown beside the intro on wide screens, below it on small ones. */
  illustration?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 py-12 first:pt-0">
      <div
        className={cn(
          "grid gap-8",
          illustration && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] xl:items-start",
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-brand-text uppercase">
            {number !== undefined ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft text-[11px] text-brand-text">
                {number}
              </span>
            ) : null}
            {eyebrow}
          </p>
          <h2
            id={`${id}-title`}
            className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            {title}
          </h2>
          {intro ? (
            <div className="mt-4 grid gap-3 text-[15px] leading-relaxed text-muted-foreground">
              {intro}
            </div>
          ) : null}
        </div>
        {illustration ? (
          <figure className="min-w-0">
            {illustration}
            <figcaption className="mt-2 text-xs text-muted-foreground">
              Illustration with sample data.
            </figcaption>
          </figure>
        ) : null}
      </div>
      {children ? <div className="mt-8 grid gap-6">{children}</div> : null}
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold tracking-tight">{children}</h3>;
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 text-[15px] leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
      {children}
    </div>
  );
}

/** Numbered steps with a connecting line. */
export function Steps({ items }: { items: { title: string; body?: ReactNode }[] }) {
  return (
    <ol className="grid gap-0">
      {items.map((item, i) => (
        <li key={item.title} className="relative flex gap-4 pb-6 last:pb-0">
          {i < items.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-8 bottom-0 left-[15px] w-px bg-border-strong"
            />
          ) : null}
          <span
            aria-hidden="true"
            className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-border bg-brand-soft text-sm font-semibold text-brand-text"
          >
            {i + 1}
          </span>
          <div className="min-w-0 pt-1">
            <p className="font-medium">{item.title}</p>
            {item.body ? (
              <div className="mt-1 grid gap-2 text-sm leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
                {item.body}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

const CALLOUT = {
  tip: { icon: LightbulbIcon, label: "Tip", className: "border-brand-border bg-brand-soft" },
  note: { icon: InfoIcon, label: "Good to know", className: "border-border bg-surface" },
  warning: {
    icon: CircleAlertIcon,
    label: "Important",
    className: "border-warning/40 bg-warning/10",
  },
} as const;

export function Callout({
  kind = "note",
  title,
  children,
}: {
  kind?: keyof typeof CALLOUT;
  title?: string;
  children: ReactNode;
}) {
  const c = CALLOUT[kind];
  const Icon = c.icon;
  return (
    <aside className={cn("flex gap-3 rounded-xl border p-4 text-sm", c.className)}>
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          kind === "warning" ? "text-warning" : "text-brand-text",
        )}
      />
      <div className="grid min-w-0 gap-1 leading-relaxed [&_strong]:font-semibold">
        <p className="font-semibold">{title ?? c.label}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </aside>
  );
}

export function GuideTable({
  head,
  rows,
  caption,
}: {
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-surface-2/60">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border align-top">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn("px-4 py-2.5", j === 0 ? "font-medium" : "text-muted-foreground")}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small card grid, e.g. feature summaries. */
export function CardGrid({
  items,
}: {
  items: { icon: ReactNode; title: string; body: ReactNode; href?: string }[];
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const inner = (
          <>
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand-text [&_svg]:size-4">
              {item.icon}
            </span>
            <p className="mt-3 font-medium">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </>
        );
        return (
          <li key={item.title}>
            {item.href ? (
              <a
                href={item.href}
                className="block h-full rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {inner}
              </a>
            ) : (
              <div className="h-full rounded-xl border border-border bg-surface p-4">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** UI label as it appears in the app (a button, a status, a menu item). */
export function Ui({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-surface-2 px-1.5 py-px text-[0.85em] font-medium whitespace-nowrap text-foreground">
      {children}
    </span>
  );
}

/** The four approval gates as a horizontal track (wraps on small screens). */
export function GateTrack() {
  const gates = [
    { n: 1, title: "Product confirmation", who: "Creative or higher", href: "#gate-1" },
    { n: 2, title: "Supplier and price", who: "Creative or higher", href: "#gate-2" },
    { n: 3, title: "Page and videos", who: "Creative, Media buyer for ads", href: "#gate-3-page" },
    { n: 4, title: "Launch", who: "Media buyer or Owner", href: "#gate-4" },
  ];
  return (
    <ol aria-label="The four approval gates" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {gates.map((g) => (
        <li key={g.n}>
          <a
            href={g.href}
            className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="text-xs font-semibold text-brand-text">GATE {g.n}</span>
            <span className="mt-1 font-medium">{g.title}</span>
            <span className="mt-auto pt-3 text-xs text-muted-foreground">Approved by: {g.who}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Static mock of the Import screen (no mockup exists for it). */
export function ImportIllustration() {
  return (
    <div
      role="img"
      aria-label="The Import screen: a link field with a TikTok video link, the brand selector and the Import button."
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_80px_-32px_rgba(0,0,0,0.45)]"
    >
      <div aria-hidden="true">
        <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-2/60 px-3 text-[11px] text-muted-foreground">
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="size-2.5 rounded-full bg-foreground/10" />
          <span className="ml-2">Import</span>
        </div>
        <div className="grid gap-4 p-5">
          <div className="flex gap-2 text-xs">
            <span className="rounded-full border border-brand-border bg-brand-soft px-2.5 py-1 font-medium text-brand-text">
              TikTok video
            </span>
            <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
              Product link
            </span>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">Link</span>
            <span className="truncate rounded-lg border border-border-strong bg-background px-3 py-2 font-mono text-xs">
              https://www.tiktok.com/@creator/video/7412345678901234567
            </span>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">Brand</span>
            <span className="rounded-lg border border-border-strong bg-background px-3 py-2 text-xs">
              Demo Brand (US)
            </span>
          </div>
          <span className="w-fit rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground">
            Import
          </span>
        </div>
      </div>
    </div>
  );
}
