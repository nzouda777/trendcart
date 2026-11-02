# Trendcart — Phase 2: build the product on top of the landing (multi-agent)

The landing page is done. You are now the **tech lead / orchestrator** of this session.

Your job:
1. Update `CLAUDE.md`.
2. Check the subagents.
3. Write the shared contracts.
4. Delegate the work milestone by milestone, run QA after each milestone, and report to me.

You do not write feature code yourself, except shared contracts, wiring and fixes the QA agent reports as blocking.

## 1. Setup

1. Read `CLAUDE.md`, then append the full content of `CLAUDE-phase2.md` to it, and delete `CLAUDE-phase2.md`.
2. Check that these 8 subagents exist in `.claude/agents/`:
   - `foundation-engineer`
   - `shopify-integration`
   - `tiktok-integration`
   - `sourcing-ai`
   - `workflow-engineer`
   - `app-ui`
   - `qa-reviewer`
   - `docs-writer`

   Tell me if any is missing.

## 2. Orchestration rules

1. **Contracts first.** Before delegating, write `lib/domain/contracts.ts` with these interfaces, plus shared zod schemas:
   `ShopifyClient`, `TikTokAdsClient`, `TikTokPostingClient`, `TikTokDataProvider`, `ProductAnalyzer`, `SupplierFinder`, `ComplianceChecker`, `Copywriter`.
   Every agent codes against these interfaces and ships a mock, so the UI and workflow can progress before external approvals.
2. **Ownership.** Each agent only edits its own folders. If a change is needed elsewhere, it reports back and you coordinate.
3. **Parallelism.** Run independent agents in parallel. `foundation-engineer` always goes first.
4. **Reporting.** Every agent ends with: files changed, decisions, tests added, open questions.
5. **QA gate.** After each milestone, run `qa-reviewer`, fix blocking issues through the owning agent, then run `docs-writer`.
6. **Ask me before:**
   - using real credentials;
   - connecting a real store or ad account;
   - publishing anything publicly;
   - enabling anything that could spend ad budget.
   - Default to sandbox and mock mode.
7. **Commits.** Small commits per agent task, with conventional commit messages.

## 3. Milestones (aligned with client demos)

**M1 — Foundations and connections (week 1)**
- `foundation-engineer`.
- Then in parallel:
  - `shopify-integration` (OAuth, webhooks, templates, metafields);
  - `tiktok-integration` (ads + posting OAuth, advertisers);
  - `sourcing-ai` (provider adapter, ProductAnalyzer);
  - `app-ui` (onboarding, connections, import, products list).
- Demo: create a workspace, connect a dev store and sandbox ad account, paste a TikTok link and see the AI analysis.

**M2 — Link to Shopify page (week 2)**
- `sourcing-ai`: SupplierFinder, margin, Copywriter.
- `workflow-engineer`: state machine, workflow through GATE 3 for the page, services.
- `shopify-integration`: createDraftProduct, publish.
- `app-ui`: tracker, product detail, page preview.
- Demo: link → confirmed product → chosen supplier → draft page in the store → published after approval.

**M3 — Videos, ads, posting (week 3)**
- `sourcing-ai`: searchVideos, ComplianceChecker.
- `workflow-engineer`: video lifecycle, GATE 3 videos, GATE 4.
- `tiktok-integration`: upload, paused campaign, launch, stats cron, posting.
- `app-ui`: video library, campaign review, results, posting.
- Demo: full flow to a paused campaign in the sandbox, launch after approval, hourly stats, private post on a test profile.

**M4 — Hardening and release (half week)**
- `qa-reviewer` full run including the isolation suite.
- Fixes, then `docs-writer`.
- Production deploy on Vercel with live mode behind env flags.

## 4. Start now

1. Update `CLAUDE.md`.
2. Check the 8 agents.
3. Write the contracts.
4. Show me the M1 plan (tasks per agent, order, parallel groups) and wait for my "go" before delegating.
