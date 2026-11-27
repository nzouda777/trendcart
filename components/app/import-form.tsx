"use client";

import { ImageIcon, LinkIcon, VideoIcon } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ActionResult } from "./action-result";
import { FormError, SelectField, TextField } from "./form-controls";

type Kind = "tiktok" | "link" | "image";

/** Same limit as the server (lib/media/images MAX_IMAGE_BYTES). */
const MAX_IMAGE_MB = 4;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i;

function detectKind(raw: string): Kind | null {
  try {
    const url = new URL(raw.trim());
    return TIKTOK_HOST.test(url.hostname) ? "tiktok" : "link";
  } catch {
    return null;
  }
}

export function ImportForm({
  brands,
  defaultBrandId,
  onImport,
  onImportImage,
}: {
  brands: { id: string; name: string }[];
  defaultBrandId: string;
  onImport: (input: {
    kind: "tiktok" | "link";
    url: string;
    brandId: string;
  }) => Promise<ActionResult<{ productId: string }>>;
  /** Image search: FormData with brandId and either `image` (file) or `imageUrl`. */
  onImportImage: (form: FormData) => Promise<ActionResult<{ productId: string }>>;
}) {
  const [kind, setKind] = useState<Kind>("tiktok");
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const groupId = useId();

  function onUrlChange(value: string) {
    const detected = detectKind(value);
    if (detected) setKind(detected);
  }

  function showFailure(result: Exclude<ActionResult<{ productId: string }>, { ok: true }>) {
    const fieldMessage = result.fieldErrors?.url?.[0] ?? result.fieldErrors?.imageUrl?.[0];
    if (fieldMessage) setUrlError(fieldMessage);
    // Business-rule refusal of the link or file itself (e.g. a blocked address, not an image).
    else if (result.code === "invalid_input" && !result.fieldErrors) {
      setUrlError(result.error || "This cannot be imported.");
    } else if (result.code === "rate_limited") {
      setError("Too many imports in a short time. Wait a minute, then try again.");
    } else setError(result.error);
  }

  function submitImage(form: FormData) {
    const file = form.get("image");
    const hasFile = file instanceof File && file.size > 0;
    const imageUrl = String(form.get("imageUrl") ?? "").trim();
    if (!hasFile && !imageUrl) {
      setUrlError("Choose a photo or paste an image link.");
      return;
    }
    if (hasFile && file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setUrlError(`The photo must be ${MAX_IMAGE_MB} MB or smaller.`);
      return;
    }
    if (!hasFile) form.delete("image");
    startTransition(async () => {
      // On success the action redirects to the product page.
      const result = await onImportImage(form);
      if (!result.ok) showFailure(result);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setUrlError(undefined);
    if (!form.get("brandId")) form.set("brandId", defaultBrandId);
    if (kind === "image") {
      submitImage(form);
      return;
    }
    const linkKind = kind;
    const url = String(form.get("url") ?? "").trim();
    const brandId = String(form.get("brandId") ?? defaultBrandId);
    startTransition(async () => {
      // On success the action redirects to the product page.
      const result = await onImport({ kind: linkKind, url, brandId });
      if (!result.ok) showFailure(result);
    });
  }

  const options: { value: Kind; label: string; icon: typeof VideoIcon; hint: string }[] = [
    {
      value: "tiktok",
      label: "TikTok video",
      icon: VideoIcon,
      hint: "A tiktok.com video link. The AI watches the video to identify the product.",
    },
    {
      value: "link",
      label: "Product link",
      icon: LinkIcon,
      hint: "A store or marketplace product page. The AI reads the page.",
    },
    {
      value: "image",
      label: "Image search",
      icon: ImageIcon,
      hint: "A product photo. The AI identifies it, then a reverse image search finds suppliers.",
    },
  ];

  return (
    <form onSubmit={submit} className="grid gap-5" aria-busy={pending}>
      <fieldset className="grid gap-2" disabled={pending}>
        <legend id={groupId} className="mb-2 text-sm font-medium">
          Source
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map(({ value, label, icon: Icon, hint }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                kind === value
                  ? "border-brand-border bg-brand-soft"
                  : "border-border bg-background hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-text" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind === "image" ? (
        <div className="grid gap-4">
          <div className="grid content-start gap-1.5">
            <label htmlFor="import-image" className="text-sm font-medium">
              Product photo
            </label>
            <input
              id="import-image"
              name="image"
              type="file"
              accept={IMAGE_ACCEPT}
              disabled={pending}
              aria-describedby="import-image-hint"
              className="block w-full rounded-lg border border-border bg-background text-sm file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <p id="import-image-hint" className="text-xs text-muted-foreground">
              JPEG, PNG, WebP or GIF, {MAX_IMAGE_MB} MB max. The photo is kept only until it is
              added to your Shopify product page.
            </p>
          </div>
          <TextField
            id="import-image-url"
            name="imageUrl"
            type="url"
            inputMode="url"
            label="Or an image link"
            placeholder="https://cdn.example.com/product.jpg"
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            hint="A direct link to the image file. Used when no photo is chosen."
            error={urlError}
          />
        </div>
      ) : (
        <TextField
          id="import-url"
          name="url"
          type="url"
          inputMode="url"
          label={kind === "tiktok" ? "TikTok video link" : "Product page link"}
          placeholder={
            kind === "tiktok"
              ? "https://www.tiktok.com/@creator/video/1234567890"
              : "https://store.example.com/products/item"
          }
          required
          maxLength={2048}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={pending}
          onChange={(e) => onUrlChange(e.currentTarget.value)}
          hint="Paste the link. The source type switches automatically."
          error={urlError}
        />
      )}

      {brands.length > 1 ? (
        <SelectField
          id="import-brand"
          name="brandId"
          label="Brand"
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
          defaultValue={defaultBrandId}
          disabled={pending}
          hint="Pricing, language and stores come from this brand."
        />
      ) : (
        <input type="hidden" name="brandId" value={defaultBrandId} />
      )}

      <FormError message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="xl" disabled={pending} aria-busy={pending}>
          {pending ? "Importing and analyzing…" : kind === "image" ? "Search by image" : "Import"}
        </Button>
        {pending ? (
          <p role="status" className="text-sm text-muted-foreground">
            The AI analysis can take up to a minute. You can leave this page; the product will keep
            processing.
          </p>
        ) : null}
      </div>
    </form>
  );
}
