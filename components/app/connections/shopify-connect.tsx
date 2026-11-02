import { Button } from "@/components/ui/button";

import { TextField } from "../form-controls";

/*
 * Shopify connect forms. Plain HTML forms (no JS needed): they navigate to
 * the install route, which redirects to Shopify and back to /app/connections.
 *   public app:  GET  /api/shopify/install?brandId&shop
 *   custom app:  POST /api/shopify/install (form) -> 303
 */

const INSTALL = "/api/shopify/install";

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
