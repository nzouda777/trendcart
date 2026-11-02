# QA report: Milestone 1 (foundations and connections)

Scope: every commit in `b9ed32c..28e076f`. Mode: `INTEGRATIONS_MODE=mock`, no `DATABASE_URL`, no real credentials, no external calls.
Date: 2026-10-26. Reviewer: qa-reviewer.

## Verdict

**Code: PASS with 1 blocking hygiene fix. Demo: BLOCKED on environment** (needs a database, see B2).
Tenancy, encryption, HMAC, OAuth state, role checks and approval gates hold under the new isolation suite. The open findings are hardening items.

## 1. Baseline

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS (0 warnings) |
| `pnpm typecheck` | PASS |
| `pnpm test` (before QA tests) | PASS: 34 files, 343 tests (369 s) |
| QA tests added (`tests/**`) | PASS: 3 files, 33 passing, 4 expected-fail (open findings), 1 todo |
| `pnpm build` | PASS, but logs 2 error stack traces from our code (B1) |
| Playwright e2e | NOT RUN: Playwright isn't installed, and the flow needs a DB (B2). The same flow is covered at service level by `tests/integration/m1-demo-flow.test.ts` |
| Lighthouse (landing) | NOT RUN: no Lighthouse in the toolchain. The landing code didn't change in M1 |

## 2. Tenant isolation: PASS

- Every table in `lib/db/schema/business.ts` is in `businessTables`. Each has a NOT NULL `workspace_id` with an FK to `organization` and an index. Every reference between business tables uses a composite `(workspace_id, id)` FK. All of this is asserted in `tests/security/m1-security.test.ts`.
- `lib/db/client` is imported only by `lib/auth/session.ts`, `lib/tenant/members.ts` and `lib/tenant/system.ts`. Nothing under `app/(app)` or `components/**` imports `lib/db`, `lib/integrations`, `lib/crypto`, `lib/tenant/system`, `lib/workflows`, `lib/ai` or `lib/sourcing`. Every other access goes through `ctx.db`. The one raw `sql` fragment (`lib/ai/metering.ts:115`) runs inside a scoped upsert.
- `lib/tenant/system.ts` returns `{ workspaceId, connectionId }` only. Its callers are the Shopify webhook (after HMAC verification) and the cron (after the `CRON_SECRET` check).
- New suite `tests/isolation/m1-isolation.test.ts`: two workspaces, two owners, two stores from different Shopify accounts, both with the same mock advertiser. Workspace B calls 13 mutations and every read with A's ids. All return 404, never 403, and a snapshot of A is unchanged afterwards. B cannot finish an OAuth flow that A started, and neither can another member of A. A B-sealed flow carrying A's brand id is rejected. A verified `app/uninstalled` webhook only disconnects the matching shop.

## 3. Security review

| Item | Status |
| --- | --- |
| Shopify OAuth HMAC (sorted query, hex, timing-safe) and webhook HMAC (raw `request.text()`, base64, timing-safe, 401 before parsing) | PASS |
| OAuth state: 32-byte random value, sealed in an httpOnly cookie with AES-GCM and AAD, 10 min TTL, single use. Callbacks check it is bound to the same workspace and user | PASS (Shopify, TikTok Ads, TikTok Login) |
| `CRON_SECRET`: constant-time check, fails closed when unset (curl: 401) | PASS |
| AES-256-GCM with a versioned keyring. AAD is `<table>:<rowId>:<column>` on every `*_enc` write and read (Shopify token bundle and client secret, TikTok access and refresh tokens, proxy URL) | PASS |
| No secrets in DTOs, audit metadata (redacted by key) or client bundles. `.next/static` scanned: only the env-var *names* inside Better Auth's client code | PASS |
| `server-only` on sensitive modules | PASS, except N1 |
| Role check first in every exported service (asserted generically for system actors and viewers) | PASS |
| Audit entries for connection create/update/delete, proxy set/toggle/clear, GATE 1, budget, members | PASS |
| SSRF guards | PARTIAL (S2, S3, S4) |
| Open redirects | PARTIAL (S1). Callback redirects are fixed same-origin paths: PASS |
| Rate limits | PARTIAL (S5, S6) |
| Security headers | MISSING (S7) |

## 4. Approval gates: PASS

