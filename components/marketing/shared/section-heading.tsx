import { cn } from "@/lib/utils";

export type SectionHeadingProps = {
  eyebrow: string;
  /** Two-line headline with a deliberate break: [first line, second line]. */
  title: readonly [string, string];
  description?: string;
  align?: "left" | "center";
  /** Heading level. Sections use h2 (default); the hero renders its own h1. */
  as?: "h2" | "h3";
  /** Id on the heading, for `aria-labelledby` on the parent section. */
  id?: string;
  className?: string;
};

/** Eyebrow + two-line headline + optional description. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  as: Heading = "h2",
  id,
  className,
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-4",
        centered && "mx-auto items-center text-center",
        className,
      )}
    >
      <p className="font-mono text-xs font-medium tracking-[0.18em] text-brand-text uppercase">
        {eyebrow}
      </p>
      <Heading
        id={id}
        className="text-3xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-4xl md:text-5xl"
      >
        <span className="block">{title[0]}</span>
        <span className="block text-muted-foreground">{title[1]}</span>
      </Heading>
      {description ? (
        <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground md:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
