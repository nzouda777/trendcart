# Integrations: what to set up for live mode

Everything here is only needed with `INTEGRATIONS_MODE=live`. In mock mode no account is
required (see [setup.md](setup.md)). `<site>` below is your public origin, for example
`https://trendcart.app`: set `NEXT_PUBLIC_SITE_URL` to exactly that value, because every OAuth
redirect URL is built from it and must match what you register with the provider.

| Service                                   | Needed for                              | Env vars                                                        |
| ----------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Shopify app (Partner / Dev Dashboard)     | Connecting stores, drafts, publishing   | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_API_VERSION`  |
| TikTok API for Business (Marketing API)   | Connecting ad accounts                  | `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_SANDBOX`          |
| TikTok for Developers (Login Kit + Content Posting) | Connecting TikTok profiles    | `TIKTOK_LOGIN_CLIENT_KEY`, `TIKTOK_LOGIN_CLIENT_SECRET`, `TIKTOK_POSTING_AUDITED` |
| ScrapeCreators                            | Resolving TikTok video links            | `TIKTOK_DATA_PROVIDER`, `TIKTOK_DATA_PROVIDER_KEY`              |
| Google Gemini                             | AI product analysis                     | `GEMINI_API_KEY`                                                |
| SerpApi (M2)                              | Supplier search (Google Lens, Shopping) | `SERPAPI_KEY`                                                   |
| Firecrawl (M2)                            | Reading supplier listing pages          | `FIRECRAWL_API_KEY`                                             |
| Anthropic Claude (M2)                     | Product page copy                       | `ANTHROPIC_API_KEY`, `AI_COPYWRITING_MODEL`                     |
| Upstash Redis                             | Shared rate limits and locks            | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`            |
| Vercel Cron                               | TikTok token refresh                    | `CRON_SECRET`                                                   |
| Vercel Workflow (M2)                      | Durable product pipeline                | `PIPELINE_ENGINE` (unset on Vercel = `workflow`)                |

`OPENAI_API_KEY`, `PERPLEXITY_API_KEY` and `SENTRY_DSN` are listed in `.env.example`, but no code
reads them yet.

## Shopify app

Trendcart connects stores from different Shopify accounts, so it uses one **public app,
distributed unlisted** (not on the App Store). It is a non-embedded app: Trendcart runs on its
own domain, not inside the Shopify admin.

1. In the Shopify Partner Dashboard (or Dev Dashboard), create an app and choose public,
   unlisted distribution.
2. Copy the client ID to `SHOPIFY_API_KEY` and the client secret to `SHOPIFY_API_SECRET`. The
   secret also verifies OAuth callback and webhook HMAC signatures.
3. Register the redirect URL `<site>/api/shopify/callback`.
4. Access scopes (from `lib/integrations/shopify/config.ts`, `SHOPIFY_SCOPES`):
   - `write_products`: metafield definitions, products, product media.
   - `read_themes`: read `templates/product*.json` of the live theme (never written).
   - `write_files`: staged uploads for product videos (M3) and media deletion.
   - `write_publications`: publish to the Online Store channel (used by Gate 3 since M2).

   The install fails with `Missing Shopify scopes` if the merchant grants fewer.
5. Webhooks, all on one endpoint `<site>/api/shopify/webhooks` (routed by `X-Shopify-Topic`):
   `app/uninstalled` plus the mandatory compliance topics `customers/data_request`,
   `customers/redact`, `shop/redact`.

Example `shopify.app.toml` (the file is not in this repo; keep it in the app's Shopify CLI
project):

```toml
client_id = "<SHOPIFY_API_KEY>"
name = "Trendcart"
application_url = "https://<site>/app/connections"
embedded = false

[access_scopes]
scopes = "write_products,read_themes,write_files,write_publications"

[auth]
redirect_urls = ["https://<site>/api/shopify/callback"]

[webhooks]
api_version = "2026-10"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
uri = "https://<site>/api/shopify/webhooks"
```

**API version.** Pinned to `2026-10` (`DEFAULT_SHOPIFY_API_VERSION`, the latest stable,
released 2026-10-01 and supported until 2027-10-16). `SHOPIFY_API_VERSION` overrides it. It
must look like `YYYY-01|04|07|10` or `unstable`. Every GraphQL document in
`lib/integrations/shopify/product-operations.ts` was checked against the 2026-10 schema. Before
changing the version, re-check those documents.

**Expiring offline tokens.** The token exchange sends `expiring=1` (required for new public
apps). Since M2, Trendcart stores the access token (`access_token_enc`), the refresh token
(`refresh_token_enc`, with its own encryption binding) and both expiry times
(`token_expires_at`, `refresh_token_expires_at`) in dedicated columns. It refreshes the token
when less than 5 minutes are left. A store whose token is about to expire is `expiring`
(orange) and keeps working. If the refresh fails, the store is marked "needs reauth" (see
[operations.md](operations.md)).

