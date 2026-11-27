"use client";

import { ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { PendingImageDTO, UploadImagesResult } from "@/lib/services";

import type { ActionResult } from "../action-result";
import { FormError, FormSuccess } from "../form-controls";

/** Same limits as the server (lib/media/images). */
const MAX_IMAGE_MB = 4;
const MAX_PER_UPLOAD = 5;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Product photos a user adds for the Shopify page. Before the Shopify draft
 * exists they wait here; once it exists they are sent straight to Shopify.
 * Either way Trendcart deletes its copy as soon as Shopify has the photo.
 */
export function ProductPhotos({
  productId,
  pending,
  hasShopifyDraft,
  shopDomain,
  canEdit,
  onUpload,
  onDelete,
}: {
  productId: string;
  pending: PendingImageDTO[];
  hasShopifyDraft: boolean;
  shopDomain: string | null;
  canEdit: boolean;
  onUpload: (form: FormData) => Promise<ActionResult<UploadImagesResult>>;
  onDelete: (productId: string, imageId: string) => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);
    const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return setError("Choose at least one photo.");
    if (files.length > MAX_PER_UPLOAD) {
      return setError(`Upload at most ${MAX_PER_UPLOAD} photos at a time.`);
    }
    if (files.some((f) => f.size > MAX_IMAGE_MB * 1024 * 1024)) {
      return setError(`Each photo must be ${MAX_IMAGE_MB} MB or smaller.`);
    }
    form.set("productId", productId);
    startTransition(async () => {
      const result = await onUpload(form);
      if (!result.ok) return setError(result.error);
      formRef.current?.reset();
      const { sentToShopify, pending: held, duplicates } = result.data;
      const parts = [
        sentToShopify > 0 ? `${sentToShopify} sent to ${shopDomain ?? "Shopify"}` : null,
        held > 0 ? `${held} added, sent to Shopify when the page is created` : null,
        duplicates > 0 ? `${duplicates} already added` : null,
      ].filter(Boolean);
      setSuccess(`${parts.join(", ")}.`);
    });
  }

  function remove(imageId: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await onDelete(productId, imageId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {hasShopifyDraft
          ? "Photos you add are uploaded straight to the Shopify product, then removed from Trendcart."
          : "Photos you add wait here and are uploaded to the Shopify product when its page is created. Trendcart then deletes its copy."}
      </p>

      {pending.length > 0 ? (
        <ul
          className="grid grid-cols-3 gap-3 sm:grid-cols-5"
          aria-label="Photos waiting for Shopify"
        >
          {pending.map((image) => (
            <li key={image.id} className="grid gap-1.5">
              <span className="block aspect-square overflow-hidden rounded-lg border border-border bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={image.purpose === "search" ? "Image search photo" : "Product photo"}
                  className="size-full object-cover"
                  loading="lazy"
                />
              </span>
              {image.purpose === "search" ? (
                <span className="text-xs text-muted-foreground">Search photo</span>
              ) : canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => remove(image.id)}
                  aria-label="Remove this photo"
                >
                  <Trash2Icon aria-hidden="true" />
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <form ref={formRef} onSubmit={submit} className="grid gap-3" aria-busy={busy}>
          <div className="grid content-start gap-1.5">
            <label htmlFor={`photos-${productId}`} className="text-sm font-medium">
              Add photos
            </label>
            <input
              id={`photos-${productId}`}
              name="images"
              type="file"
              accept={ACCEPT}
              multiple
              disabled={busy}
              aria-describedby={`photos-${productId}-hint`}
              className="block w-full rounded-lg border border-border bg-background text-sm file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <p id={`photos-${productId}-hint`} className="text-xs text-muted-foreground">
              JPEG, PNG, WebP or GIF, {MAX_IMAGE_MB} MB each, up to {MAX_PER_UPLOAD} at a time.
            </p>
          </div>
          <FormError message={error} />
          <FormSuccess message={success} />
          <div>
            <Button type="submit" variant="outline" size="lg" disabled={busy} aria-busy={busy}>
              <ImagePlusIcon aria-hidden="true" />
              {busy ? "Uploading…" : hasShopifyDraft ? "Upload to Shopify" : "Add photos"}
            </Button>
          </div>
        </form>
      ) : (
        <FormError message={error} />
      )}
    </div>
  );
}
