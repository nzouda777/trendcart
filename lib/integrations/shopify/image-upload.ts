/**
 * Uploaded product images (Admin GraphQL 2026-10): documents, shapes and pure
 * helpers behind `attachImage` in ./live.
 *
 * Flow (shopify.dev 2026-10: stagedUploadsCreate, StagedUploadInput,
 * productUpdate media, MediaImage):
 * 1. Look for the image on the product already (deterministic filename
 *    `tcu-<marker>.<ext>`, the marker hashed from the image's sha256): a
 *    re-run never adds a second copy.
 * 2. stagedUploadsCreate(resource: IMAGE, httpMethod: POST).
 * 3. POST a multipart form (Shopify's parameters, then `file`) to the target.
 * 4. productUpdate(product: { id }, media: [{ originalSource: resourceUrl,
 *    mediaContentType: IMAGE }]).
 *
 * The `tcu-` prefix is deliberately not the `tc-` prefix of supplier photos
 * (./product-input): productSet treats these as merchant media and keeps them
 * when the draft is rebuilt.
 */
import { createHash } from "node:crypto";

import type { UserError } from "./graphql";

export const UPLOADED_IMAGE_PREFIX = "tcu-";

export function uploadedImageMarker(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
}

export function uploadedImageFilename(marker: string, extension: string): string {
  return `${UPLOADED_IMAGE_PREFIX}${marker}.${extension}`;
}

/** Whether a Shopify CDN URL is the uploaded image with this marker (Shopify may append _<uuid>). */
export function urlHasUploadedMarker(url: string | null | undefined, marker: string): boolean {
  if (!url) return false;
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    return last.startsWith(`${UPLOADED_IMAGE_PREFIX}${marker}`);
  } catch {
    return false;
  }
}

export const PRODUCT_IMAGES_QUERY = /* GraphQL */ `
  query TrendcartProductImages($id: ID!) {
    product(id: $id) {
      id
      media(first: 250) {
        nodes {
          id
          mediaContentType
          status
          ... on MediaImage {
            image {
              url
            }
          }
        }
      }
    }
  }
`;

export type ProductImagesData = {
  product: {
    id: string;
    media: {
      nodes: {
        id: string;
        mediaContentType: string;
        status?: string;
        image?: { url: string } | null;
      }[];
    };
  } | null;
};

export const STAGED_IMAGE_UPLOAD_MUTATION = /* GraphQL */ `
  mutation TrendcartStagedImageUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_ATTACH_IMAGE_MUTATION = /* GraphQL */ `
  mutation TrendcartAttachImage($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type AttachImageData = {
  productUpdate: { product: { id: string } | null; userErrors: UserError[] };
};

/** A ReadableStream over bytes already in memory (for multipartUpload). */
export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
