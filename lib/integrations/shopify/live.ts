import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  IntegrationError,
  productTemplateStructureSchema,
  shopDomainSchema,
  shopifyShopInfoSchema,
  type OAuthStart,
  type ShopifyAppCredentials,
  type ShopifyCredentials,
  type ShopifyShopInfo,
} from "@/lib/domain/contracts";

import {
  ENSURED_METAFIELD_DEFINITIONS,
  ONLINE_STORE_APP_HANDLE,
  readShopifyEnv,
  requestedShopifyScopes,
  SHOPIFY_PRODUCT_ID_METAFIELD,
  SHOPIFY_SCOPES,
  type ShopifyMetafieldDefinitionSpec,
} from "./config";
import { codeForStatus, shopifyError, ShopifyNotImplementedError } from "./errors";
import {
  adminGraphql,
  assertNoUserErrors,
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
  type ShopifyAdapter,
  type ShopifyInstallToken,
} from "./types";

/*
 * Live Shopify adapter (Admin GraphQL, pinned version from config.ts).
 *
 * Install: authorization code grant for a non-embedded app, offline access,
 * `expiring=1` (expiring offline tokens are mandatory for new public apps).
 * app_mode "custom" uses the same flow with the store's own client id/secret.
 *
 * M1: OAuth, HMAC, shop info, template discovery, metafield definitions.
 * M2: createDraftProduct (productSet upsert), publishProduct (ACTIVE +
 * Online Store publication), deleteProductMedia (fileDelete).
 * M3 (throws ShopifyNotImplementedError): attachVideoFromUrl.
 */

export type LiveShopifyOptions = {
  apiKey?: string;
  apiSecret?: string;
  apiVersion?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** Injectable for tests (throttle waits). */
  sleep?: Sleep;
};

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

    async attachVideoFromUrl() {
      // TODO(M3): stagedUploadsCreate(resource: VIDEO) -> stream sourceUrl body
      // into the staged target (no disk buffering) -> productUpdate media
      // { originalSource: resourceUrl, mediaContentType: VIDEO } -> poll
      // node(id).status until READY -> return id + sources[0].url.
      throw new ShopifyNotImplementedError("attachVideoFromUrl");
    },

    async deleteProductMedia(creds, { productId, mediaIds }) {
      assertProductGid(productId);
      const ids = [...new Set(mediaIds)];
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
