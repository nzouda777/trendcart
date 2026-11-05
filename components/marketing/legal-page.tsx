import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { siteConfig } from "@/config/site";
import { landing } from "@/content/landing";
import type { LegalDocument } from "@/content/legal";

import { Footer } from "./footer";

/** Contact lines from siteConfig.legal; empty values are left out, never invented. */
function Contact() {
  const { operator, address, contactEmail } = siteConfig.legal as Record<string, string>;
  return (
    <section aria-labelledby="contact" className="scroll-mt-24">
      <h2 id="contact" className="text-xl font-semibold tracking-tight">
        Contact
      </h2>
      <p className="mt-3 text-muted-foreground">
        {siteConfig.name} is operated by {operator || siteConfig.name}
        {address ? `, ${address}` : ""}.
        {contactEmail ? (
          <>
            {" "}
            For questions or requests about this page, email{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="font-medium text-brand-text underline-offset-4 hover:underline"
            >
              {contactEmail}
            </a>
            .
          </>
        ) : null}
      </p>
    </section>
  );
}

/** Shared layout for /privacy and /terms: header, title, table of contents, sections, footer. */
export function LegalPage({
  document,
  extra,
}: {
  document: LegalDocument;
  /** Rendered after the last section, before Contact. */
  extra?: React.ReactNode;
}) {
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link
          href={siteConfig.links.home}
          className="rounded-md"
          aria-label={`${siteConfig.name} home`}
        >
          <Logo />
        </Link>
        <ThemeToggle label={landing.nav.themeToggleLabel} />
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-5 pt-10 pb-24 outline-none sm:px-6"
      >
        <h1 className="text-4xl font-semibold tracking-tight">{document.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated {siteConfig.legal.lastUpdated}
        </p>
        <p className="mt-6 text-pretty text-muted-foreground">{document.intro}</p>

        <nav aria-label="On this page" className="mt-8 rounded-lg border bg-surface/40 p-5">
          <ol className="grid gap-2 text-sm sm:grid-cols-2">
            {document.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="rounded-sm text-muted-foreground hover:text-foreground"
                >
                  {s.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#contact" className="rounded-sm text-muted-foreground hover:text-foreground">
                Contact
              </a>
            </li>
          </ol>
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          {document.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className="scroll-mt-24">
              <h2 id={section.id} className="text-xl font-semibold tracking-tight">
                {section.title}
              </h2>
              <div className="mt-3 flex flex-col gap-3 text-muted-foreground">
                {section.blocks.map((block, i) =>
                  block.type === "p" ? (
                    <p key={i} className="text-pretty">
                      {block.text}
                    </p>
                  ) : (
                    <ul key={i} className="flex list-disc flex-col gap-2 pl-5">
                      {block.items.map((item) => (
                        <li key={item} className="text-pretty">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ),
                )}
              </div>
            </section>
          ))}
          {extra}
          <Contact />
        </div>
      </main>
      <Footer />
    </>
  );
}
