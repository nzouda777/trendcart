# Operations runbook (M1 and M2)

For the provider accounts behind these variables, see [integrations.md](integrations.md). For
local development, see [setup.md](setup.md).

## Deploy checklist (Vercel)

1. **Run `pnpm db:migrate` against the target Neon database before every deploy**, with
   `DATABASE_URL` set to that database. Vercel does not run migrations for you. M2 adds
   migrations `0001` to `0003`. If you deploy without them, the dashboard fails with
   `Failed query: select ... "page_copy" ... from "product"` (see "Troubleshooting").
2. Check that the variables below are set for the environment.
3. Deploy.

## Production environment checklist (Vercel)

Set these in the Vercel project for the Production environment:

| Variable                                                  | Notes                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `INTEGRATIONS_MODE=live`                                  | **Required.** When `VERCEL_ENV=production`, the app throws if it is unset or `mock`.                          |
| `NEXT_PUBLIC_SITE_URL`                                    | Production origin, no trailing slash. All OAuth redirect URLs are built from it.                              |
| `DATABASE_URL`                                            | Neon pooled connection string. `pglite:` URLs are refused in production. Run `pnpm db:migrate` before deploy. |
| `BETTER_AUTH_SECRET`                                      | 32+ random characters. Rotating it signs everyone out.                                                        |
| `BETTER_AUTH_URL`                                         | Only if auth runs on a different origin than `NEXT_PUBLIC_SITE_URL` (e.g. previews).                          |
| `ENCRYPTION_KEY`                                          | AES-256-GCM keyring (see "Key rotation").                                                                     |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`                   | Public app credentials. `SHOPIFY_API_VERSION` optional (default `2026-10`).                                   |
| `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_SANDBOX`    | `TIKTOK_SANDBOX` defaults to `true`; set `false` only for real ad accounts.                                   |
| `TIKTOK_LOGIN_CLIENT_KEY`, `TIKTOK_LOGIN_CLIENT_SECRET`   | Login Kit app.                                                                                                |
| `TIKTOK_POSTING_AUDITED`                                  | `false` until TikTok approves the Content Posting audit.                                                      |
| `TIKTOK_DATA_PROVIDER`, `TIKTOK_DATA_PROVIDER_KEY`        | `scrapecreators` and its key.                                                                                 |
| `GEMINI_API_KEY`                                          | Product analysis.                                                                                             |
| `ANTHROPIC_API_KEY`                                       | Page copywriter (Claude). `AI_COPYWRITING_MODEL` optional (default `claude-opus-5-5`).                        |
| `SERPAPI_KEY`, `FIRECRAWL_API_KEY`                        | Supplier search (Google Lens and Shopping) and listing extraction.                                            |
| `PIPELINE_ENGINE`                                         | Leave unset on Vercel (defaults to `workflow`). See "Pipeline engine".                                        |
| `AI_MONTHLY_CAP_USD`, `IMPORT_RATE_LIMIT_PER_HOUR`        | Optional (defaults 50 and 20).                                                                                |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`      | Strongly recommended: without them every serverless instance keeps its own rate-limit counters.               |
| `CRON_SECRET`                                             | Required for the cron; without it the cron route returns 401.                                                 |

Do not set `TIKTOK_POSTING_AUDITED=true` before the audit is approved.

**Email (Resend).** In live mode verification and invitation emails are sent through the
Resend API (`RESEND_API_KEY`, `MAIL_FROM` on a domain verified in Resend). A missing key or
sender, or a Resend error, makes the sign-up or invite fail with an error rather than silently
dropping the email. In mock mode the links are printed to the server log instead. Password
reset is not implemented yet.

## Crons