**What M2 calls on the store** (Admin GraphQL 2026-10, constant documents, data in variables
only):

| Action | Mutation or query | Notes |
| --- | --- | --- |
| Create or update the draft (build step, copy edit) | `productByIdentifier`, then `productSet` | Upsert keyed on the `trendcart.product_id` custom ID metafield (type `id`, created on install, not pinned), so re-runs update the same product. Status `DRAFT`. Sets `templateSuffix` from the connection, the `custom.*` metafields, variants, prices and images. Merchant media is never touched |
| Publish (Gate 3 approval) | `productUpdate(status: ACTIVE)`, `publications(catalogType: APP)`, `publishablePublish` | Publishes on the Online Store channel |
| Revert a failed publish | `productUpdate(product: { id, status: DRAFT })` | `productChangeStatus` is deprecated in 2026-10. Setting DRAFT on a draft is a no-op success, so the call is idempotent |
| List product templates | `themes(roles: [MAIN])` with `files(filenames: ["templates/product*.json"])` | Live theme only, read-only. Liquid product templates (vintage themes) are not listed |
| Delete media (ready for M3) | `fileDelete` | Rejected videos |

**Custom app per store (optional).** A merchant can instead create an app in their own store
and paste its client ID and secret in **Connections, "Use a custom app from the store's admin
instead"**. The secret is stored encrypted for that connection and used for its OAuth and
webhook signatures. Register the same redirect URL and webhook endpoint on that app.

**What happens on install.** Trendcart creates three product metafield definitions in the
`custom` namespace: `highlights` (list of single-line text), `faq` (JSON), `guarantee`
(multi-line text). It also creates the hidden `trendcart.product_id` custom ID. To display the
`custom.*` metafields, install the theme template kit once per theme:
[shopify-template-kit.md](shopify-template-kit.md). Then set the template suffix (`trendcart`)
on the connection. Trendcart refuses a suffix that is not in the live theme.

## TikTok API for Business (Marketing API, ads)

1. Create a developer app on the TikTok API for Business portal
   (`business-api.tiktok.com`).
2. Copy the app ID to `TIKTOK_APP_ID` and the secret to `TIKTOK_APP_SECRET`.
3. Set the advertiser authorization redirect URL to `<site>/api/tiktok/ads/callback`.
4. Permission scopes are chosen on the app in the portal (Trendcart does not request them in the
   URL). M1 only lists advertisers (`oauth2/advertiser/get`, `advertiser/info`). For M3, also
   enable the scopes for creating and updating campaigns, ad groups and ads, uploading ad
   videos, and reporting. Check the exact scope names in the portal.
5. API version: Marketing API `v1.3`.

**Sandbox.** `TIKTOK_SANDBOX` defaults to `true`. With it on, every API call except OAuth goes to
`https://sandbox-ads.tiktok.com/open_api/v1.3`. The OAuth exchange always uses production,
because the sandbox has no advertiser authorization flow: TikTok generates the sandbox token in
the developer portal. M1 has no screen to paste that token yet (open question for M2). Set
`TIKTOK_SANDBOX=false` only for real advertiser accounts.

Ad tokens from the Marketing API are long-lived and are not refreshed by the cron. Live
campaign creation, launch, video upload and stats are not implemented yet (M3); they throw
"not implemented" instead of calling TikTok.

## TikTok for Developers (Login Kit + Content Posting API)

1. Create an app on `developers.tiktok.com` and add the **Login Kit** (web) and **Content
   Posting API** products.
2. Copy the client key to `TIKTOK_LOGIN_CLIENT_KEY` and the client secret to
   `TIKTOK_LOGIN_CLIENT_SECRET`.
3. Register the redirect URI `<site>/api/tiktok/login/callback`. TikTok requires an exact,
   static match.
4. Scopes (`LOGIN_SCOPES` in `lib/integrations/tiktok-posting/config.ts`):
   - `user.info.basic`: profile name.
   - `video.publish`: Direct Post and creator info.
   - `video.upload`: send to the creator's TikTok inbox as a draft.
5. Submit the app for TikTok's review of those scopes.

**Content Posting audit.** Until TikTok audits the app, it may only post `SELF_ONLY` (private)
videos, to at most 5 users per 24 hours, from private accounts. Trendcart enforces this in both
mock and live mode. After TikTok approves the audit, set `TIKTOK_POSTING_AUDITED=true`. It only
takes effect when `TIKTOK_SANDBOX=false` and outside tests.

**Tokens.** Access tokens last 24 hours, refresh tokens 365 days, and TikTok may rotate the
refresh token. The hourly cron (below) refreshes every profile token that expires within 6
hours. Live posting itself is M3.

## ScrapeCreators (TikTok data provider)

Resolves a TikTok video link to its author, caption, thumbnail and a short-lived media URL, and
searches videos by keyword (M3).

