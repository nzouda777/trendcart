import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import {
  IntegrationError,
  productTemplateStructureSchema,
  shopDomainSchema,
  shopifyShopInfoSchema,
  type OAuthStart,
  type ShopifyAppCredentials,
  shopifyMediaRefSchema,
  type ShopifyCredentials,
  type ShopifyMediaRef,
  type ShopifyShopInfo,
} from "@/lib/domain/contracts";
import { createHttpClient, networkError } from "@/lib/integrations/tiktok-data/http";

import {
  ENSURED_METAFIELD_DEFINITIONS,
  ONLINE_STORE_APP_HANDLE,
  readShopifyEnv,
  requestedShopifyScopes,
  SHOPIFY_PRODUCT_ID_METAFIELD,
  SHOPIFY_SCOPES,
  type ShopifyMetafieldDefinitionSpec,
} from "./config";
import { codeForStatus, shopifyError, ShopifyMediaProcessingError } from "./errors";
import {
  adminGraphql,
  assertNoUserErrors,
  realSleep,
  type FetchLike,
  type Sleep,
  type UserError,
} from "./graphql";
import { isValidShopDomain, verifyOAuthQuery, verifyWebhookBody } from "./hmac";
import { buildProductSetVariables, parseDraftInput, type ExistingProduct } from "./product-input";
import {
  colorSchemesFromSettings,
  isGeneratedTemplateSuffix,
  isMainProductSection,
  parseMainSectionSchema,
  sectionCatalog,
} from "./template-builder";
import {
  assertMediaGids,
  assertProductGid,
  FILE_DELETE_MUTATION,
  isProductMissingError,
  ONLINE_STORE_PUBLICATION_QUERY,
  PRODUCT_ACTIVATE_MUTATION,
  PRODUCT_BY_CUSTOM_ID_QUERY,
  PRODUCT_DRAFT_MUTATION,
  PRODUCT_REF_QUERY,
  PRODUCT_SET_MUTATION,
  PUBLISHABLE_PUBLISH_MUTATION,
  toProductRef,
  type FileDeleteData,
  type ProductActivateData,
  type ProductByCustomIdData,
  type ProductDraftData,
  type ProductRefData,
  type ProductSetData,
  type PublicationsData,
  type PublishData,
} from "./product-operations";
import {
  buildTemplateStructure,
  parseTemplateJson,
  parseTemplateSuffixes,
  templateFilename,
  type MetafieldDefinitionInfo,
} from "./templates";
import {
  missingScopes,
  tokenFromResponse,
  type AttachVideoInput,
  type ShopifyAdapter,
  type ShopifyInstallToken,
} from "./types";
import {
  declaredSize,
  DEFAULT_MAX_VIDEO_BYTES,
  DEFAULT_VIDEO_POLL_TIMEOUT_MS,
  DEFAULT_VIDEO_TRANSFER_TIMEOUT_MS,
  filenameHasMarker,
  compareGids,
  mediaErrorDetail,
  multipartUpload,
  pickVideoUrl,
  PRODUCT_ATTACH_MEDIA_MUTATION,
  PRODUCT_VIDEOS_QUERY,
  sourceKey,
  STAGED_UPLOADS_CREATE_MUTATION,
  VIDEO_NODE_QUERY,
  VIDEO_POLL_INITIAL_MS,
  VIDEO_POLL_MAX_INTERVAL_MS,
  videoFilename,
  videoMarker,
  videoTypeOf,
  type AttachMediaData,
  type ProductVideosData,
  type StagedUploadsData,
  type VideoNode,
  type VideoNodeData,
} from "./video";

/*
 * Live Shopify adapter (Admin GraphQL, pinned version from config.ts).
 *
 * Install: authorization code grant for a non-embedded app, offline access,
 * `expiring=1` (expiring offline tokens are mandatory for new public apps).
 * app_mode "custom" uses the same flow with the store's own client id/secret.
 *
 * M1: OAuth, HMAC, shop info, template discovery, metafield definitions.
 * M2: createDraftProduct (productSet upsert), publishProduct (ACTIVE +
 * Online Store publication), deleteProductMedia (fileDelete: images and
 * videos alike).
 * M3: attachVideoFromUrl (staged upload streamed from the source, see
 * ./video), short per-connection cache for listProductTemplates.
 */

export type LiveShopifyOptions = {
  apiKey?: string;
  apiSecret?: string;
  apiVersion?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** Injectable for tests (throttle waits, video polling). */
  sleep?: Sleep;
  /**
   * Fetch for the video source, per brand proxy. Defaults to the shared
   * outbound client (brand proxy, else the SSRF-guarded agent).
   */
  sourceFetch?: (proxyUrl: string | undefined) => FetchLike;
  maxVideoBytes?: number;
  videoTransferTimeoutMs?: number;
  videoPollTimeoutMs?: number;
  /** listProductTemplates cache lifetime per connection (0 disables it). */
  templateCacheTtlMs?: number;
};

