"use client";

import { PackageIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Product/video thumbnail. Plain <img> on purpose: thumbnails are remote
 * provider URLs (TikTok CDN, picsum in mock mode) that are signed and expire,
 * so they are not worth optimising through next/image. A broken or expired
 * URL falls back to the placeholder.
 */
export function ProductThumb({
  src,
  alt = "",
  className,
}: {
  src: string | null;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2",
        className,
      )}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          className="size-full object-cover"
        />
      ) : (
        <PackageIcon aria-hidden="true" className="size-1/3 text-muted-foreground" />
      )}
    </span>
  );
}
