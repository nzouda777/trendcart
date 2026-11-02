import { Building2Icon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { ImportForm } from "@/components/app/import-form";
import { PageSkeleton, Section } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";

import { getPageContext } from "../_lib/page-context";
import { importAction } from "./actions";

export const metadata: Metadata = { title: "Import" };

// The import action runs the AI analysis inline until the M2 durable engine.
export const maxDuration = 300;

// Session reads stay behind Suspense so the route keeps a static shell.
export default function ImportPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportContent />
    </Suspense>
  );
}

async function ImportContent() {
  const { role, brands, activeBrand } = await getPageContext();

  if (!can(role, "product:create")) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Import a product" />
        <EmptyState
          icon={LockIcon}
          title="Your role cannot import products"
          description="Importing needs the Creative role or higher. Ask a workspace owner to change your role."
        />
      </div>
    );
  }

  if (!activeBrand) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Import a product" />
        <EmptyState
          icon={Building2Icon}
          title="Add a brand first"
          description="Products are imported into a brand, which sets their language, currency and pricing."
          action={
            can(role, "brand:create") ? (
              <Button asChild size="lg">
                <Link href="/app/onboarding">Add a brand</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader
        title="Import a product"
        description="Start from a TikTok video or a product page. Trendcart identifies the product, then waits for you to confirm it."
      />
      <Section id="import" title="Paste a link">
        <ImportForm
          brands={brands.map(({ id, name }) => ({ id, name }))}
          defaultBrandId={activeBrand.id}
          onImport={importAction}
        />
      </Section>
    </div>
  );
}
