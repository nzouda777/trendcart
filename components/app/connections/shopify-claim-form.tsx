"use client";

import { StoreIcon } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

import type { ActionResult } from "../action-result";
import { FormError, SelectField } from "../form-controls";

/** Picks the brand a store installed from Shopify belongs to, then connects it. */
export function ShopifyClaimForm({
  shop,
  brands,
  defaultBrandId,
  onClaim,
}: {
  shop: string;
  brands: { id: string; name: string }[];
  defaultBrandId: string;
  onClaim: (input: { brandId: string }) => Promise<ActionResult<{ connectionId: string }>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const brandId = String(new FormData(event.currentTarget).get("brandId") ?? defaultBrandId);
    setError(null);
    startTransition(async () => {
      // On success the action redirects to the connections page.
      const result = await onClaim({ brandId });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
      {brands.length > 1 ? (
        <SelectField
          id="claim-brand"
          name="brandId"
          label="Brand"
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
          defaultValue={defaultBrandId}
          disabled={pending}
          hint="Products of this brand will be created as drafts on this store."
        />
      ) : (
        <input type="hidden" name="brandId" value={defaultBrandId} />
      )}
      <FormError message={error} />
      <div>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          <StoreIcon aria-hidden="true" />
          {pending ? "Connecting…" : `Connect ${shop}`}
        </Button>
      </div>
    </form>
  );
}