GATE 1 (`confirmProduct`) checks `gate:product_confirmation`. In one transaction it inserts the `approval` row, moves the status with an optimistic WHERE on the current status, and writes the audit entry. The state machine refuses `gate_approved` without a recorded approval. System actors never pass the guards. M1 has no handler after `analyze`, so the `source` job only queues. The TikTok Ads live `launchCampaign`/`createPausedCampaign` throw NotImplemented and are blocked under test. Posting is SELF_ONLY until `TIKTOK_POSTING_AUDITED`. The demo-flow test asserts zero `campaign`, `campaign_stats_hourly`, `shopify_product` and `tiktok_post` rows.

## 5. Video lifecycle: PASS

Only `tiktok_url`, author, thumbnail and filtered metadata are stored (`lib/media/candidates.ts`). The test dumps every business table after an import and finds neither the mock media URL nor a `mediaUrl` key. The schema has no media-URL columns.

## 6. App UI: PASS

Pages and actions call `lib/services` only. Controls are hidden by role (`can()`), and every service re-checks the role. Dates use a fixed `en-US` locale in UTC (`components/app/format.ts`), so there is no hydration risk. The proxy URL is write-only (only scheme and host are shown). Forms have labels.

## 7. M1 demo readiness: BLOCKED (environment)

Smoke test with `next start`, no DB:
- Landing, sign-in, sign-up, robots and sitemap: 200.
- `/app/*`: 307 to `/sign-in?next=...`.
- TikTok callbacks with a bad state: 303 `reason=invalid_state`.
- Cron: 401.
- Unsigned webhook: 401.
- Anything that needs a session or a DB lookup: Shopify install and callback, TikTok connect, signed webhooks, `/api/auth/*`. These give 500 or `error=unexpected` with "DATABASE_URL is not set".

## Findings

### BLOCKING

- **B1** `app/api/tiktok/ads/connect/route.ts:17`, `app/api/tiktok/login/connect/route.ts:22`, `app/api/tiktok/_lib/http.ts:50` (owner: tiktok-integration). The `try/catch` swallows Next's prerender bailout and `console.error`s it, so `pnpm build` prints two stack traces. This breaks the "no warnings" rule, and the same pattern would also swallow `redirect()`/`notFound()`. Fix: call `unstable_rethrow(error)` from `next/navigation` first in each catch, and in `failureRedirect`. Apply the same to the Shopify routes (`app/api/shopify/*/route.ts`).
- **B2** `lib/db/client.ts:19` (owner: foundation-engineer). The demo can't run without a database. Fix: set a Neon `DATABASE_URL`, `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` in `.env.local`, then run `pnpm db:migrate && pnpm db:seed`. The driver is neon-serverless over WebSocket, so a plain local Postgres won't work. Or add a dev-only PGlite fallback in `getDb()` when `DATABASE_URL` starts with `pglite:` and `NODE_ENV !== "production"`. In mock mode the verification email link is printed to the server console.

### SHOULD-FIX

