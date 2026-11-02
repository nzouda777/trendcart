import { CheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/app-shell";
import { BrandForm } from "@/components/app/brand-form";
import { PageSkeleton, Section } from "@/components/app/surface";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

import { getPageContext } from "../_lib/page-context";
import { createBrandAction } from "../brands/actions";

export const metadata: Metadata = { title: "Get started" };

const STEPS = [
  { label: "Create your workspace" },
  { label: "Add your first brand" },
  { label: "Connect Shopify and TikTok" },
];

/** Onboarding: after workspace creation, create the first brand. */
// Session reads stay behind Suspense so the route keeps a static shell.
export default function OnboardingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OnboardingContent />
    </Suspense>
  );
}

async function OnboardingContent() {
  const { role, brands } = await getPageContext();
  if (brands.length > 0) redirect("/app");

  const current = 1;
  const canCreate = can(role, "brand:create");

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader
        title="Set up Trendcart"
        description="A brand groups one Shopify store, its TikTok ad accounts and profiles, and its market settings."
      />

      <ol aria-label="Setup progress" className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={step.label}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm",
                active ? "border-brand-border bg-brand-soft" : "border-border bg-surface",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done
                    ? "border-brand bg-brand text-brand-foreground"
                    : active
                      ? "border-brand-border text-brand-text"
                      : "border-border-strong text-muted-foreground",
                )}
              >
                {done ? <CheckIcon aria-hidden="true" className="size-3.5" /> : i + 1}
              </span>
              <span className={cn(!done && !active && "text-muted-foreground")}>
                {step.label}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <Section
        id="first-brand"
        title="Your first brand"
        description="You can add more brands, each with its own store and accounts, later."
      >
        {canCreate ? (
          <BrandForm
            mode="create"
            compact
            submitLabel="Create brand and continue"
            onSubmit={createBrandAction.bind(null, "onboarding")}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Only a workspace owner can add brands. Ask an owner to create one, then come back to{" "}
            <Link href="/app" className="text-brand-text underline-offset-4 hover:underline">
              the overview
            </Link>
            .
          </p>
        )}
      </Section>
    </div>
  );
}
