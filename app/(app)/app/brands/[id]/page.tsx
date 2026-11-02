import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app-shell";
import { BrandForm } from "@/components/app/brand-form";
import { DeleteBrandButton } from "@/components/app/delete-brand-button";
import { PageSkeleton, Section } from "@/components/app/surface";
import { isAccessError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getBrand } from "@/lib/services";

import { getPageContext } from "../../_lib/page-context";
import { deleteBrandAction, updateBrandAction } from "../actions";

export const metadata: Metadata = { title: "Brand settings" };

// Session reads stay behind Suspense so the route keeps a static shell.
export default function BrandSettingsPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BrandSettingsContent {...props} />
    </Suspense>
  );
}

async function BrandSettingsContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, role } = await getPageContext();

  let brand;
  try {
    brand = await getBrand(ctx, id);
  } catch (error) {
    if (isAccessError(error) && error.code === "not_found") notFound();
    throw error;
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Link
        href="/app/brands"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All brands
      </Link>
      <PageHeader
        title={brand.name}
        description="Market, budget, margin and pricing defaults for this brand."
        actions={
          <Link
            href="/app/connections"
            className="text-sm text-brand-text underline-offset-4 hover:underline"
          >
            Stores, accounts and proxy
          </Link>
        }
      />

      <Section id="settings" title="Settings">
        <BrandForm
          mode="edit"
          brand={brand}
          canEdit={can(role, "brand:update")}
          onSubmit={updateBrandAction.bind(null, brand.id)}
        />
      </Section>

      {can(role, "brand:delete") ? (
        <Section
          id="danger"
          title="Delete brand"
          description="Removes the brand with its connections, proxy and products. Refused while a product has a Shopify page or a campaign."
          className="border-danger/30"
        >
          <DeleteBrandButton
            brandName={brand.name}
            onDelete={deleteBrandAction.bind(null, brand.id)}
          />
        </Section>
      ) : null}
    </div>
  );
}