| Path                               | Schedule                     | What it does                                                                                                                       |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/api/cron/tiktok-token-refresh`   | `15 * * * *` (hourly, at :15) | Refreshes TikTok profile tokens that expire within 6 hours, up to 100 per run, each under a short lock so two runs never rotate the same token. |

Vercel sends `Authorization: Bearer $CRON_SECRET`. Check the run in Vercel's Cron logs; the
JSON response counts `scanned`, `refreshed`, `revoked`, `failed`, `skipped`. `failed` rows hit a
temporary error and are retried on the next run. TikTok Ads tokens are long-lived and not
refreshed by this cron.

## Key rotation (`ENCRYPTION_KEY`)

Encrypted columns: Shopify access token bundle and custom app client secret, TikTok access and
refresh tokens, proxy URLs. Each value is stored as `tc1.<keyVersion>.<iv>.<tag>.<ciphertext>`
and bound to its row and column (AAD `<table>:<rowId>:<column>`).

`ENCRYPTION_KEY` is either a single base64 (or 64-hex) 32-byte key, or a keyring
`"<version>:<key>,<version>:<key>"` where the **first entry is the active key**.

To rotate:

1. Generate a new key:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Prepend it with a higher version, keeping the old one: `ENCRYPTION_KEY=2:<new>,1:<old>`.
   (A single bare key counts as version 1.)
3. Redeploy. New writes use version 2; existing rows still decrypt with version 1.
4. Keep the old key in the keyring. There is no bulk re-encryption job yet (the cipher has
   `rotate()`/`needsRotation()`, but nothing runs them); values move to the new key only when
   they are rewritten, for example on token refresh or reconnect. Removing an old version makes
   every row written with it undecryptable: the affected connections must be reconnected.

## Rate limits

| What                         | Limit                                                                                                 | Where                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| Sign-in                      | 5 / 60 s per client IP                                                                                | `lib/auth/rate-limit.ts`       |
| Sign-up                      | 3 / 60 s                                                                                              | same                           |
| Two-factor                   | 5 / 60 s                                                                                              | same                           |
| Send verification email      | 3 / 300 s                                                                                             | same                           |
| Request password reset       | 3 / 300 s                                                                                             | same                           |
| Invite member                | 10 / 60 s                                                                                             | same                           |
| Other auth endpoints         | 100 / 60 s                                                                                            | same                           |
| New product imports          | `IMPORT_RATE_LIMIT_PER_HOUR` (default 20) per workspace, sliding hour. Re-importing a known link is free. | `lib/services/rate-limit.ts` |
| Paid rebuilds (M2)           | 10 per product **and** 60 per workspace, sliding hour. Counts Gate 2 "None of these", Gate 3 reject and regenerate. Constants, not env. | `lib/services/rate-limit.ts` (`REBUILDS_PER_PRODUCT_PER_HOUR`, `REBUILDS_PER_WORKSPACE_PER_HOUR`) |

All of them use Upstash when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set, otherwise per-process
memory. Users who hit the import limit see "Too many imports in a short time".

The rebuild limits run after the gate check, so an action that is refused for another reason
(wrong status, wrong workspace) does not use the quota. A user who hits one gets
`rate_limited` ("This product was rebuilt 10 times in the last hour..." or "This workspace
reached its hourly limit of 60 rebuilds..."), and the dialog shows **Try again later**. Edits,
approvals and quotes are not limited. They sit on top of the monthly AI cap, which still
applies.

## AI monthly cap

Every AI call is metered per workspace into `usage_monthly`. Before each call, if the workspace
already spent `AI_MONTHLY_CAP_USD` (default 50, UTC calendar month), the call fails with
`quota_exceeded` ("Monthly AI budget reached"), and the step shows as failed with a retry button.
A call already in flight is recorded even if it pushes the total past the cap. `0` blocks all AI
calls. The cap is global for now; a per-workspace override is an open question.

## Connection failures

Connection statuses: `active`, `pending`, `expiring`, `needs_reauth`, `revoked`,
`disconnected` (`expiring` and `revoked` were added in M2, migration `0002`). The Connections
screen shows them as green (active), orange (pending, expiring, or token expiring within 24 h)
and red (`needs_reauth`, `revoked`, `disconnected`, or active without a token). Gate 2 accepts
`active` and `expiring` stores only.

| Event                                                     | What Trendcart does                                                                                                                                                 | What to do                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Shopify `app/uninstalled` webhook                         | HMAC verified, then every matching connection for that shop is set to `disconnected`, its token and scopes erased, and an audit entry written. Idempotent.        | Reconnect from Connections if it was a mistake. |
| Shopify `shop/redact` (48 h after uninstall)              | Same as above, and the custom app client secret is erased too.                                                                                                     | None.                                          |
| Shopify `customers/data_request`, `customers/redact`      | Acknowledged with 200: Trendcart requests no customer scopes and stores no customer data.                                                                          | None.                                          |
| Shopify token refresh fails (expired or revoked)          | Connection set to `needs_reauth` (red); the calling step fails with "reconnect the store".                                                                          | Click **Reconnect**, then retry the step.     |
| TikTok profile refresh rejected (invalid or revoked grant) | Connection set to `needs_reauth`, audit entry `connection.update`.                                                                                                | Click **Reconnect** on the profile.           |
| TikTok profile refresh, temporary error                   | Left unchanged, retried on the next hourly run.                                                                                                                     | Only if it keeps failing.                     |
| Webhook with a bad or missing signature                   | 401, nothing read or written.                                                                                                                                       | None.                                          |

## Retrying a failed product step

Steps retry transient errors automatically with backoff. When a step still fails, the product
moves to `failed` and the error is stored on its `job`. Anyone with Creative or higher can click
**Retry step** on the product page. A product stuck in a running status (queued, or interrupted)
shows **Resume**. Steps are idempotent, so retrying is safe.

Steps in M2: `analyze` (import to Gate 1), `source` (Gate 1 to Gate 2: SerpApi and Firecrawl)
and `build` (Gate 2 to Gate 3: Claude copy, then the Shopify draft). The `build` step fails,
retryably, when the copy trips the copy-safety guard. Unsafe copy is never stored or pushed, and
the retry pays for a new copy. If the step fails after the copy was stored (for example, a
Shopify error), the retry reuses the stored copy and only redoes the Shopify calls.

## Pipeline engine (`PIPELINE_ENGINE`)

| Value | Where | Behaviour |
| --- | --- | --- |
| `workflow` | Default when `VERCEL=1`. **Only supported on Vercel.** | Vercel Workflow (`workflow@5.2.3`). One durable run per product. It waits on a hook at each gate (`tc:gate:<workspace>:<product>:<gate>`) and on a resume hook after a failure. Engine retries: 5 attempts, 30 s doubling up to 10 min |
| `inline` | Default elsewhere (local, PGlite, tests) | Steps run synchronously inside the service call that triggers them (import, gate decision, retry) |

Notes:

- The Workflow routes under `/.well-known/workflow/v1/**` are generated at build time and
  git-ignored. The `flow` route relies on Vercel Queue authentication, which is why `workflow`
  is not supported off Vercel.
- The public route `/.well-known/workflow/v1/webhook/[token]` only resumes webhooks, and
  Trendcart does not use any (it uses hooks). The route still logs a `console.error` for every
  unknown token, so scanners can add noise to the logs. Filter those lines, or add a 404 rewrite
  (open question N4).
- Hooks carry ids only, and every run re-reads the product status, so a forged wake-up cannot
  skip a gate.
- Use one engine per environment. Switching engines while products are mid-pipeline has not
  been tested.

## Gate 3 publishing: claims, takeover and revert

`approvePage` (`lib/services/pipeline.ts`) publishes in three phases:

1. **Claim** (one transaction, product row locked): the product is at Gate 3, the page part is
   open, and the stored copy matches the `copyVersion` the reviewer saw (`pageCopyVersion`, the
   first 16 hex characters of a sha256 over canonical JSON). An `approval` row is inserted with
   `payload.state = "publishing"`. From then on, approve, reject, regenerate and edit are refused
   with "The page is being published".
2. **Publish** (outside any transaction): sync the Shopify draft, then `publishProduct` (ACTIVE
   and published on the Online Store channel).
3. **Record** (second transaction): `payload.state = "published"`, `shopify_product.status =
   active`, and audits `gate.approve` (with `copyVersion`) and `page.publish`.

**When phase 2 or 3 fails**, the service reverts if it still owns the claim:

- `unpublishProduct` sets the Shopify product back to DRAFT (`productUpdate`, idempotent).
- The approval is marked `state: "voided"`, `voidReason: "publish_failed"`. The row is kept as
  history. The page part reopens.
- `page.publish_revert` is audited with `approvalId`, `shopifyProductId`, `reverted`
  (true when the store holds no live page), `error` (an error **code**, never a message) and,
  if the DRAFT call itself failed, `revertError`.

If `reverted` is `false`, the product may still be ACTIVE on Shopify with no approval in
Trendcart. Set it to draft in the Shopify admin by hand (the audit entry has the product id),
then have the reviewer approve again.

**Stuck claims (5-minute takeover).** If the process dies between phase 1 and phase 3 (for
example, a function timeout), the approval stays in `publishing` and the screen shows
"Publishing to Shopify…". After **5 minutes** (`STALE_PUBLISH_CLAIM_MS`), the next
`approvePage` call voids it (`voidReason: "stale_claim"`) and takes over. The sync and publish
are idempotent, so the re-run is safe.

Known gap: the UI disables every page action while the part is `publishing`, so it cannot
offer the takeover yet (M3: expose the claim time in the DTO). The takeover only happens when
`approvePage` is called again, and there is no supported screen or script for that today.
Until M3:

1. Find the latest `content_approval` row for the product. Check whether `payload.state` has
   been `publishing` for more than 5 minutes (`created_at`).
2. Check the product in the Shopify admin. If it is ACTIVE but Trendcart has no `published`
   approval, set it back to draft so that nothing stays live without a recorded approval.
3. Escalate to a developer to re-run `approvePage` with the reviewer's context and the current
   `copyVersion`.

Do not edit approval rows by hand.

**Audit actions added in M2:** `page.update` (field names only, never the copy),
`page.publish`, `page.publish_revert`. Gate decisions keep using `gate.approve` and
`gate.reject` (with `part: "page"` and `kind` for Gate 3). Every decision carries a monotonic
`payload.seq` per product, so decisions written in the same instant still have a defined order.

## Copy-safety rules

| What | Where |
| --- | --- |
| Claim rules (`findUnsafeClaims`): reviews and ratings, customer counts, endorsements, popularity, superlatives, health and certification, absolute guarantees, urgency, prices and discounts, URLs and emails. Patterns cover English, French, German and Spanish | `lib/ai/copy-safety.ts` (`RULES`) |
| Description HTML allowlist (`sanitizeDescriptionHtml`): `p ul ol li h2 h3 h4 strong em b i br`, no attributes | same file |
| Live copywriter: one regeneration with the findings, then failure | `lib/ai/copywriter-live.ts` |
| Build step guard (unsafe copy fails the step, retryable) | `lib/workflows/steps/build.ts` (`assertSafeCopy`) |
| Human edits: sanitised, then refused with `invalid_input` naming field and rule; no override | `lib/services/pipeline.ts` (`updatePageCopy`) |
| Scraped variant option names and values: flagged ones dropped | `lib/workflows/page-input.ts` (`safeVariantGroups`) |
| Every Shopify draft input: description sanitised, every other field plain text, capped | `lib/integrations/shopify/product-input.ts` (`sanitizeDraftInput`) |

To change a rule, edit `RULES` and add cases to `lib/ai/copy-safety.test.ts`. A wider rule also
applies to edits, so tell reviewers.

## Troubleshooting

- **Dashboard error `Failed query: select ... "page_copy" ... from "product"`** (from
  `listProducts` in `app/(app)/app/page.tsx`): the database has not been migrated for M2. Run
  `pnpm db:migrate` with `DATABASE_URL` pointing at that database. No redeploy is needed.
- **"The page is being published. Try again in a moment."** for more than 5 minutes: a stuck
  claim. See "Stuck claims" above.
- **Supplier search fails with "`SERPAPI_KEY` is not set" or "`FIRECRAWL_API_KEY` is not
  set"**: the key is missing in live mode. Set it, redeploy, then click **Retry step** on the
  product.
- **Copy writing fails with "`ANTHROPIC_API_KEY` is not set"**: same fix.
- **Build step fails with "The page copy has unsafe claims"** more than once: the AI keeps
  writing a forbidden claim, often because of the listing text. Retry, or reject at Gate 2 and
  choose another listing.

## Security headers

`next.config.ts` sends on every route: a Content-Security-Policy with `frame-ancestors 'none'`,
`frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; plus
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`,
`Cross-Origin-Opener-Policy: same-origin`, and in production HSTS (2 years, subdomains) and
`upgrade-insecure-requests`. Trendcart therefore cannot be shown inside an iframe, including the
Shopify admin; the Shopify app is configured as non-embedded for that reason.

Other guarantees checked by QA in M1 (see [qa/milestone-1.md](qa/milestone-1.md)): every
business table is scoped by `workspace_id`; OAuth `state` is single-use, sealed in an httpOnly
cookie and bound to the user and workspace; Shopify HMACs are checked with constant-time
comparison; tokens and secrets never appear in responses or audit metadata.