/** Short: the template picker re-checks the live theme when a suffix is saved. */
export const DEFAULT_TEMPLATE_CACHE_TTL_MS = 30_000;
const TEMPLATE_CACHE_MAX_ENTRIES = 500;

/* ------------------------------- Operations ------------------------------- */

export const SHOP_INFO_QUERY = /* GraphQL */ `
  query TrendcartShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
      plan {
        publicDisplayName
      }
    }
    shopLocales(published: true) {
      locale
      primary
    }
  }
`;

export const PRODUCT_TEMPLATES_QUERY = /* GraphQL */ `
  query TrendcartProductTemplates($after: String) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(first: 250, after: $after, filenames: ["templates/product*.json"]) {
          nodes {
            filename
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

/** One template file of the live theme (body as text). */
export const PRODUCT_TEMPLATE_FILE_QUERY = /* GraphQL */ `
  query TrendcartProductTemplateFile($filename: String!) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        files(first: 1, filenames: [$filename]) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

/** Section files of the live theme with their source (for their {% schema %}). */
export const THEME_SECTION_FILES_QUERY = /* GraphQL */ `
  query TrendcartThemeSectionFiles($after: String) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        files(first: 25, after: $after, filenames: ["sections/*.liquid"]) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export const MAIN_THEME_ID_QUERY = /* GraphQL */ `
  query TrendcartMainTheme {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
      }
    }
  }
