# Trendcart

Trendcart is a platform for e-commerce operators that takes a TikTok post (or a product link) all the way to a ready-to-launch TikTok ad campaign. Inspired by runblitzads.com. Brand signature: **"From trend to cart."**

Full Phase 1 spec: [context.md](context.md). Multi-agent split: [docs/agents/PLAN.md](docs/agents/PLAN.md).

## Core workflow (later phases — do NOT build in Phase 1)

1. Import a TikTok video from a link, or find TikTok videos featuring a product.
2. AI identifies the product, finds matching listings online (images, prices, details), and computes the margin.
3. Generates a Shopify product page from the store's existing template (variants, prices, photos), created as a draft.
4. Collects videos of the same product and checks each one against TikTok ad rules.
5. Publishes selected videos to connected TikTok profiles (within TikTok's publishing permissions).
6. Creates the campaign, ad groups and ads in TikTok Ads Manager, all paused. Nothing launches without explicit human approval.
7. Supports custom product links and TikTok URLs supplied by the user.
8. Multi-tenant: multiple users per workspace with roles; multiple Shopify stores from different Shopify accounts, TikTok profiles and TikTok ad accounts, grouped by brand.
9. Optional proxy per brand/environment.
10. Uses Claude, ChatGPT, Gemini and Perplexity internally. An MCP server is planned AFTER v1, not now.

## Hard constraints (all phases)

- Stack: Next.js (App Router, TypeScript strict), Neon Postgres (Drizzle ORM), deployed on Vercel. Keep the project light.
- No persistent video storage on our side. Store only links, IDs and metadata. Approved videos are hosted on the target Shopify store as product media and on TikTok; candidate videos are never stored.
- Every business table will carry a `workspace_id`; all data access goes through a scoped data-access layer.
- Human approval gates before publishing a page, using a video, and launching a campaign.

## Phase 1 — marketing landing page (done)

- The landing is shipped. Its rules below still apply to the marketing site; Phase 2 (below) is the current phase.
- All landing copy, pricing, FAQ and nav links live in `content/landing.ts`. Brand name, tagline, URLs and socials live only in `config/site.ts`.
- Package manager: pnpm. Before committing: `pnpm lint` and `pnpm build` must pass with no warnings.
- Respect `prefers-reduced-motion`, keep keyboard navigation and visible focus, no hydration warnings.
- Copy: never invent customers, testimonials, user counts, revenue or performance stats. Brand names only as integrations, never implying endorsement.

## Phase 2 — Product build context

### Final v1 scope (client brief + BlitzAds, nothing more)

Included:
- Import a TikTok video from a link.
- Find other TikTok videos of the same product.
- AI product identification.
- Online listings with images, prices and details; margin calculation.
- Shopify product page from the store's existing template (variants, prices, media), created as a draft.
- Video compliance check against TikTok ad rules.
- Publishing to connected TikTok profiles.
- TikTok Ads campaign + ad groups + ads created PAUSED, launched only after human approval, with hourly stats.
- Custom product links and TikTok URLs.
- Multiple users per workspace with roles.
- Multiple Shopify stores from different Shopify accounts, TikTok profiles and ad accounts, grouped by brand.
- Optional proxy per brand.
- AI used internally: Claude, ChatGPT, Gemini, Perplexity.

Out of scope for v1: MCP server (planned after v1), PiPiAds, product scoring, automated likes, Meta/Snapchat ads.

### Architecture

- Next.js App Router (TypeScript strict) on Vercel Pro.
- Neon Postgres + Drizzle ORM (Neon serverless driver).
- Better Auth with the organization plugin: workspace = organization; roles `owner`, `media_buyer`, `creative`, `viewer`.
- Durable workflows: Vercel Workflow (Workflow DevKit). Verify its current status first; if it's not production-ready, use Inngest. Same step design either way.
- Vercel Cron, Upstash Redis (rate limits, locks), AI SDK (Claude, OpenAI, Gemini, Perplexity providers), Sentry.
- No Vercel Blob: we store no files.

Layers:
- `lib/domain/` — types, state machine and contracts.
- `lib/services/` — business actions as plain server functions. Pages and server actions call these, and the future MCP server will too.
- `lib/integrations/*` — adapters, each with a `live.ts` and a `mock.ts`, selected by `INTEGRATIONS_MODE=mock|live`.

### Tenancy and security rules

- Every business table has `workspace_id`. All reads and writes go through `lib/tenant/scoped-db.ts`, which injects the session's workspace. Never query business tables directly from pages.
- OAuth tokens, proxy credentials and Spark Ads codes are encrypted with AES-256-GCM (`lib/crypto`). Store a key version for rotation.
- Verify Shopify webhook and OAuth HMAC signatures, use OAuth `state` for TikTok, and check the role on every service call.
- Write an audit log entry for every sensitive action: approve, publish, launch, budget change, connection change.

### Video lifecycle (no storage on our side)

- **Candidates:** store only the TikTok URL, author, thumbnail URL and metadata. Resolve a fresh media URL just in time from the provider (provider URLs expire).
- **AI analysis:** stream the video to Gemini (Files API auto-expires) and store only the JSON result.
- **Approved video:** upload once to the target Shopify store as product media (staged upload, streamed). Store `shopify_media_id` and the file URL, and use that stable URL afterwards.
- **TikTok Ads:** upload by URL from the Shopify URL, then store the TikTok `video_id` per advertiser.
- **TikTok posting:** stream chunked upload from the Shopify URL. Posts stay private until TikTok's audit is passed.
- **Rejected or removed video:** delete its Shopify media.

### Product state machine

`imported → analyzing → awaiting_product_confirmation` **(GATE 1)**
`→ sourcing → awaiting_supplier_choice` **(GATE 2)**
`→ building_page_and_videos → awaiting_content_approval` **(GATE 3)**
`→ preparing_campaign → ready_to_launch` **(GATE 4)**
`→ launched`

Rules:
- Each step can enter `failed`, with retry.
- Gates only move forward through an explicit, role-checked approval recorded in `approval`.

### Data model (Drizzle)

Better Auth tables plus:

| Table | Key fields |
| --- | --- |
| `brand` | name, country, language, default_test_budget, min_margin, pricing_rule json |
| `proxy` | brand_id, url_enc, enabled |
| `shopify_connection` | brand_id, shop_domain, access_token_enc, scopes, app_mode `public`\|`custom`, client_id, client_secret_enc nullable, template_suffix, status |
| `tiktok_ad_connection` | brand_id, advertiser_id, name, access_token_enc, status |
| `tiktok_profile_connection` | brand_id, open_id, display_name, access_token_enc, refresh_token_enc, expires_at, posting_mode, status |
| `product` | brand_id, source_type, source_url, status, name, analysis json, selling_price, compare_at_price, margin json |
| `supplier_match` | product_id, source, url, title, price, shipping, lead_time, images json, selected |
| `video` | product_id, tiktok_url, author, thumbnail_url, origin, compliance json, approval, shopify_media_id, shopify_file_url, tiktok_video_ids json, spark_code_enc |
| `shopify_product` | product_id, connection_id, shopify_product_id, handle, status |
| `campaign` | product_id, ad_connection_id, tiktok ids json, config json, status |
| `campaign_stats_hourly` | campaign_id, hour, spend, impressions, clicks, conversions, revenue |
| `tiktok_post` | video_id, profile_connection_id, publish_id, status |
| `job` | product_id, step, status, attempts, error, ai_cost_usd, timestamps |
| `approval` | product_id, gate, user_id, decision, created_at |
| `audit_log` | — |
| `usage_monthly` | workspace_id, month, ai_cost_usd, api_calls |

All business tables also carry `workspace_id`.

### Environment variables

Document every variable in `.env.example`:
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`
- `INTEGRATIONS_MODE`
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_API_VERSION`
- `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_LOGIN_CLIENT_KEY`, `TIKTOK_LOGIN_CLIENT_SECRET`, `TIKTOK_SANDBOX`
- `TIKTOK_DATA_PROVIDER`, `TIKTOK_DATA_PROVIDER_KEY`
- `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`
- `SERPAPI_KEY`, `FIRECRAWL_API_KEY`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `SENTRY_DSN`, `CRON_SECRET`

### Conventions

- Official docs first: before implementing any external API, read its current official documentation and pin versions (latest stable Shopify Admin API version).
- Validate all inputs and outputs with zod; AI outputs use structured generation with zod schemas.
- Keep every workflow step idempotent and well under the Vercel function limit.
- Every service checks the caller's role and workspace.