- **S1** `lib/auth/paths.ts:20` (foundation-engineer). `safeNextPath("/\t/evil.example")` passes, and browsers strip `\t\n\r`, so it resolves to `//evil.example`. Better Auth's callbackURL check probably blocks it on sign-in and sign-up, but `components/auth/two-factor-form.tsx:37` calls `router.push(next)` with nothing behind it. Fix: reject any `[\u0000-\u001f\\]`, or `new URL(next, origin)` and require the same origin. Test: `it.fails` in `tests/security`.
- **S2** `lib/services/products.ts:62-71` (workflow-engineer). `importFromProductLink` validates with a plain `z.url()`, so `http://localhost:3000/...` is stored. The SSRF guard only runs at fetch time. `products.ts:52` also duplicates `normalizeProductUrl` with different dedupe rules. Fix: use `parseImportLink`/`normalizeProductUrl` from `lib/sourcing/links`. Test: `it.fails`.
- **S3** `lib/sourcing/links.ts:57-85`, `lib/ai/page-text.ts:95` (sourcing-ai). The guard checks hostnames only, so DNS names that resolve to private IPs (`127.0.0.1.nip.io`, rebinding) get through. Fix: an undici `connect.lookup` that rejects loopback, private, link-local and CGNAT addresses on every hop. Test: `it.todo`.
- **S4** `lib/services/brands.ts:48` vs `lib/integrations/tiktok-data/http.ts:49` (foundation-engineer / sourcing-ai). The settings accept `socks5h://` but `proxyKind` rejects it, so every proxied call for that brand fails. The settings also accept loopback and private proxy hosts. Fix: one shared scheme list, and reject IP-literal private hosts. Test: `it.fails`.
- **S5** `lib/auth/server.ts:69` (foundation-engineer). Better Auth rate limiting uses its in-memory default, which is per serverless instance. Fix: `rateLimit: { enabled: true, storage: "secondary-storage" }` with Upstash `secondaryStorage`, and stricter limits on `/sign-in/*`, `/two-factor/*` and `/sign-up/*`.
- **S6** `app/(app)/app/import/actions.ts:60`, `lib/services/products.ts:201` (workflow-engineer). Import has no per-workspace or per-user rate limit, and the analysis runs inline in the server action with no `maxDuration`. Fix: an Upstash limit in `importProduct`, plus `export const maxDuration` on the page. Moving to the durable engine (M2) removes the inline run.
- **S7** `next.config.ts:3` (foundation-engineer). No security headers are set (curl confirms). Approval buttons could be clickjacked. Fix: `headers()` with `Content-Security-Policy` (`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy`.
- **S8** `lib/integrations/index.ts:32`, `lib/auth/mail.ts:21` (foundation-engineer). Mode defaults to `mock` in production. That would make the publicly known `MOCK_SHOPIFY_API_SECRET` valid for webhooks and print verification links to logs. Fix: throw when `VERCEL_ENV === "production"` and `INTEGRATIONS_MODE` is unset or `mock`.

### NICE-TO-HAVE

- **N1** `lib/integrations/tiktok-data/live.ts:1` (sourcing-ai): add `import "server-only"`. `lib/tenant/context.ts` and `lib/crypto/cipher.ts` also lack it (foundation-engineer). Test: `it.fails`.
- **N2** `lib/integrations/shopify/webhooks.ts:80-98` (shopify-integration). On an unverified request it queries the DB and decrypts custom secrets for the claimed shop. Fix: cap the candidates, compare the body's `myshopify_domain` with the header, and dedupe on `X-Shopify-Webhook-Id`.
- **N3** `app/api/tiktok/_lib/http.ts:25` (tiktok-integration). Callback and redirect URLs use the request origin, while Shopify uses `NEXT_PUBLIC_SITE_URL` (`lib/integrations/shopify/http.ts:11`). Fix: use `publicOrigin()` everywhere so the registered redirect URIs match on preview and custom domains.
- **N4** `lib/services/connections.ts:241-343` vs `app/api/tiktok/_lib/connect.ts:51-196` (tiktok-integration / foundation-engineer). These are two TikTok persistence paths that disagree. The service moves an existing advertiser to the new brand; the route keeps it. The audit `targetType` is `tiktok_ads_connection` in one and `tiktok_ad_connection` in the other. Fix: keep one path (the routes call the service) and one targetType.
- **N5** `lib/domain/contracts.ts:427` (foundation-engineer). `tiktokVideoUrlSchema` accepts any tiktok.com URL, profiles included. Fix: use `parseImportLink` for the TikTok kind as well, so a non-video link fails fast instead of failing the analyze job.
- **N6** (sourcing-ai) TikTok thumbnail URLs are signed and expire. Product list thumbnails will break after a while. Re-resolve when showing them, or use the analysis `referenceImageUrl`.

## Tests added (tests/**)

- `tests/helpers/world.ts`: PGlite world with two tenants and every role, the real mock adapters, and mock Shopify/TikTok connect helpers.
- `tests/isolation/m1-isolation.test.ts`: cross-tenant reads, writes, OAuth replay, webhook scoping, system helpers (10 tests).
- `tests/integration/m1-demo-flow.test.ts`: M1 demo end to end. Also checks no media URL is persisted, the GATE 1 role check and approval record, audit coverage, and that nothing was launched (6 tests).
- `tests/security/m1-security.test.ts`: schema invariants, import boundaries, `server-only`, role-first on every service, open redirect, SSRF, proxy schemes. Open findings are `it.fails`/`it.todo`: flip them to `it` when fixed.
