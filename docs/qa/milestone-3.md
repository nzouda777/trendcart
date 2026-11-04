# QA report: Milestone 3 (videos, ads, posting)

Scope: every commit in `f9f7c72..a5a17b5`, plus `f708203` (page-template builder, committed
before `f9f7c72` and never reviewed). That covers:

- the video lifecycle: related search, compliance, approve and upload to Shopify, reject and
  delete;
- GATE 3 videos, `prepare_campaign`, GATE 4 launch, campaign controls, the hourly stats cron and
  TikTok posting;
- the live TikTok Ads, TikTok Posting and Shopify video adapters;
- the M3 UI and server actions;
- the generated theme templates (`template-builder.ts`, `upsertProductTemplate`) and the sourcing
  value score and marketplaces.

Mode: `INTEGRATIONS_MODE=mock`, PGlite, inline engine, no real credentials, no external calls.
Date: 2026-11-04. Reviewer: qa-reviewer.

## Verdict

**Code: PASS for the mock demo, 1 blocking fix before live ads (B1). Demo: READY in mock mode.**
`tests/integration/m3-demo-flow.test.ts` covers it end to end: GATE 3 → paused campaign →
GATE 4 → launched → hourly stats → pause/resume → private post.

What holds:

- **Nothing spends without GATE 4.** Only `launchCampaign` (after a recorded GATE 4 approval)
  and `resumeCampaign` (on an already launched product) call `TikTokAdsClient.launchCampaign`.
  - Every live create is guarded `DISABLE` and read back.
  - A double click launches once.
  - A failed launch pauses again and needs a new approval.
- **No media is stored.** No provider media URL reaches a table, an audit entry, a DTO or a
  log.
- **Tenancy holds** for every new service, table and the cron scan.

B1: the campaign budget is sent in the brand's currency to an advertiser that may bill in
another currency, and GATE 4 shows the brand currency, so the human approves a figure that is not
what TikTok spends. Should-fix items: one role gap, the launch-failure message, compliance
reviews that rate nothing, and cron starvation.

