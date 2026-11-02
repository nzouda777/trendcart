/**
 * Admin GraphQL 2026-10 documents and response shapes for product creation,
 * publishing and media deletion. Field names checked against the 2026-10
 * schema (productSet, productByIdentifier, productUpdate, publications,
 * publishablePublish, fileDelete).
 */
import { shopifyProductRefSchema, type ShopifyProductRef } from "@/lib/domain/contracts";

import { shopifyError } from "./errors";
import type { UserError } from "./graphql";

const PRODUCT_REF_FIELDS = /* GraphQL */ `
        id
        handle
        status
        onlineStoreUrl
        onlineStorePreviewUrl`;

/** Existing product looked up by the Trendcart custom ID (before an update). */
export const PRODUCT_BY_CUSTOM_ID_QUERY = /* GraphQL */ `
  query TrendcartProductByCustomId($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      id
      variants(first: 250) {
        nodes {
          id
          selectedOptions {
            name
            value
          }
        }
      }
      media(first: 250) {
        nodes {
          id
          mediaContentType
          status
          preview {
            image {
              url
            }
          }
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

export const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation TrendcartProductSet(
    $identifier: ProductSetIdentifiers
    $input: ProductSetInput!
    $synchronous: Boolean!
  ) {
    productSet(identifier: $identifier, input: $input, synchronous: $synchronous) {
      product {${PRODUCT_REF_FIELDS}
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const PRODUCT_ACTIVATE_MUTATION = /* GraphQL */ `
  mutation TrendcartProductActivate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
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

/**
 * Reverts a failed GATE 3 publish: productUpdate(product: { id, status: DRAFT })
 * (2026-10; productChangeStatus is deprecated). Setting DRAFT on a DRAFT
 * product is a no-op success, so the call is idempotent. Returns the ref
 * fields directly, so no read-back is needed.
 */
export const PRODUCT_DRAFT_MUTATION = /* GraphQL */ `
  mutation TrendcartProductDraft($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {${PRODUCT_REF_FIELDS}
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ONLINE_STORE_PUBLICATION_QUERY = /* GraphQL */ `
  query TrendcartPublications($after: String) {
    publications(first: 50, after: $after, catalogType: APP) {
      nodes {
        id
        catalog {
          title
          ... on AppCatalog {
            apps(first: 5) {
              nodes {
                handle
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PUBLISHABLE_PUBLISH_MUTATION = /* GraphQL */ `
  mutation TrendcartPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_REF_QUERY = /* GraphQL */ `
  query TrendcartProductRef($id: ID!) {
    product(id: $id) {${PRODUCT_REF_FIELDS}
    }
  }
`;

export const FILE_DELETE_MUTATION = /* GraphQL */ `
  mutation TrendcartFileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export type ProductRefNode = {
  id: string;
  handle: string;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";
  onlineStoreUrl: string | null;
  /** Storefront preview, also for drafts (the page preview before GATE 3). */
  onlineStorePreviewUrl: string | null;
};

export type ProductByCustomIdData = {
  productByIdentifier: {
    id: string;
    variants: { nodes: { id: string; selectedOptions: { name: string; value: string }[] }[] };
    media: {
      nodes: {
        id: string;
        mediaContentType: string;
        status: string;
        preview: { image: { url: string } | null } | null;
        image?: { url: string } | null;
      }[];
    };
  } | null;
};

export type ProductSetData = {
  productSet: { product: ProductRefNode | null; userErrors: UserError[] };
};

export type ProductActivateData = {
  productUpdate: { product: { id: string } | null; userErrors: UserError[] };
};

export type ProductDraftData = {
  productUpdate: { product: ProductRefNode | null; userErrors: UserError[] };
};

/** productUpdate's userError for an unknown or deleted product id. */
export function isProductMissingError(e: UserError): boolean {
  return /does not exist|not found/i.test(e.message);
}

export type PublicationsData = {
  publications: {
    nodes: {
      id: string;
      catalog: { title: string; apps?: { nodes: { handle: string }[] } } | null;
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type PublishData = { publishablePublish: { userErrors: UserError[] } };
export type ProductRefData = { product: ProductRefNode | null };
export type FileDeleteData = {
  fileDelete: { deletedFileIds: string[] | null; userErrors: UserError[] };
};

export const PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d+)$/;
const SHOPIFY_GID = /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/;

/** Shopify admin URL of a product (store handle = myshopify subdomain). */
export function adminProductUrl(shopDomain: string, productId: string): string {
  const numeric = PRODUCT_GID.exec(productId)?.[1] ?? productId.split("/").pop();
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${store}/products/${numeric}`;
}

/**
 * UNLISTED (2026-10: active but hidden from search and collections) is not in
 * the contract's status enum; it is not publicly listed, so it maps to DRAFT.
 */
export function toProductRef(shopDomain: string, node: ProductRefNode): ShopifyProductRef {
  return shopifyProductRefSchema.parse({
    productId: node.id,
    handle: node.handle,
    status: node.status === "UNLISTED" ? "DRAFT" : node.status,
    adminUrl: adminProductUrl(shopDomain, node.id),
    onlineStoreUrl: node.onlineStoreUrl,
    previewUrl: node.onlineStorePreviewUrl,
  });
}

export function assertProductGid(productId: string): void {
  if (!PRODUCT_GID.test(productId)) {
    throw shopifyError("invalid_input", "Expected a Shopify product GID.", { retryable: false });
  }
}

export function assertMediaGids(ids: readonly string[]): void {
  if (ids.some((id) => !SHOPIFY_GID.test(id))) {
    throw shopifyError("invalid_input", "Media ids must be Shopify GIDs.", { retryable: false });
  }
}
