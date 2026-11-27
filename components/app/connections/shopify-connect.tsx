import { ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { TextField } from "../form-controls";

/*
 * Shopify connect forms. Plain HTML forms (no JS needed): they navigate to
 * the install route, which redirects to Shopify and back to /app/connections.
 *   public app:  GET  /api/shopify/install?brandId&shop
 *   custom app:  POST /api/shopify/install (form) -> 303
 */

const INSTALL = "/api/shopify/install";

/**
 * Public app, once listed: stores install Trendcart from Shopify (App Store
 * requirement 2.3.1: no shop domain typed in Trendcart). Shopify then opens
 * /api/shopify/launch, and the store is connected on /app/connections/shopify-claim.
 */
export function ShopifyInstallLink({ href }: { href: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        Install Trendcart from Shopify on the store, then choose this brand when Trendcart opens.
        Already installed? Open Trendcart from the store&apos;s admin (Apps).
      </p>
      <div>
        <Button asChild size="lg">
          <a href={href} target="_blank" rel="noopener noreferrer">
            Install on Shopify
            <ExternalLinkIcon aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </div>
    </div>
  );
}

export function ShopifyPublicConnectForm({ brandId }: { brandId: string }) {
  return (
    <form action={INSTALL} method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="brandId" value={brandId} />
      <TextField
        id="shopify-shop"
        name="shop"
        label="Store domain"
        placeholder="your-store.myshopify.com"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={255}
        hint="The myshopify.com domain, not your custom domain."
        className="flex-1"
      />
      <Button type="submit" size="lg" className="sm:mb-[1.375rem]">
        Connect Shopify
      </Button>
    </form>
  );
}

export function ShopifyCustomConnectForm({
  brandId,
  shop,
  idPrefix = "custom",
  submitLabel = "Connect with custom app",
}: {
  brandId: string;
  /** Prefilled (and fixed) when reconnecting an existing store. */
  shop?: string;
  idPrefix?: string;
  submitLabel?: string;
}) {
  return (
    <form action={INSTALL} method="post" className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="appMode" value="custom" />
      {shop ? (
        <input type="hidden" name="shop" value={shop} />
      ) : (
        <TextField
          id={`${idPrefix}-shop`}
          name="shop"
          label="Store domain"
          placeholder="your-store.myshopify.com"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={255}
          className="sm:col-span-2"
        />
      )}
      <TextField
        id={`${idPrefix}-client-id`}
        name="clientId"
        label="Client ID"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={255}
      />
      <TextField
        id={`${idPrefix}-client-secret`}
        name="clientSecret"
        label="Client secret"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={255}
        hint="Stored encrypted, never shown again."
      />
      <div className="sm:col-span-2">
        <Button type="submit" variant="outline" size="lg">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
