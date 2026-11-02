# QA report: Milestone 2 (link to Shopify page)

Scope: every commit in `59e0993..2b36aa9` (SupplierFinder, margin and quote, Claude Copywriter and
copy-safety guard, Vercel Workflow and inline engines, analyze/source/build steps, GATE 2 and the
GATE 3 page part, Shopify draft/publish/media deletion/templates, product detail UI, migrations
0001-0003). Mode: `INTEGRATIONS_MODE=mock`, PGlite, inline engine, no real credentials, no
external calls. Date: 2026-11-01. Reviewer: qa-reviewer.

## Verdict

**Code: PASS with 1 blocking fix (B1). Demo: READY in mock mode** (covered end to end by
`tests/integration/m2-demo-flow.test.ts`).
Tenancy holds for every new service and table, every M2 service checks the role first, HMAC and
OAuth state are unchanged, and no secret reaches DTOs or audit metadata. B1 is a publish-ordering
race on GATE 3. The should-fix items are about page HTML and copy safety on human edits.

## 1. Baseline

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS (0 warnings) |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm test` | PASS: 52 files, 640 passing, 6 expected-fail, 1 todo (801 s). Vitest logs two "Timeout terminating forks worker" lines on teardown (team-usage, metering), which are harmless |
| QA tests added (`tests/**`) | 3 files, 47 tests: 40 passing, 6 expected-fail (open findings), 1 todo |
| `pnpm build` | PASS, no warnings (workflows compiled: 19 steps, 1 workflow) |
| Playwright e2e | NOT RUN: Playwright is still not in the toolchain (orchestrator: `package.json`). The flow is covered at service level by the demo-flow test |
| Lighthouse (landing) | NOT RUN: no Lighthouse in the toolchain. The landing code did not change in M2 |

## 2. Tenant isolation: PASS

- New suite `tests/isolation/m2-isolation.test.ts`: two workspaces, two owners, two stores from
  different Shopify accounts (one public app, one custom app), the same TikTok video imported in
  both, so the listing URLs collide. Products at GATE 2 and at GATE 3 in each.
- Workspace B calls every M2 service with A's ids: `getProductPipeline`, `listSuppliers`,
  `quoteSupplierChoice`, `selectSupplier` (also with B's own store), `rejectSuppliers`,
  `approvePage`, `rejectPage`, `regeneratePageCopy`, `updatePageCopy`, `listShopifyTemplates`,
  `setShopifyTemplate`. All return 404 for every B role, and a snapshot of A (products, suppliers,
  Shopify pages, stores, approvals, audits, jobs, usage) is unchanged.
- A's `supplierMatchId` or `shopifyConnectionId` inside B's own GATE 2 request is refused with the
  same code and message as a random id, so there is no existence oracle (see N1 on the status code).
- Scoped DB: B cannot `getById`, update or delete A's `supplier_match`, `shopify_product` or
  `approval` rows. Upserting a listing on A's product id from B fails on the composite tenant FK.
- Workflow internals (`runProductStep` for source and build, `loadChosenSupplier`,
  `loadCopyHint`, `getShopifyCredentialsFor`) run with B's system context cannot reach A's rows.
  Durable hook tokens include the workspace id.
- Shopify calls: every recorded adapter call for a workspace went to that workspace's shop
  domain. B's publish only touched B's store, and A's draft stayed a draft.
- Schema: migrations 0001-0003 only add columns (`page_copy`, `page_copy_generated_at`, token
  expiry columns, Shopify URLs) and enum values. The M1 schema invariants (workspace_id, composite
  FKs, `_enc` naming) still pass in `tests/security/m1-security.test.ts`.

## 3. Approval gates

| Gate | Role check | Approval row | Audit | Status move | Re-decision |
| --- | --- | --- | --- | --- | --- |
| GATE 2 select | `gate:supplier_choice` (viewer and system refused) | `supplier_choice` / approved, payload with listing, store, prices, margin | `gate.approve` | same transaction, optimistic | refused (`invalid_state`) |
| GATE 2 reject | same | rejected, payload with rejected URLs | `gate.reject` | → sourcing, search runs again | n/a |
| GATE 3 edit | `gate:content_approval` | none (an edit is not an approval) | `page.update` with field names only | none | refused after approval |
| GATE 3 reject / regenerate | `gate:content_approval` | rejected, `part: page`, `kind` | `gate.reject` (the note is not copied) | → building, same Shopify draft | refused after approval |
| GATE 3 approve page | `gate:content_approval` + `page:publish` | approved, `part: page` | `gate.approve` + `page.publish` | stays at GATE 3 until videos (M3) | refused (`invalid_state`) |

The draft stays `DRAFT` on Shopify until the page approval. Re-runs update the same product
(idempotency key = Trendcart product id, one `shopify_product` row). Low-margin choices need
`acceptLowMargin`. Open issue: B1.

## 4. Security review

| Item | Status |
| --- | --- |
| Shopify GraphQL: every `gql()` call in `live.ts` passes a constant document, and runtime data only goes in variables. Hostile titles reach `productSet` variables verbatim. The only interpolation is the constant metafield-definition list | PASS |
| SSRF on supplier URLs: our servers only call `serpapi.com` and `api.firecrawl.dev` through the guarded or proxied client. Listing pages are fetched by Firecrawl, and Lens images by SerpApi. Listing URLs are canonicalised to public https (credentials, IP literals, localhost and metadata hosts rejected). Images are https on public hosts only (Shopify downloads them) | PASS |
| Prompt injection: scraped and analysis text is stripped of the `<product_data>` / `<reviewer_feedback>` delimiters and control characters, JSON-encoded, and the rules say data never overrides them. Output is schema-validated, sanitised and re-checked | PASS, with S2/S4 as defence-in-depth gaps |
| Copy-safety guard on AI copy: fake reviews, ratings, counts, popularity, superlatives, health claims, guarantees and urgency are regenerated once, then fail | PARTIAL (S3, S4) |
| Page preview in the app: sandboxed `srcdoc` iframe without `allow-scripts`, `no-referrer` | PASS |
| Role checks: the generic M1 test (system actors and viewers refused before any DB access) now covers every M2 export. `quoteSupplierChoice`, `getProductPipeline`, `listSuppliers` and `listShopifyTemplates` are read-only | PASS |
| HMAC and OAuth state: `webhooks.ts` and `install.ts` only changed to write and clear the new token columns. Verification code is unchanged | PASS |
| Encryption: refresh tokens get their own `_enc` column with their own AAD. Disconnect and uninstall clear all four token columns | PASS |
| Secrets in DTOs, audit metadata and approval payloads (dump scanned for `shpat_`, `shprt_`, `tc1.`, `accessToken`, `refreshToken`, `Enc"`) | PASS |
| Workflow routes: `app/.well-known/workflow/v1/**` is generated and git-ignored. The public `webhook/[token]` route only resumes `createWebhook()` hooks (checked in `@workflow/core` 5.2.3 `resume-hook.js`, `notFoundReasons: not-webhook`), and the code only uses `createHook()`. Hooks carry ids only, and the run re-reads the status, so a forged wake-up cannot skip a gate | PASS (N4) |
| Rate limits on paid actions | PARTIAL (S5) |
| No media persistence: full dump of every business table after the M2 flow has no provider media URL and no `mediaUrl` key. `shopify_media_id`, `shopify_file_url` and `spark_code_enc` are null, and no video was uploaded | PASS |
| Nothing launched: no campaign, stats, post, `prepare_campaign`/`launch` job or `preparing_campaign` status | PASS |

## Findings

### BLOCKING

- **B1** `lib/services/pipeline.ts:550-560` (owner: workflow-engineer). `approvePage` syncs and
  **publishes on Shopify before** its transaction re-checks the gate (`publishProduct` at :556,
  `assertPageOpen(tx, …)` at :560). If another member rejects or regenerates the page in that
  window, the transaction throws, but the product is already ACTIVE on the store. There is no
  approval row, the DB still says `draft`, and the next build pushes new, unreviewed AI copy into
  the live product. This breaks "nothing publishes without a recorded human approval". The
  window is about two Shopify calls, and the durable engine makes it reachable (the rejection
  returns at once). A related gap: the approval carries no copy version, so a reviewer can
  approve a copy that someone edited after they loaded the screen. Fix:
  1. Take `expectedCopyAt` (`pageCopyGeneratedAt`, or a hash of `pageCopy`) from the UI. In a
     first transaction, claim the gate: re-check status, page part and copy version, then insert
     the approval (or a `publishing` marker) and update with an optimistic WHERE.
  2. Publish after the claim. On Shopify failure, record it so the approval is retried or
     reverted.
  3. Alternatively, if the final transaction fails, revert with `productUpdate(status: DRAFT)`.

  `updatePageCopy` should bump the version. Test: `it.fails` + `it.todo` in
  `tests/security/m2-security.test.ts`.

### SHOULD-FIX

- **S1** `lib/services/pipeline.ts:723`, `lib/integrations/shopify/product-input.ts:326` (owners:
  workflow-engineer, shopify-integration). Human copy edits are not sanitised.
  `updatePageCopy` stores `descriptionHtml` as typed and sends it to Shopify, so a `creative` can
  put `<script>` or `onerror=` on the merchant's storefront. Only the live copywriter calls
  `sanitizeDescriptionHtml`. Fix: sanitise in `updatePageCopy` and, as defence in depth, in
  `draftProductInputFromPageCopy` (every path to Shopify). Test: `it.fails`.
- **S2** `lib/ai/copy-safety.ts:113` (sourcing-ai). The sanitizer keeps an unterminated trailing
  tag. `"<p>Nice</p><img src=x onerror=alert(1) x="` comes out unchanged, because the generic tag
  regex needs a closing `>` and the final `<(?![a-z/!])` escape skips `<i`. On the storefront, the
  theme's next `>` closes the tag and the handler runs. This is reachable from a prompt-injected
  listing. Fix: escape every `<` that does not start an allowed tag (tokenise, or use a real
  sanitizer such as `sanitize-html` with an allowlist), and add this case to the tests. Test:
  `it.fails`.
- **S3** `lib/services/pipeline.ts:723`, `lib/workflows/steps/build.ts:143` (workflow-engineer).
  `findUnsafeClaims` only runs inside `copywriter-live.ts`. Human edits ("Rated 4.9 out of 5",
  "10,000 customers") and any future copywriter or fallback skip it, and those ad texts feed M3
  ads. Fix: run the guard in the build step and in `updatePageCopy`. Refuse with `invalid_input`
  listing the fields, or require an explicit `acceptClaims` that is audited. Test: `it.fails`.
- **S4** `lib/ai/copy-safety.ts:14-47` (sourcing-ai). Common phrasings get past the guard:
  `4.9★`, `10,000+ shoppers`, `thousands of happy customers`, `1 million sold`,
  `trusted by 50k families`, `dermatologist recommended`. Prices and discounts (`50% off`) and
  URLs or emails also get through, although the prompt forbids them. Fix: add `★`, spelled-out
  quantities (thousands, millions), shoppers/families/fans/members, "trusted by", "recommended",
  `%\s*off`, and URL/email patterns. Test: `it.fails` listing the phrases.
- **S5** `lib/services/pipeline.ts:454,681,691` (workflow-engineer). `rejectSuppliers`,
  `rejectPage` and `regeneratePageCopy` each trigger paid calls (SerpApi + Firecrawl, or a
  Claude Opus call with up to 16k output tokens). The only limit is the monthly AI cap, so one
  `creative` can burn the month's budget in minutes. Fix: an Upstash limit per workspace and
  product, like the import limit (for example 10 rebuilds per product per hour).
- **S6** `lib/workflows/steps/source.ts:72-90`, `lib/services/pipeline.ts:468-475`
  (sourcing-ai / workflow-engineer). "None of these" records the rejected URLs, but the next
  search is not told about them, so it returns the same listings (confirmed in mock mode). Fix:
  pass `excludeUrls` (from the latest GATE 2 rejection payloads) to `SupplierFinder.find`
  (contract change: orchestrator), or filter them before the upsert. Test: `it.fails`.
- **S7** `lib/services/pipeline.ts:324-331` (workflow-engineer). GATE 2 only accepts `active`
  stores, while `0ba1603` lets `expiring` connections keep using their token. A store about to
  expire blocks the gate with "needs to be reconnected". Fix: accept `active` and `expiring`, and
  keep the orange health warning in the UI.

### NICE-TO-HAVE

- **N1** `lib/services/pipeline.ts:256,328,341` (workflow-engineer). A foreign or unknown
  `supplierMatchId` or `shopifyConnectionId` gives `invalid_input` (400), while a foreign
  `productId` gives 404. There is no oracle (same message for both), but use `not_found` for
  consistency with the M1 "404, never 403" rule.
- **N2** `lib/domain/contracts.ts:560` (orchestrator). `supplierListingSchema.url` is `z.url()`,
  which accepts `javascript:`, `data:` and `ftp:` (checked). Live URLs are forced to https by `canonicalListingUrl`, and React
  blocks `javascript:` hrefs, but `upsertSupplierListing` is documented for manual entries. Fix:
  require `https:` in the schema (and for `images`).
- **N3** `lib/services/connections.ts:418` (workflow-engineer). `listShopifyTemplates` is open to
  viewers and makes Shopify calls (and can refresh the token) on every call, with no cache.
  Fix: a short cache per connection, or `connection:update`.
- **N4** (orchestrator / docs-writer). The Workflow `flow` route trusts Vercel Queue
  authentication. Document that `PIPELINE_ENGINE=workflow` is only supported on Vercel. The
  generated webhook route `console.error`s on every unknown token, so a scanner can flood the
  logs. Consider a 404 rewrite for `/.well-known/workflow/v1/webhook/*` while no webhook is used.
- **N5** `lib/workflows/gate-payloads.ts:45,74` (workflow-engineer). The latest decision per part
  is ordered by `createdAt` and then random `id`. Two decisions in the same microsecond resolve
  at random. Fix: a monotonic sequence, or use the approval id from the status transition.
- **N6** `lib/integrations/shopify/product-input.ts` (shopify-integration). Variant option names
  and values from scraped listings go to Shopify without the copy guard (capped at 60/80 chars).
  Run `findUnsafeClaims` on them, or show them in the GATE 3 review.
- **N7** `components/app/product/page-review.tsx:219` (app-ui). The sandbox is right today. Add a
  comment that `allow-scripts` must never be combined with `allow-same-origin` here.

## Tests added (tests/**)

- `tests/helpers/m2.ts`: `recordShopify` (wraps the mock Shopify adapter, records each call with
  its shop domain, optional hooks to stage races), `toGate2`, `toGate3`.
- `tests/integration/m2-demo-flow.test.ts` (12 tests): M2 demo end to end. Covers GATE 2 quote,
  select (role checks, approval, audit, margin stored, re-decision refused), build (safe copy, one
  draft on the chosen store), copy edit (`page.update`), reject and regenerate (same draft),
  approve (`gate.approve` + `page.publish`, `shopify_product` active, page closed afterwards),
  and the GATE 2 rejection path. Also checks no media persistence, no secrets, nothing launched.
- `tests/isolation/m2-isolation.test.ts` (9 tests): every M2 service and table across two
  tenants, foreign ids smuggled into valid requests, scoped-db, workflow internals, hook tokens,
  Shopify call routing.
- `tests/security/m2-security.test.ts` (26 tests: 19 passing, 6 `it.fails`, 1 `it.todo`): GraphQL
  variables, supplier URL and image guards, prompt-injection delimiters, copy-safety coverage,
  sanitizer, server-only markers, Workflow routes and engine selection, and the B1/S1/S3/S6
  service checks. Flip each `it.fails` to `it` when its finding is fixed.
