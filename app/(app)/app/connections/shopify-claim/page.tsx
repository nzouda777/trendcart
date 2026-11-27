import { Building2Icon, LockIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { ShopifyClaimForm } from "@/components/app/connections/shopify-claim-form";
import { PageSkeleton, Section } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getPendingShopifyClaim } from "@/lib/services";

import { getPageContext } from "../../_lib/page-context";
import { claimShopifyStoreAction } from "./actions";

export const metadata: Metadata = { title: "Connect your Shopify store" };

/*
 * Landing page after installing Trendcart from Shopify: the store finished
 * OAuth (its token is parked for 24 h), the merchant is now signed in and
 * picks the brand it belongs to.
 */
export default function ShopifyClaimPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClaimContent />
    </Suspense>
  );
}

async function ClaimContent() {
  const { ctx, role, brands, activeBrand } = await getPageContext();
  const shop = await getPendingShopifyClaim(ctx);
  const header = <PageHeader title="Connect your Shopify store" />;

  if (!shop) {
    return (
      <div className="grid max-w-2xl gap-6">
        {header}
        <EmptyState
          icon={StoreIcon}
          title="No store waiting to be connected"
          description="The install link expired or was already used. Open Trendcart from your Shopify admin (Apps) to try again."
          action={
            <Button asChild size="lg" variant="outline">
              <Link href="/app/connections">Go to connections</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!can(role, "connection:create")) {
    return (
      <div className="grid max-w-2xl gap-6">
        {header}
        <EmptyState
          icon={LockIcon}
          title="Your role cannot connect stores"
          description={`${shop} installed Trendcart. Connecting it needs the Media buyer role or higher: ask a workspace owner to finish, or to change your role.`}
        />
      </div>
    );
  }

  if (!activeBrand) {
    return (
      <div className="grid max-w-2xl gap-6">
        {header}
        <EmptyState
          icon={Building2Icon}
          title="Add a brand first"
          description={`Stores are connected per brand. Create one, then come back to this page to connect ${shop} (the install stays valid for 24 hours).`}
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
        title="Connect your Shopify store"
        description={
          <>
            <span className="text-foreground">{shop}</span> installed Trendcart. Choose the brand it
            sells for.
          </>
        }
      />
      <Section id="claim" title="Store">
        <ShopifyClaimForm
          shop={shop}
          brands={brands.map(({ id, name }) => ({ id, name }))}
          defaultBrandId={activeBrand.id}
          onClaim={claimShopifyStoreAction}
        />
      </Section>
    </div>
  );
}