`;

/** Requires write_themes and a Shopify exemption for theme file modification. */
export const THEME_FILES_UPSERT_MUTATION = /* GraphQL */ `
  mutation TrendcartThemeFilesUpsert(
    $themeId: ID!
    $files: [OnlineStoreThemeFilesUpsertFileInput!]!
  ) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles {
        filename
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/** Every product metafield definition (names and types of template slots). */
export const PRODUCT_METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query TrendcartProductMetafieldDefinitions($after: String) {
    metafieldDefinitions(first: 250, after: $after, ownerType: PRODUCT) {
      nodes {
        namespace
        key
        name
        description
        type {
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query TrendcartMetafieldDefinitions {
    ${ENSURED_METAFIELD_DEFINITIONS.map(
      ({ spec: d }) =>
        `${d.key}: metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "${d.namespace}", key: "${d.key}") {
      nodes {
        id
        namespace
        key
        type {
          name
        }
      }
    }`,
    ).join("\n    ")}
  }
`;

export const METAFIELD_DEFINITION_CREATE = /* GraphQL */ `
  mutation TrendcartCreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

type ShopInfoData = {
  shop: {
    name: string;
    myshopifyDomain: string;
    currencyCode: string;
    plan: { publicDisplayName: string } | null;
  };
  shopLocales: { locale: string; primary: boolean }[];
};

type TemplatesData = {
  themes: {
    nodes: {
      id: string;
      name: string;
      files: {
        nodes: { filename: string }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      } | null;
    }[];
  };
};

type TemplateFileData = {
  themes: {
    nodes: {
      id: string;
      files: { nodes: { filename: string; body: { content?: string } | null }[] } | null;
    }[];
  };
};

type SectionFilesData = {
  themes: {
    nodes: {
      id: string;
      files: {
        nodes: { filename: string; body: { content?: string } | null }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      } | null;
    }[];
  };
};

type ThemeFilesUpsertData = {
  themeFilesUpsert: {
    upsertedThemeFiles: { filename: string }[] | null;
    userErrors: UserError[];
  };
};

type ProductDefinitionsData = {
  metafieldDefinitions: {
    nodes: {
      namespace: string;
      key: string;
      name: string;
      description: string | null;
      type: { name: string };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type DefinitionNode = { id: string; namespace: string; key: string; type: { name: string } };
type DefinitionsData = Record<string, { nodes: DefinitionNode[] }>;

type CreateDefinitionData = {
  metafieldDefinitionCreate: {
    createdDefinition: { id: string } | null;
    userErrors: UserError[];
  };
};

/* --------------------------------- Client --------------------------------- */

function stateMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createLiveShopifyClient(options: LiveShopifyOptions = {}): ShopifyAdapter {
  const now = options.now ?? Date.now;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  // Env is read lazily so builds and mock-mode tests never need Shopify secrets.
  function config() {
    const env = readShopifyEnv();
    return {
      apiKey: options.apiKey ?? env.apiKey,
      apiSecret: options.apiSecret ?? env.apiSecret,
      apiVersion: options.apiVersion ?? env.apiVersion,
    };
  }

  function appCredentials(app?: ShopifyAppCredentials): ShopifyAppCredentials {
    if (app) return app;
    const { apiKey, apiSecret } = config();
    if (!apiKey || !apiSecret) {
      throw shopifyError(
        "permission_denied",
        "SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set for the public app.",
        { retryable: false },
      );
    }
    return { clientId: apiKey, clientSecret: apiSecret };
  }

  const gql = <T>(creds: ShopifyCredentials, query: string, variables?: Record<string, unknown>) =>
    adminGraphql<T>(creds, query, variables, {
      apiVersion: config().apiVersion,
      fetch: doFetch,
      sleep: options.sleep,
    });

  /** Online Store publication id per shop (stable for the life of the store). */
  const publicationIds = new Map<string, string>();

  /**
   * listProductTemplates results per connection (shop + token hash, so a
   * revoked or rotated token never reads another token's entry). In-memory per
   * function instance: bounds the Shopify calls a page or a viewer can cause.
   */
  const templateCache = new Map<string, { expiresAt: number; value: Promise<(string | null)[]> }>();
  const templateCacheTtl = options.templateCacheTtlMs ?? DEFAULT_TEMPLATE_CACHE_TTL_MS;
  const templateCacheKey = (creds: ShopifyCredentials) =>
    `${creds.shopDomain}|${createHash("sha256").update(creds.accessToken).digest("hex").slice(0, 16)}`;
  function forgetTemplates(shopDomain: string) {
    for (const key of templateCache.keys()) {
      if (key.startsWith(`${shopDomain}|`)) templateCache.delete(key);
    }
  }

  const sleep = options.sleep ?? realSleep;
  const sourceFetch =
    options.sourceFetch ??
    ((proxyUrl: string | undefined): FetchLike => {
      const http = createHttpClient(
        { proxyUrl },
        { timeoutMs: options.videoTransferTimeoutMs ?? DEFAULT_VIDEO_TRANSFER_TIMEOUT_MS },
      );
      // undici's Response is the platform Response at runtime.
      return (url, init) =>
        http(url, init as Parameters<typeof http>[1]) as unknown as Promise<Response>;
    });

  async function tokenRequest(
    shopDomain: string,
    body: Record<string, string>,
  ): Promise<ShopifyInstallToken> {
    let response: Response;
    try {
      response = await doFetch(
        `https://${shopDomainSchema.parse(shopDomain)}/admin/oauth/access_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams(body).toString(),
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        },
      );
    } catch (cause) {
      throw shopifyError("provider_error", "Shopify token request failed.", { cause });
    }
    if (!response.ok) {
      // 400/401 on the token endpoint: bad or used code / invalid refresh token.
      const code =
        response.status === 400 || response.status === 401
          ? "auth_expired"
          : codeForStatus(response.status);
      throw shopifyError(code, `Shopify token endpoint responded ${response.status}.`, {
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    try {
      return tokenFromResponse(shopDomain, await response.json(), now());
    } catch (cause) {
      throw shopifyError("provider_error", "Unexpected Shopify token response.", { cause });
    }
  }

  return {
    mode: "live",

    buildInstallUrl({
      shopDomain,
      oauth,
      app,
    }: {
      shopDomain: string;
      oauth: OAuthStart;
      app?: ShopifyAppCredentials;
    }) {
      const shop = shopDomainSchema.parse(shopDomain);
      const { clientId } = appCredentials(app);
      const params = new URLSearchParams({
        client_id: clientId,
        scope: requestedShopifyScopes().join(","),
        redirect_uri: oauth.redirectUri,
        state: oauth.state,
      });
      // No grant_options[]=per-user: we want an offline token.
      return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
    },

    async completeInstall({ query, expectedState, app }) {
      const creds = appCredentials(app);
      const shop = query.shop;
      if (!isValidShopDomain(shop)) {
        throw shopifyError("invalid_input", "Invalid shop in OAuth callback.");
      }
      if (!verifyOAuthQuery(query, creds.clientSecret)) {
        throw shopifyError("invalid_input", "Invalid OAuth callback signature.");
      }
      if (!stateMatches(expectedState, query.state)) {
        throw shopifyError("invalid_input", "OAuth state mismatch.");
      }
      if (!query.code) throw shopifyError("invalid_input", "Missing authorization code.");

      const token = await tokenRequest(shop, {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: query.code,
        expiring: "1",
      });
      const missing = missingScopes(token.scopes, SHOPIFY_SCOPES);
      if (missing.length > 0) {
        throw shopifyError("permission_denied", `Missing Shopify scopes: ${missing.join(", ")}.`, {
          retryable: false,
        });
      }
      return token;
    },

    async refreshAccessToken({ shopDomain, refreshToken, app }) {
      const creds = appCredentials(app);
      return tokenRequest(shopDomain, {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    },

    verifyWebhook({ rawBody, hmacHeader, app }) {
      const secret = app?.clientSecret ?? config().apiSecret;
      if (!secret) return false;
      return verifyWebhookBody(rawBody, hmacHeader, secret);
    },

    async getShopInfo(creds): Promise<ShopifyShopInfo> {
      const data = await gql<ShopInfoData>(creds, SHOP_INFO_QUERY);
      const primary = data.shopLocales.find((l) => l.primary) ?? data.shopLocales[0];
      return shopifyShopInfoSchema.parse({
        shopDomain: data.shop.myshopifyDomain,
        name: data.shop.name,
        currency: data.shop.currencyCode,
        primaryLocale: primary?.locale ?? "en",
        plan: data.shop.plan?.publicDisplayName ?? undefined,
      });
    },

    async listProductTemplates(creds) {
      if (templateCacheTtl <= 0) return fetchProductTemplates(creds);
      const key = templateCacheKey(creds);
      const hit = templateCache.get(key);
      if (hit && hit.expiresAt > now()) return [...(await hit.value)];
      const value = fetchProductTemplates(creds);
      templateCache.delete(key);
      if (templateCache.size >= TEMPLATE_CACHE_MAX_ENTRIES) {
        const oldest = templateCache.keys().next().value;
        if (oldest !== undefined) templateCache.delete(oldest);
      }
      templateCache.set(key, { expiresAt: now() + templateCacheTtl, value });
      // Errors are never cached.
      value.catch(() => {
        if (templateCache.get(key)?.value === value) templateCache.delete(key);
      });
      return [...(await value)];
    },

    async getProductTemplateStructure(creds, suffix) {
      const template = await readTemplateJson(creds, suffix);

      const definitions: MetafieldDefinitionInfo[] = [];
      let after: string | null = null;
      for (let page = 0; page < 4; page++) {
        const defs: ProductDefinitionsData = await gql<ProductDefinitionsData>(
          creds,
          PRODUCT_METAFIELD_DEFINITIONS_QUERY,
          { after },
        );
        definitions.push(
          ...defs.metafieldDefinitions.nodes.map((d) => ({
            namespace: d.namespace,
            key: d.key,
            name: d.name,
            description: d.description,
            type: d.type.name,
          })),
        );
        const info = defs.metafieldDefinitions.pageInfo;
        if (!info.hasNextPage || !info.endCursor) break;
        after = info.endCursor;
      }
      return productTemplateStructureSchema.parse(
        buildTemplateStructure(suffix, template, definitions),
      );
    },

    async getTemplateDesignContext(creds, baseSuffix) {
      const base = await readTemplateJson(creds, baseSuffix);
      const files: { filename: string; content: string }[] = [];
      let after: string | null = null;
      for (let page = 0; page < 8; page++) {
        const data: SectionFilesData = await gql<SectionFilesData>(
          creds,
          THEME_SECTION_FILES_QUERY,
          { after },
        );
        const theme = data.themes.nodes[0];
        if (!theme) throw shopifyError("not_found", "The store has no published (MAIN) theme.");
        if (!theme.files) break;
        for (const n of theme.files.nodes) {
          if (typeof n.body?.content === "string") {
            files.push({ filename: n.filename, content: n.body.content });
          }
        }
        if (!theme.files.pageInfo.hasNextPage || !theme.files.pageInfo.endCursor) break;
        after = theme.files.pageInfo.endCursor;
      }
      // The buy box section the base template uses (its addable blocks).
      const mainType = Object.values(
        (base.sections ?? {}) as Record<string, { type?: unknown }>,
      ).find((sec) => typeof sec?.type === "string" && isMainProductSection(sec.type))?.type;
      const mainFile = files.find((f) => f.filename === `sections/${String(mainType)}.liquid`);
      const settingsData = await readThemeJson(creds, "config/settings_data.json").catch(
        () => null,
      );
      return {
        base,
        sections: sectionCatalog(files),
        mainSection: mainFile ? parseMainSectionSchema(mainFile.filename, mainFile.content) : null,
        colorSchemes: colorSchemesFromSettings(settingsData),
      };
    },

    async upsertProductTemplate(creds, input) {
      if (!isGeneratedTemplateSuffix(input.suffix)) {
        throw shopifyError(
          "invalid_input",
          "Trendcart only writes the templates it generates (product.tc-*.json).",
          { retryable: false },
        );
      }
      const theme = await gql<{ themes: { nodes: { id: string }[] } }>(creds, MAIN_THEME_ID_QUERY);
      const themeId = theme.themes.nodes[0]?.id;
      if (!themeId) throw shopifyError("not_found", "The store has no published (MAIN) theme.");
      let data: ThemeFilesUpsertData;
      try {
        data = await gql<ThemeFilesUpsertData>(creds, THEME_FILES_UPSERT_MUTATION, {
          themeId,
          files: [
            {
              filename: templateFilename(input.suffix),
              body: { type: "TEXT", value: JSON.stringify(input.template, null, 2) },
            },
          ],
        });
      } catch (error) {
        if (error instanceof IntegrationError && error.code === "permission_denied") {
          throw shopifyError(
            "permission_denied",
            "Shopify refused to write the theme template: the app needs the write_themes scope and Shopify's theme-modification exemption. Reconnect the store after enabling it, or use an existing template.",
            { retryable: false, cause: error },
          );
        }
        throw error;
      }
      assertNoUserErrors("themeFilesUpsert", data.themeFilesUpsert.userErrors);
      forgetTemplates(creds.shopDomain);
    },

    ensureMetafieldDefinitions,

    async createDraftProduct(creds, input) {
      // Validate before any network call.
      const draft = parseDraftInput(input);
      // Idempotent and cheap (one query when they all exist); also covers
      // stores connected before trendcart.product_id was added.
      await ensureMetafieldDefinitions(creds);

      let existing: ExistingProduct | null = null;
      if (draft.idempotencyKey) {
        const found = await gql<ProductByCustomIdData>(creds, PRODUCT_BY_CUSTOM_ID_QUERY, {
          identifier: {
            customId: {
              namespace: SHOPIFY_PRODUCT_ID_METAFIELD.namespace,
              key: SHOPIFY_PRODUCT_ID_METAFIELD.key,
              value: draft.idempotencyKey,
            },
          },
        });
        const product = found.productByIdentifier;
        if (product) {
          existing = {
            id: product.id,
            variants: product.variants.nodes,
            media: product.media.nodes.map((m) => ({
              id: m.id,
              mediaContentType: m.mediaContentType,
              status: m.status,
              url: m.image?.url ?? m.preview?.image?.url ?? null,
            })),
          };
        }
      }

      const data = await gql<ProductSetData>(
        creds,
        PRODUCT_SET_MUTATION,
        buildProductSetVariables(input, existing),
      );
      assertNoUserErrors("productSet", data.productSet.userErrors);
      if (!data.productSet.product) {
        throw shopifyError("provider_error", "productSet returned no product.");
      }
      return toProductRef(creds.shopDomain, data.productSet.product);
    },

    attachVideoFromUrl,

    async deleteProductMedia(creds, { productId, mediaIds }) {
      assertProductGid(productId);
      // Images (MediaImage) and videos (Video) alike: both are files.
      await deleteFiles(creds, [...new Set(mediaIds)]);
    },

    async publishProduct(creds, productId) {
      assertProductGid(productId);
      const activated = await gql<ProductActivateData>(creds, PRODUCT_ACTIVATE_MUTATION, {
        product: { id: productId, status: "ACTIVE" },
      });
      assertNoUserErrors("productUpdate", activated.productUpdate.userErrors);
      if (!activated.productUpdate.product) {
        throw shopifyError("not_found", "Shopify product not found.", { retryable: false });
      }

      const publicationId = await onlineStorePublicationId(creds);
      const published = await gql<PublishData>(creds, PUBLISHABLE_PUBLISH_MUTATION, {
        id: productId,
        input: [{ publicationId }],
      });
      assertNoUserErrors("publishablePublish", published.publishablePublish.userErrors);

      // Read back: onlineStoreUrl is only set once the product is published.
      const ref = await gql<ProductRefData>(creds, PRODUCT_REF_QUERY, { id: productId });
      if (!ref.product) {
        throw shopifyError("not_found", "Shopify product not found.", { retryable: false });
      }
      return toProductRef(creds.shopDomain, ref.product);
    },

    async unpublishProduct(creds, productId) {
      assertProductGid(productId);
      const data = await gql<ProductDraftData>(creds, PRODUCT_DRAFT_MUTATION, {
        product: { id: productId, status: "DRAFT" },
      });
      const errors = data.productUpdate.userErrors;
      if (errors.some(isProductMissingError)) {
        throw shopifyError("not_found", "Shopify product not found.", { retryable: false });
      }
      assertNoUserErrors("productUpdate", errors);
      if (!data.productUpdate.product) {
        throw shopifyError("not_found", "Shopify product not found.", { retryable: false });
      }
      return toProductRef(creds.shopDomain, data.productUpdate.product);
    },
  };

  async function fetchProductTemplates(creds: ShopifyCredentials): Promise<(string | null)[]> {
    const filenames: string[] = [];
    let after: string | null = null;
    // A theme has at most a few dozen product templates; cap pages defensively.
    for (let page = 0; page < 10; page++) {
      const data: TemplatesData = await gql<TemplatesData>(creds, PRODUCT_TEMPLATES_QUERY, {
        after,
      });
      const theme = data.themes.nodes[0];
      if (!theme) throw shopifyError("not_found", "The store has no published (MAIN) theme.");
      const files = theme.files;
      if (!files) break;
      filenames.push(...files.nodes.map((n) => n.filename));
      if (!files.pageInfo.hasNextPage || !files.pageInfo.endCursor) break;
      after = files.pageInfo.endCursor;
    }
    return parseTemplateSuffixes(filenames);
  }

  /* ------------------------------ Video media ------------------------------ */

  /**
   * Streams the source into a staged upload, attaches it and waits until
   * READY (see ./video for the flow). Idempotent per `idempotencyKey`: a
   * video already on the product is reused (READY: returned; processing:
   * polled; FAILED: deleted and uploaded again). When processing outlasts the
   * poll budget it throws the retryable ShopifyMediaProcessingError; calling
   * again resumes polling without a second upload.
   */
  async function attachVideoFromUrl(
    creds: ShopifyCredentials,
    input: AttachVideoInput,
  ): Promise<ShopifyMediaRef> {
    assertProductGid(input.productId);
    const source = parseSourceUrl(input.sourceUrl);
    const marker = videoMarker(input.idempotencyKey?.trim() || sourceKey(source));

    let video = await findOwnVideo(creds, input.productId, marker);
    if (video?.status === "FAILED") {
      await deleteFiles(creds, [video.id]);
      video = null;
    }
    if (!video) {
      await uploadAndAttach(creds, input, source, marker);
      video = await findOwnVideo(creds, input.productId, marker);
      if (!video) {
        throw shopifyError("provider_error", "Shopify did not list the attached video.");
      }
    }
    return waitUntilReady(creds, video);
  }

  function parseSourceUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw shopifyError("invalid_input", "The video source must be a URL.", { retryable: false });
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw shopifyError("invalid_input", "The video source must be a plain http(s) URL.", {
        retryable: false,
      });
    }
    return url.toString();
  }

  /**
   * Our video on the product: the oldest one when a concurrent run added a
   * second (the extras are deleted). not_found when the product is gone.
   */
  async function findOwnVideo(
    creds: ShopifyCredentials,
    productId: string,
    marker: string,
  ): Promise<VideoNode | null> {
    const data = await gql<ProductVideosData>(creds, PRODUCT_VIDEOS_QUERY, { id: productId });
    if (!data.product) {
      throw shopifyError("not_found", "Shopify product not found.", { retryable: false });
    }
    const ours = data.product.media.nodes
      .filter((m) => m.mediaContentType === "VIDEO" && filenameHasMarker(m.filename, marker))
      .map((m) => toVideoNode(m))
      .sort((x, y) => compareGids(x.id, y.id));
    const [first, ...duplicates] = ours;
    if (duplicates.length > 0) {
      await deleteFiles(
        creds,
        duplicates.map((d) => d.id),
      );
    }
    return first ?? null;
  }

  async function uploadAndAttach(
    creds: ShopifyCredentials,
    input: AttachVideoInput,
    sourceUrl: string,
    marker: string,
  ): Promise<void> {
    const maxBytes = options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES;
    // One deadline for the download and the upload (the body flows through).
    const signal = AbortSignal.timeout(
      options.videoTransferTimeoutMs ?? DEFAULT_VIDEO_TRANSFER_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await sourceFetch(input.proxyUrl)(sourceUrl, {
        method: "GET",
        redirect: "follow",
        signal,
      });
    } catch (cause) {
      throw rebrand(networkError("shopify", cause), "Downloading the video source failed.");
    }
    const body = response.body;
    if (!response.ok || !body) {
      await body?.cancel().catch(() => undefined);
      throw sourceStatusError(response.status);
    }

    let staged: StagedUpload;
    let filename: string;
    let mimeType: string;
    let size: number;
    try {
      size = declaredSize(response.headers.get("content-length"), maxBytes);
      const type = videoTypeOf(response.headers.get("content-type"), sourceUrl);
      mimeType = type.mimeType;
      filename = videoFilename(marker, type.extension);
      staged = await createStagedTarget(creds, { filename, mimeType, size });
    } catch (error) {
      await body.cancel().catch(() => undefined);
      throw error;
    }

    const upload = multipartUpload({
      parameters: staged.parameters,
      filename,
      mimeType,
      size,
      source: body,
    });
    let uploaded: Response;
    try {
      uploaded = await doFetch(staged.url, {
        method: "POST",
        headers: {
          "Content-Type": upload.contentType,
          // Exact length: the storage form POST gets no chunked encoding.
          "Content-Length": String(upload.contentLength),
        },
        body: upload.body,
        // Required by fetch for a streamed request body.
        duplex: "half",
        signal,
        cache: "no-store",
      } as RequestInit);
    } catch (cause) {
      await upload.body.cancel().catch(() => undefined);
      throw shopifyError("provider_error", "Streaming the video to Shopify failed.", { cause });
    }
    if (!uploaded.ok) {
      await uploaded.body?.cancel().catch(() => undefined);
      throw shopifyError(
        uploaded.status === 400 ? "invalid_input" : "provider_error",
        `Shopify's upload target responded ${uploaded.status}.`,
        // 403: the signed policy expired; a retry gets a new staged target.
        {
          retryable: uploaded.status >= 500 || uploaded.status === 429 || uploaded.status === 403,
        },
      );
    }

    const attached = await gql<AttachMediaData>(creds, PRODUCT_ATTACH_MEDIA_MUTATION, {
      product: { id: input.productId },
      media: [
        {
          originalSource: staged.resourceUrl,
          mediaContentType: "VIDEO",
          ...(input.alt?.trim() ? { alt: input.alt.trim().slice(0, 512) } : {}),
        },
      ],
    });
    const errors = attached.productUpdate.userErrors;
    if (errors.some(isProductMissingError) || (!attached.productUpdate.product && !errors.length)) {
      throw shopifyError("not_found", "Shopify product not found.", { retryable: false });
    }
    assertNoUserErrors("productUpdate media", errors);
  }

  async function createStagedTarget(
    creds: ShopifyCredentials,
    file: { filename: string; mimeType: string; size: number },
  ): Promise<StagedUpload> {
    const data = await gql<StagedUploadsData>(creds, STAGED_UPLOADS_CREATE_MUTATION, {
      input: [
        {
          resource: "VIDEO",
          filename: file.filename,
          mimeType: file.mimeType,
          fileSize: String(file.size),
          httpMethod: "POST",
        },
      ],
    });
    assertNoUserErrors("stagedUploadsCreate", data.stagedUploadsCreate.userErrors);
    const target = data.stagedUploadsCreate.stagedTargets?.[0];
    if (!target?.url || !target.resourceUrl || !target.url.startsWith("https://")) {
      throw shopifyError("provider_error", "stagedUploadsCreate returned no usable target.");
    }
    return { url: target.url, resourceUrl: target.resourceUrl, parameters: target.parameters };
  }

  async function waitUntilReady(
    creds: ShopifyCredentials,
    initial: VideoNode,
  ): Promise<ShopifyMediaRef> {
    const deadline = now() + (options.videoPollTimeoutMs ?? DEFAULT_VIDEO_POLL_TIMEOUT_MS);
    let video = initial;
    let interval = VIDEO_POLL_INITIAL_MS;
    for (;;) {
      if (video.status === "READY") {
        const fileUrl = pickVideoUrl(video);
        if (fileUrl) {
          return shopifyMediaRefSchema.parse({ mediaId: video.id, fileUrl, status: "READY" });
        }
        // READY without an MP4 rendition yet: renditions can lag, keep polling.
      }
      if (video.status === "FAILED") {
        // Never leave a broken video on the page; the next call uploads again.
        await deleteFiles(creds, [video.id]);
        throw shopifyError(
          "provider_error",
          `Shopify could not process the video${mediaErrorDetail(video)}.`,
          { retryable: false },
        );
      }
      if (now() + interval > deadline) {
        throw new ShopifyMediaProcessingError(video.id, video.status);
      }
      await sleep(interval);
      interval = Math.min(VIDEO_POLL_MAX_INTERVAL_MS, Math.round(interval * 1.5));
      const data = await gql<VideoNodeData>(creds, VIDEO_NODE_QUERY, { id: video.id });
      const node = data.node;
      if (!node?.id) {
        // Removed meanwhile (merchant or a concurrent cleanup): the next call uploads again.
        throw shopifyError("provider_error", "The Shopify video disappeared while processing.");
      }
      video = toVideoNode({ ...node, id: node.id });
    }
  }

  async function deleteFiles(creds: ShopifyCredentials, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    assertMediaGids(ids);
    // Product media are files: fileDelete detaches them from the product and
    // removes them from the store (we keep no copy). 250 per call (API limit).
    for (let i = 0; i < ids.length; i += 250) {
      const data = await gql<FileDeleteData>(creds, FILE_DELETE_MUTATION, {
        fileIds: ids.slice(i, i + 250),
      });
      // Already gone (earlier run, or removed by the merchant): success.
      assertNoUserErrors(
        "fileDelete",
        data.fileDelete.userErrors.filter((e) => e.code !== "FILE_DOES_NOT_EXIST"),
      );
    }
  }

  /** templates/product[.suffix].json of the live theme, parsed. */
  async function readTemplateJson(
    creds: ShopifyCredentials,
    suffix: string | null,
  ): Promise<Record<string, unknown>> {
    return readThemeJson(creds, templateFilename(suffix));
  }

  /** A JSON file of the live theme, parsed (Shopify's leading comment tolerated). */
  async function readThemeJson(
    creds: ShopifyCredentials,
    filename: string,
  ): Promise<Record<string, unknown>> {
    const data = await gql<TemplateFileData>(creds, PRODUCT_TEMPLATE_FILE_QUERY, { filename });
    const theme = data.themes.nodes[0];
    if (!theme) throw shopifyError("not_found", "The store has no published (MAIN) theme.");
    const file = theme.files?.nodes.find((n) => n.filename === filename);
    if (!file) {
      throw shopifyError("not_found", `The store's theme has no ${filename} file.`, {
        retryable: false,
      });
    }
    const template =
      typeof file.body?.content === "string" ? parseTemplateJson(file.body.content) : null;
    if (!template) {
      throw shopifyError("invalid_input", `${filename} is not a readable JSON template.`, {
        retryable: false,
      });
    }
    return template;
  }

  async function ensureMetafieldDefinitions(creds: ShopifyCredentials): Promise<void> {
    const existing = await gql<DefinitionsData>(creds, METAFIELD_DEFINITIONS_QUERY);
    for (const { spec, pin } of ENSURED_METAFIELD_DEFINITIONS) {
      const found = existing[spec.key]?.nodes[0];
      if (found) {
        if (found.type.name !== spec.type) {
          throw shopifyError(
            "invalid_input",
            `Metafield ${spec.namespace}.${spec.key} already exists with type ${found.type.name}, expected ${spec.type}.`,
            { retryable: false },
          );
        }
        continue;
      }
      await createDefinition(creds, spec, pin);
    }
  }

  async function onlineStorePublicationId(creds: ShopifyCredentials): Promise<string> {
    const cached = publicationIds.get(creds.shopDomain);
    if (cached) return cached;
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const data: PublicationsData = await gql<PublicationsData>(
        creds,
        ONLINE_STORE_PUBLICATION_QUERY,
        { after },
      );
      const nodes = data.publications.nodes;
      const match =
        nodes.find((n) =>
          n.catalog?.apps?.nodes.some((a) => a.handle === ONLINE_STORE_APP_HANDLE),
        ) ?? nodes.find((n) => n.catalog?.title === "Online Store");
      if (match) {
        publicationIds.set(creds.shopDomain, match.id);
        return match.id;
      }
      if (!data.publications.pageInfo.hasNextPage) break;
      after = data.publications.pageInfo.endCursor;
    }
    throw shopifyError(
      "not_found",
      "The Online Store sales channel is not installed on this store.",
      {
        retryable: false,
      },
    );
  }

  async function createDefinition(
    creds: ShopifyCredentials,
    spec: ShopifyMetafieldDefinitionSpec,
    pin: boolean,
  ): Promise<void> {
    const data = await gql<CreateDefinitionData>(creds, METAFIELD_DEFINITION_CREATE, {
      definition: {
        namespace: spec.namespace,
        key: spec.key,
        name: spec.name,
        description: spec.description,
        type: spec.type,
        ownerType: "PRODUCT",
        pin,
      },
    });
    const errors = data.metafieldDefinitionCreate.userErrors;
    // Created concurrently by another request: fine, the definition exists.
    if (errors.some((e) => e.code === "TAKEN")) return;
    if (pin && errors.some((e) => e.code === "PINNED_LIMIT_REACHED")) {
      return createDefinition(creds, spec, false);
    }
    assertNoUserErrors(`metafieldDefinitionCreate ${spec.namespace}.${spec.key}`, errors);
  }
}

type StagedUpload = {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
};

function toVideoNode(node: Partial<VideoNode> & { id: string }): VideoNode {
  return {
    id: node.id,
    status: node.status ?? "PROCESSING",
    filename: node.filename ?? "",
    mediaErrors: node.mediaErrors ?? [],
    sources: node.sources ?? [],
    originalSource: node.originalSource ?? null,
  };
}

/**
 * Source download HTTP failure. 403/404/410 usually mean an expired signed
 * provider URL: retryable, the caller resolves a fresh URL first.
 */
function sourceStatusError(status: number): IntegrationError {
  if (status === 403 || status === 404 || status === 410) {
    return shopifyError(
      "not_found",
      `The video source responded ${status} (expired or removed). Resolve a fresh URL and try again.`,
      { retryable: true },
    );
  }
  if (status === 429) {
    return shopifyError("rate_limited", "The video source responded 429.", { retryable: true });
  }
  if (status >= 500 || status < 400) {
    return shopifyError("provider_error", `The video source responded ${status}.`, {
      retryable: true,
    });
  }
  return shopifyError("invalid_input", `The video source responded ${status}.`, {
    retryable: false,
  });
}

/** A shared-client error re-labelled as Shopify's (the provider callers branch on). */
function rebrand(error: IntegrationError, message: string): IntegrationError {
  return shopifyError(error.code, `${message} ${error.message}`, {
    cause: error.cause ?? error,
    retryable: error.retryable,
  });
}