1. Create an account at scrapecreators.com and an API key.
2. Set `TIKTOK_DATA_PROVIDER=scrapecreators` (the default and only value today) and
   `TIKTOK_DATA_PROVIDER_KEY=<key>`.

Each video lookup costs 1 credit; each search page costs 1 credit (at most 3 pages per search).
Media URLs are signed and expire, so Trendcart never stores them. If a brand has a proxy enabled,
these calls go through it.

## Google Gemini

Product analysis watches the TikTok video (streamed to the Gemini Files API, which deletes it
automatically) or reads the product page, and stores only the JSON result.

1. Create a key in Google AI Studio and set `GEMINI_API_KEY`.
2. Default model `gemini-3.8-flash`; override with `AI_ANALYSIS_MODEL`. Defaults and prices are
   in `lib/ai/pricing.ts`.
3. `AI_MONTHLY_CAP_USD` (default 50) caps AI spend per workspace per month.
4. Time limit: one analysis (media download, Files API upload and processing, model call) stops
   after 210 s by default with a retryable error, so the workflow step ends cleanly instead of
   hitting the Vercel function limit. Thinking is set to `low`.

Workspace owners can override the analysis model, the copywriting model, the monthly AI budget
and both AI time limits (30 to 270 s) in **Settings** (`/app/settings`, table
`workspace_settings`). A saved value wins over the env var; an empty field uses it.

## SerpApi (supplier search, M2)

Finds listings of the identified product. It runs Google Lens on the analysis reference image
when there is one. It runs Google Shopping on the main keyword when there is no image, or when
Lens leaves fewer usable results than needed.

1. Create an account at serpapi.com and copy the API key to `SERPAPI_KEY`.
2. Cost: metered at $0.015 per search (Developer plan list price, checked 2026-10-31, in
   `lib/ai/pricing.ts`). A supplier search makes one or two searches.

## Firecrawl (listing extraction, M2)

Reads each kept listing page (title, price, shipping, delivery time, images, variants) with a
JSON scrape, 3 pages at a time. If a scrape fails, Trendcart falls back to the search-result
data when it has a price.

1. Create an account at firecrawl.dev and copy the API key to `FIRECRAWL_API_KEY`.
2. Cost: a JSON scrape is 5 credits, metered at about $0.005 (Standard plan list price, checked
   2026-10-31). Up to 5 listings are scraped per search by default.

Our servers only call `serpapi.com` and `api.firecrawl.dev`. They never fetch the listing pages
themselves. Calls go through the brand proxy when one is enabled, otherwise through the
SSRF-guarded client. Listing URLs and images must be public `http(s)` URLs. SerpApi and
Firecrawl costs are recorded in `usage_monthly` with the AI costs.

## Anthropic Claude (page copy, M2)

Writes the product page in the brand language: title, description, highlights, FAQ, guarantee,
ad texts and SEO.

1. Create a key in the Anthropic Console and set `ANTHROPIC_API_KEY`. Prefer a key created inside
   a workspace. A key that is not scoped to a workspace also needs `ANTHROPIC_WORKSPACE_ID`
   (sent as the `anthropic-workspace-id` header), or Anthropic answers 400.
2. Default model `claude-opus-5-5`. Override it with `AI_COPYWRITING_MODEL`. Prices are in
   `lib/ai/pricing.ts`. An unknown model is counted at a deliberately high fallback price.
3. Copy that breaks the copy-safety rules is regenerated once, then the call fails (see
   [operations.md](operations.md#copy-safety-rules)). Calls go to Anthropic directly, not
   through the brand proxy.

## Vercel Workflow (durable pipeline, M2)

No account or key. `workflow@5.2.3` is wired through `withWorkflow` in `next.config.ts`, and
`pnpm build` compiles the steps. On Vercel, leave `PIPELINE_ENGINE` unset (it defaults to
`workflow`). Off Vercel, use `PIPELINE_ENGINE=inline`. Details in
[operations.md](operations.md#pipeline-engine-pipeline_engine).

## Upstash Redis

Create a Redis database at upstash.com and set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Used for sign-in/sign-up/2FA rate limits, the import and rebuild
rate limits, TikTok API rate limits and the token refresh lock. Without it each server instance keeps its own
in-memory counters, which is fine locally but not on Vercel.

## Vercel Cron

`vercel.json` declares one cron:

```json
{ "crons": [{ "path": "/api/cron/tiktok-token-refresh", "schedule": "15 * * * *" }] }
```

Set `CRON_SECRET` in the Vercel project (for example `openssl rand -base64 32`). Vercel sends it
as `Authorization: Bearer <CRON_SECRET>`; the route returns 401 for anything else, and for every
request when `CRON_SECRET` is unset. Manual run:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/tiktok-token-refresh
```

The response is a JSON summary: `scanned`, `refreshed`, `revoked`, `failed`, `skipped`.