## 1. Baseline

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS (`eslint --max-warnings=0`, 0 warnings) |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm exec vitest run` (before QA tests) | PASS: 70 files, 973 tests (465 s) |
| `pnpm exec vitest run` (with QA tests) | PASS: 73 files, 1009 passing + 6 expected-fail = 1015 tests (515 s) |
| QA tests added (`tests/**`) | 3 files + 1 helper, 42 tests: 36 passing, 6 expected-fail (open findings) |
| `pnpm build` | PASS, no warnings (workflows compiled: 19 steps, 1 workflow) |
| `prettier --check tests docs/qa` | PASS |
| Playwright e2e | NOT RUN: Playwright is still not in the toolchain (orchestrator: `package.json`). The flow is covered at service level by the demo-flow test |
| Lighthouse (landing) | NOT RUN: no Lighthouse in the toolchain. Nothing under `app/(marketing)`, `components/marketing`, `content/` or `config/` changed since `f708203^` |

## 2. Tenant isolation: PASS

- New suite `tests/isolation/m3-isolation.test.ts` sets up two workspaces with two stores from
  different Shopify accounts (one public app, one custom app). Each workspace has its own TikTok
  Ads accounts and TikTok profile, and the same TikTok video is imported in both.
  - A has a launched campaign with hourly stats and a TikTok post.
  - B has a product at GATE 3 (one video on its store) and a launched campaign.
- Workspace B calls every M3 service with A's ids, and every call returns 404 with no Shopify,
  TikTok Ads or Posting call. The services: `getProductPipeline`, `approveVideo`, `rejectVideo`,
  `approveVideos`, `addVideo`, `publishToProfile`, `refreshTikTokPosts`, `launchCampaign`,
  `pauseCampaign`, `resumeCampaign` and `updateCampaignBudget`.
  - A snapshot of A (products, videos, campaigns, stats, posts, approvals, audits, jobs,
    connections) is unchanged.
  - Roles without the permission get 403 before any lookup, for real and random ids alike, so
    there is no oracle.
- A's ids smuggled into B's own valid requests are refused with the same code and message as a
  random id: A's video on B's product, A's ad account at GATE 3, A's profile for a post. The same
  `invalid_input` (400) versus 404 nuance as M2 N1 applies.
- Scoped DB:
  - B cannot `getById`, update or delete A's `video`, `campaign`, `campaign_stats_hourly` or
    `tiktok_post`.
  - Composite tenant FKs refuse B's stats on A's campaign, B's post on A's video, and B's
    campaign on A's ad account.
- Internals: `getTikTokAdsCredentials` and `getTikTokProfileTokens` with B's system context
  cannot load A's tokens.
- Cron (`listLaunchedCampaigns`, `syncAllCampaignStats`):
  - The cross-workspace scan returns `{ workspaceId, campaignId }` only.
  - Each sync runs with a system context of the campaign's own workspace, and the stats rows
    land on the right campaign.
  - A forged ref (B's workspace, A's campaign) syncs nothing and calls nobody.
- `prepare_campaign` loads the GATE 3 ad account with `findById` (scoped) and re-checks
  `brandId`. `publishToProfile` checks that the profile belongs to the product's brand.

## 3. Approval gates and spending

| Action | Role check | Approval row | Audit | Notes |
| --- | --- | --- | --- | --- |
| Approve one video | `gate:content_approval` + `video:approve` | none (per-video decision on `video.approval`) | `video.approve` (after upload) | Claimed under the product lock, uploaded once (idempotency key = video id), reverted on failure |
| Reject one video | same | none | `video.reject` (+ `video.media_delete`) | Shopify media deleted; a failed deletion keeps the media id for a retry |
| GATE 3 videos part | same | `content_approval`, `part: videos`, video ids + ad account | `gate.approve` | Needs every approved video on Shopify; the ad account must be explicit when the brand has several. **S1** |
| `prepare_campaign` | system (step) | n/a | `campaign.create` | Videos uploaded by URL from Shopify, once per advertiser; campaign, ad group and ads created `DISABLE` |
| GATE 4 launch | `gate:launch` + `campaign:launch` (owner, media buyer) | `launch` / approved, with campaign id and budget | `gate.approve` + `campaign.launch` (launched or failed, with the approval id) | Claim + job under the product lock; double click refused; failure pauses again and fails the product; retry needs a new approval. **B1, S2** |
| Pause / resume | `campaign:pause` / `campaign:launch` | none | `campaign.pause` / `campaign.launch {resume: true}` | Launched products only |
| Budget change | `campaign:budget` | none | `campaign.budget_change` | No adapter implements `updateBudget` yet: always `precondition_failed` (open item) |
| Post to TikTok | `video:publish` | none | `video.publish` (submitted or failed) | Approved videos on Shopify only; `SELF_ONLY` while unaudited (service, mock and live); one post per (video, profile) |

Live TikTok Ads, checked by reading `lib/integrations/tiktok-ads/live.ts`:

- `assertCreatesDisabled` runs on every create body (`:504`).
- `createPausedCampaign` reuses a campaign only by its exact deterministic name, refuses one that
  is `ENABLE` or that has duplicates, then reads back every entity and disables everything if
  anything came out enabled (`:686-788`).
- `launchCampaign` is blocked under test unless the transport is an injected stub (`:793`). It
  checks that every id belongs to the campaign and enables bottom-up, with the campaign last.

## 4. Security review

| Item | Status |
| --- | --- |
| No persistent video storage. Candidates keep URL, author, thumbnail and metadata (`candidateVideoFields`, `assertNoMediaUrl`), and related-search output is re-parsed through the contract schema. A full dump of every business table, audits, approvals, DTO and console output after the demo has no provider media URL or media key. Rejected videos have no Shopify media left | PASS |
| Gemini Files: deleted in `finally` after the review | PASS (N7) |
| Shopify video upload: the source is streamed into a multipart staged upload with an exact length, never buffered whole. Size capped at 250 MB, 120 s transfer budget | PASS |
| SSRF on source fetches. The Shopify video source and the compliance media go through the guarded client (brand proxy, else the SSRF-guarded agent, redirect hops included). Internal URLs, credentials in the source and non-http schemes are refused (tests). The posting source fetch is not guarded (N2) | PASS (N2) |
| `CRON_SECRET`: constant-time compare, refused when unset, empty or wrong (tests) | PASS |
| Secrets: none in DTOs, audit metadata or approval payloads (scanned for Shopify, TikTok Ads and TikTok Login tokens, `tc1.` and `*Enc`) | PASS |
| Prompt injection in compliance. Caption and claims are delimited, and the `<ad_content>` tags and control characters are stripped. The keyword screen cannot be cleared by the model (worst verdict wins) | PARTIAL (S3) |
| Theme file writes: `upsertProductTemplate` only accepts `tc-[a-z0-9_-]` suffixes (path traversal and merchant templates refused before any call, live and mock). AI-planned settings are limited to fillable types (no `liquid` or `html`), and text is tag-stripped and escaped | PASS (N5, N6) |
| TikTok posting stays `SELF_ONLY` while unaudited: service, mock and live. `isPostingAudited` is false under test and in sandbox | PASS |
| Posting idempotency: a claim per (video, profile) under the product lock, plus a live 15 min lock per (token, source) | PASS (N10) |
| Server-only markers on every M3 server module. M3 client components import types only from `lib/services` | PASS |
| Role checks on every M3 service (the generic M1 role test also covers the new exports) | PASS, except S1 |

## 5. Idempotency and function limits

- **Build, videos part:**
  - Candidates are upserted on (product, URL) and searched once per product.
  - Each check is saved as soon as it is done. Batches are 8 per run, 3 at a time, and a
    retryable error asks for the rest.
  - Copy and template are stored before the Shopify sync, so a retry pays for nothing twice.
  - Worst case on one step: copy + template design + 3 waves of 120 s. That fits the Workflow
    "max" duration (800 s on Pro), but see N8 for `addVideo`.
- **`prepare_campaign`:**
  - A re-run after success makes no TikTok call (test).
  - A crash between `createPausedCampaign` and storing the ids re-runs with the same spec and
    reuses the same paused campaign, with no second video upload (test in mock; live reuses by
    exact name, see §3).
  - Videos are uploaded once per advertiser (`tiktok_video_ids`).
- **Launch:** the product lock plus a running `launch` job is the claim. It is taken over after
  5 min (`LEASE_TTL_MS`), which equals the page `maxDuration` (N14).

## 6. UI review

- **Roles:** controls are disabled with the reason when the role cannot act (videos, posting,
  launch, pause, resume, budget). Server actions re-check through the services.
- **Launch confirmation:**
  - The dialog states that spending starts, names the advertiser and lists budget, ceiling and
    countries.
  - The confirm button stays disabled until "I understand this starts spending" is checked.
  - The note is optional.
  - The figures use the brand currency (B1).
- **No invented data:** stats, totals and compliance come from the DTO. Empty states say "No
  stats yet".
- **Accessibility:**
  - Labelled articles, lists and dialogs, `aria-busy` on pending buttons, decorative icons
    `aria-hidden`.
  - The chart is decorative, with the same data in a table.
  - `motion-safe` spinners.
- **Hydration:** every date uses fixed `UTC` `Intl` formatters. Relative "synced" labels are
  computed on the server. No `Date.now()` or `Math.random()` in client renders.
- **Posting dialog:** the privacy level must be chosen. The commercial content disclosure is
  refused rather than dropped, but it cannot be sent yet (open item).

## Findings

### BLOCKING

- **B1** Budget currency (owners: tiktok-integration, foundation-engineer for the column,
  workflow-engineer, app-ui). This blocks live ads, not the mock demo.

  `lib/workflows/campaign-spec.ts:45,56` sends `brand.defaultTestBudget` (brand currency) as the
  TikTok budget amount, which TikTok reads in the advertiser's currency. The advertiser currency
  is returned by `listAdvertisers` but never stored: `tiktok_ad_connection`
  (`lib/db/schema/business.ts:269-281`) has no currency column. GATE 4 shows the budget and
  ceiling in `product.currency`, the brand currency (`app/(app)/app/products/[id]/page.tsx:809,837-838,849`).
  - A USD brand on a EUR ad account approves "$30/day" and spends €30/day.
  - A JPY brand (budget 5000) on a USD account would approve ¥5000 and spend $5000/day.

  The human approval no longer describes what is spent. Fix:
  1. Store `currency` (and `timezone`) on `tiktok_ad_connection` at connect (migration +
     `saveTikTokAdConnections`).
  2. In `approveVideos` (or `prepare_campaign`), refuse an account whose currency differs from
     the brand currency, or convert with an explicit, recorded rate.
  3. Add `currency` to `CampaignDTO` and the GATE 4 approval payload, and use it in the launch
     dialog and stats.

  Test: `it.fails` in `tests/security/m3-security.test.ts`.

### SHOULD-FIX

- **S1** `lib/services/videos.ts:332,358-387`, `lib/services/pipeline.ts:916-984` (owner:
  workflow-engineer; orchestrator to confirm the role matrix). A `creative` has no
  `campaign:create`, yet completing GATE 3 (`approveVideos`, or `approvePage` when the videos are
  already approved) picks the TikTok Ads account and creates the paused campaign on it.
  CLAUDE.md asks for the role on every service call. Nothing spends (GATE 4 stays owner/media
  buyer only), but a creative chooses which advertiser account receives campaigns. Fix:
  - require `campaign:create` for the ad-account choice and for the approval that completes
    GATE 3;
  - or move the account choice to a media buyer step before `prepare_campaign`;
  - or grant creatives `campaign:create` on purpose and document it.

  Test: `it.fails`.
- **S2** `lib/services/campaigns.ts:76-88,154-183`, `app/(app)/app/products/[id]/campaign-actions.ts:47-51`
  (owners: workflow-engineer, app-ui). After a failed launch the action always says "The campaign
  was paused again; nothing is spending." But `revertToPaused` is best effort and its result
  (`reverted`) only reaches the audit. If TikTok enabled part of the campaign and the pause also
  failed, the UI tells the user nothing is spending while the campaign row still says `paused`.
  Fix:
  - throw a `ServiceError` carrying `reverted`, and set the campaign `status: "failed"` (or an
    "unknown, check Ads Manager" state) when the revert failed;
  - word the message from that flag;
  - optionally retry the pause from the cron.
- **S3** `lib/compliance/live.ts:318-345` (owner: sourcing-ai). A model review that rates no
  category, or only some, still produces `overall: "pass"`. The skipped categories only appear as
  a sentence in `policy.ai_review`. A prompt injection in a creator's caption or in the video
  ("return an empty list") is enough, and that contradicts the header ("never silently passes a
  video without its policy review"). Fix: an unrated category becomes `warn` (or retry once, then
  throw retryable), and an empty `rules` array is an invalid review. Test: `it.fails`.
- **S4** `lib/tenant/system.ts:104`, `lib/services/internal/campaign-stats.ts:26,112-139`,
  `app/api/cron/tiktok-stats/route.ts` (owners: foundation-engineer, workflow-engineer,
  tiktok-integration). The hourly scan always takes the 100 oldest launched campaigns
  (`ORDER BY launched_at`), so past 100 the newest campaigns, which spend the most, never sync.
  The loop is also sequential with no deadline (about 3 to 5 TikTok calls per campaign) and the
  route sets no `maxDuration`. Fix:
  - order by last sync (a `stats_synced_at` column, or the max stats `updated_at`), oldest first;
  - stop starting campaigns after a time budget (for example 240 s);
  - export `maxDuration` on the route;
  - optionally fan out per workspace.

  Test: `it.fails`.

### NICE-TO-HAVE

- **N1** `lib/services/videos.ts:145` (workflow-engineer). The comment says a concurrent approve
  does nothing, but an approved video without `shopifyMediaId` passes the claim again, so two
  clicks upload twice. Live dedupes by marker (`findOwnVideo` keeps the oldest), so the result is
  correct, but the transfer runs twice and counts against Shopify's weekly video limit. Fix: treat
  "approved, no media, claimed less than N min ago" as in flight.
- **N2** `lib/integrations/tiktok-posting/upload.ts:42-80`, `live.ts:48-54` (tiktok-integration).
  The posting source HEAD and Range GETs use plain `fetch` on any `http(s)` URL. The URL is the
  stored Shopify file URL, so this is defence in depth. Fix: require `https:` and a Shopify CDN
  host (`cdn.shopify.com`), or use the guarded client. Test: `it.fails`.
- **N3** `lib/db/schema/business.ts:477-495` (foundation-engineer). `campaign` has no unique
  index on (workspace, product, ad connection). The step is check-before-insert only. Add one.
- **N4** `lib/integrations/tiktok-ads/mock.ts:144-150` (tiktok-integration). The mock reuses
  entities that are `ENABLE` silently, while live refuses an enabled campaign of the same name.
  Mirror the refusal so a test cannot pass on a state live rejects.
- **N5** `lib/integrations/shopify/template-builder.ts:283-299` (shopify-integration).
  AI-written text settings keep `{{ … }}` and `{% … %}`. JSON templates resolve dynamic sources,
  so a prompt-injected listing could make the page print store data such as metafields. Fix:
  strip Liquid delimiters in `settingValue` for text types. Test: `it.fails`.
- **N6** `lib/workflows/steps/build.ts:294`, `lib/integrations/shopify/live.ts:669-703`
  (workflow-engineer, shopify-integration). Generated templates are written to the published
  (MAIN) theme during the build, before the GATE 3 page approval. One
  `product.tc-<id>.json` per product accumulates and is never deleted. They are not visible on
  the storefront until a product uses them, but the theme editor shows them. Document it, and
  delete the file on product deletion or when the page is rejected for good.
- **N7** `lib/ai/gemini-files.ts:198-216` (sourcing-ai). A file that ends `FAILED`, or whose
  status poll errors, is not deleted. It auto-expires (CLAUDE.md allows this), but delete it best
  effort like the timeout path.
- **N8** `lib/services/videos.ts:490-501`, `lib/workflows/steps/videos.ts:55-56,240-247`
  (workflow-engineer). `addVideo` runs `checkVideos` inline in a server action
  (`maxDuration = 300`). Every due video is checked, up to 3 waves of 120 s. Check only the added
  video there, and give `checkVideos` a wall-clock budget.
- **N9** `lib/services/campaigns.ts:310-356` (workflow-engineer). `updateCampaignBudget` takes no
  product lock and does not refuse while a launch is in flight, so the GATE 4 approval payload
  can show a budget other than the one launched. Its only cap is 1,000,000 per day. Lock, refuse
  during a launch, and cap relative to the brand default (or require a confirmation above it).
- **N10** `lib/services/videos.ts:72,578-581` (workflow-engineer, tiktok-integration).
  `STALE_POST_CLAIM_MS` (5 min) is shorter than the live publish lock (15 min). A click after
  5 min marks the post failed ("already being published"), then the first run overwrites it.
  Align the two.
- **N11** `lib/services/campaigns.ts:241-297` (workflow-engineer). Pause and resume read the
  status outside a transaction with no lock. A concurrent pause and resume can leave the DB
  status out of step with TikTok. Lock the product and re-read the status.
- **N12** `lib/services/videos.ts:317,552`, `lib/services/internal/credentials.ts:91,108`
  (workflow-engineer). `approveVideos` and `publishToProfile` accept `expiring` connections, but
  the credential loaders require `active`. An expiring profile claims the post and then fails it.
  Same as M2 S7: accept both, or refuse up front.
- **N13** `lib/workflows/steps/videos.ts:83-90` (workflow-engineer). After a page regeneration,
  approved videos keep reports made against the old ad texts, and only pending videos are checked
  again. Re-check approved videos (report only) when `claimsVersion` changes, and flag the
  difference at GATE 3.
- **N14** `lib/services/campaign-read.ts:33` (workflow-engineer). The stale launch takeover
  (5 min) equals the page `maxDuration` (300 s). If the first launcher is still alive (with a
  longer limit), its failure path would pause a campaign the second launched. Make the lease
  longer than the function limit.

## Known open items (agents' questions, triaged)

| Agent | Item | QA triage |
| --- | --- | --- |
| tiktok-integration | `CampaignSpec` needs an optional `schedule.endAt` for total budgets | Needed before offering total budgets. Daily only today, so not blocking |
| tiktok-integration | Ad `videoId` optional for a Spark identity | Needed with Spark wiring (below). Contract change: orchestrator |
| tiktok-integration | `publishVideoFromUrl` input `videoDurationSec` | Recommended: live checks `max_video_post_duration_sec` from creator info. Without the duration, a too-long video fails at TikTok after the transfer. The data is in `video.metadata.durationSec` |
| tiktok-integration | Adapter `updateBudget` missing (live + mock) | Confirmed: the budget change is always `precondition_failed`, and the UI marks it unavailable. Implement it with N9 |
| workflow-engineer | Budget currency (brand vs advertiser) | **B1** |
| workflow-engineer | Duplicate campaign after a crash between `createPausedCampaign` and storing the ids | Verified: live reuses by exact name (refuses enabled or duplicate names), mock returns the same ids, and the step re-run keeps one row and one upload (test). Add N3 |
| workflow-engineer | Page rebuild `productSet` vs attached videos | Verified: `draftProductInput` keeps media it did not create (videos included) by id. See N13 for the reports |
| workflow-engineer | No "find more videos" / "reject videos part" | Product gap, not a defect. A user can add videos by URL. Plan for M4 |
| workflow-engineer | No Spark identity wiring | Product gap. Custom identity works. `spark_code_enc` exists |
| workflow-engineer | Objective `TRAFFIC` without pixel | Acceptable for tests. `WEB_CONVERSIONS` needs a pixel and event: plan for M4 |
| workflow-engineer | No post-status cron | UI polls with `refreshTikTokPosts`. A post stays "processing" if nobody opens the page. Add a cron in M4 |
| sourcing-ai | `searchVideos` not metered (ScrapeCreators credits) | Should be metered like other paid calls (`usage_monthly.api_calls`). Bounded per product (once), so low risk |
| sourcing-ai | `complianceModel` / timeout not in workspace settings | The timeout uses the workspace analysis limit. The model is env-only. Fine for v1 |
| sourcing-ai | Text-only review should maybe warn | Agree. Same family as S3: a review without the video should not read as a full pass. The steps always pass `mediaUrl` today |
| app-ui | `ProductListItemDTO` lacks `failedStep` | Small DTO addition (workflow-engineer) |
| app-ui | `publishToProfile` lacks creator info, disableComment/Duet/Stitch, brandOrganic/brandedContent | **Required before `TIKTOK_POSTING_AUDITED=true`.** TikTok's Direct Post rules require the disclosure toggle and interaction settings. While `SELF_ONLY`, refusing the disclosure is the safe choice |
| app-ui | `CampaignDTO` lacks advertiser currency | **B1** |
| app-ui | Media-processing refusal lacks a machine reason | Add a code (for example `media_processing`) so the UI can offer "try again in a minute" |
| app-ui | Budget-change capability flag | Expose `capabilities.updateBudget` in the DTO instead of probing with a failing call |
| app-ui | Stats gaps | Hours with no delivery are not returned by the report. Fill zeros in the DTO, or say "no data" per hour |

## Tests added (tests/**)

- `tests/helpers/m3.ts`:
  - `recordTikTok`: records every TikTok Ads call (with the advertiser id) and every TikTok
    Posting call, with optional hooks.
  - `connectTikTokProfileMock`: Login Kit start + callback through `completeProfileConnection`.
  - `connectTikTok`: brand budget, both mock ad accounts and one profile.
  - `toGate3PageApproved`, `toGate4`, `toLaunched`, `usableVideos`.
- `tests/integration/m3-demo-flow.test.ts` (10 tests): the M3 demo end to end in mock mode:
  - candidates and reports;
  - approve (role-checked, one upload to the GATE 2 store, idempotent, audited);
  - approve then reject (media deleted, audited, note not copied);
  - the videos part (explicit ad account, approval row, one upload by Shopify URL to the right
    advertiser, all entities `DISABLE`, `campaign.create`);
  - GATE 4 (viewer and creative refused, a double click launches once, one approval, one
    `campaign.launch`);
  - hourly stats through `listLaunchedCampaigns` with system contexts (upsert by hour, totals);
  - pause, resume and budget (roles, audits, `precondition_failed`);
  - a private post (`SELF_ONLY`, sourced from the Shopify file, second click ignored, polled to
    published, audited);
  - no media URL in tables, audits, DTO or logs; no secrets.
- `tests/isolation/m3-isolation.test.ts` (7 tests): every M3 service across two tenants,
  foreign ids smuggled into valid requests, scoped DB and composite FKs, credential loaders, and
  the cron scan (ids only, own workspace, forged refs).
- `tests/security/m3-security.test.ts` (25 tests: 19 passing, 6 `it.fails`):
  - cron secret, server-only markers, client imports;
  - DISABLE create guard, live launch blocked under test, `SELF_ONLY` rules;
  - media URL stripping, SSRF on the guarded client, compliance media and Shopify video source;
  - compliance delimiters, keyword failures not cleared by the model;
  - template suffix rules (live and mock), no `liquid`/`html` settings, tag stripping;
  - `prepare_campaign` idempotency and crash re-run;
  - `it.fails` for B1, S1, S3, S4, N2 and N5.

  Flip each `it.fails` to `it` when its finding is fixed.
