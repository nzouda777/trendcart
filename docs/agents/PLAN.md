# Multi-agent build plan

- [Phase 2: product app](#phase-2--product-app) (current)
- [Phase 1: landing page](#phase-1--multi-agent-build-plan) (done)

## Phase 2 — product app

Shared context: [CLAUDE.md](../../CLAUDE.md) (Phase 2 section). Agent definitions:
`.claude/agents/{foundation-engineer,shopify-integration,tiktok-integration,sourcing-ai,workflow-engineer,app-ui,qa-reviewer,docs-writer}.md`.
The session that launches them is the orchestrator (tech lead).

### Milestones

| Milestone | Agents | Demo |
| --- | --- | --- |
| M1 — Foundations and connections (done, [summary](../milestones/M1.md)) | `foundation-engineer` first, then in parallel `shopify-integration`, `tiktok-integration`, `sourcing-ai`, `app-ui`; `workflow-engineer` for services and state machine; then `qa-reviewer`, fixes, `docs-writer` | Workspace, dev store, sandbox ad account, TikTok link to AI analysis |
| M2 — Link to Shopify page (done, [summary](../milestones/M2.md)) | `sourcing-ai` (SupplierFinder, margin, Copywriter), `workflow-engineer` (workflow through GATE 3 for the page), `shopify-integration` (createDraftProduct, publish), `app-ui` (tracker, detail, page preview) | Link to draft page in the store, published after approval |
| M3 — Videos, ads, posting | `sourcing-ai` (searchVideos, ComplianceChecker), `workflow-engineer` (video lifecycle, GATE 3 videos, GATE 4), `tiktok-integration` (upload, paused campaign, launch, stats cron, posting), `app-ui` | Paused sandbox campaign, launch after approval, hourly stats, private post |
| M4 — Hardening and release | `qa-reviewer` full run, fixes, `docs-writer` | Production deploy, live mode behind env flags |

After each milestone: `qa-reviewer`, blocking fixes through the owning agent, then
`docs-writer`.

### File ownership (only the owner writes; everyone else reads and reports)

| Path | Owner |
| --- | --- |
| `lib/db/**`, `lib/auth/**`, `lib/tenant/**`, `lib/crypto/**`, `lib/audit/**`, `proxy.ts` (Next 16 name for `middleware.ts`), `instrumentation.ts`, `app/(app)/layout.tsx`, `components/app-shell/**`, auth pages (`app/sign-in/**`, `app/sign-up/**`, `components/auth/**`) | `foundation-engineer` |
| `lib/integrations/shopify/**`, `app/api/shopify/**` | `shopify-integration` |
| `lib/integrations/tiktok-ads/**`, `lib/integrations/tiktok-posting/**`, `app/api/tiktok/**`, `app/api/cron/tiktok-*` | `tiktok-integration` |
| `lib/integrations/tiktok-data/**`, `lib/ai/**`, `lib/sourcing/**`, `lib/compliance/**` | `sourcing-ai` |
| `lib/domain/state-machine.ts`, `lib/workflows/**`, `lib/services/**`, `lib/media/**`, the crons in `vercel.json` | `workflow-engineer` |
| `app/(app)/**` pages, `components/app/**` | `app-ui` |
| `tests/**`, `e2e/**`, `docs/qa/**` | `qa-reviewer` |
| `docs/**` (except `docs/qa`), `README.md`, `app/(app)/README.md` | `docs-writer` |
| `lib/domain/contracts.ts`, `lib/integrations/index.ts` (registry), `lib/integrations/mode.ts`, `lib/auth/oauth-state.ts`, `eslint.config.mjs`, `vitest.config.mts`, `.prettierrc.json`, `.prettierignore`, `vercel.json`, `.env.example`, `next.config.ts`, `package.json`, `CLAUDE.md` | orchestrator |

### Rules

- **Contracts first**: `lib/domain/contracts.ts` defines `ShopifyClient`, `TikTokAdsClient`,
  `TikTokPostingClient`, `TikTokDataProvider`, `ProductAnalyzer`, `SupplierFinder`,
  `ComplianceChecker`, `Copywriter` and shared zod schemas. Every adapter ships `live.ts` and
  `mock.ts`, selected by `INTEGRATIONS_MODE`.
- An agent that needs a change outside its paths reports it; the orchestrator coordinates.
- Ask the user before using real credentials, connecting a real store or ad account,
  publishing anything, or enabling anything that could spend ad budget. Default to mock and
  sandbox.
- Small conventional commits per agent task. Every agent reports: files changed, decisions,
  tests added, open questions.

# Phase 1 — Multi-agent build plan

Source of truth: [context.md](../../context.md). Shared context: [CLAUDE.md](../../CLAUDE.md).
Agent definitions: `.claude/agents/tc-*.md`.

## Waves (run in order; agents inside a wave run in parallel)

| Wave | Agent | Scope (context.md §) |
|------|-------|----------------------|
| 1 | `tc-foundation` | §1 setup, §2 tokens/theme, logo, shared primitives, stubs for every section, `/sign-in` `/sign-up`, README, git init |
| 2 | `tc-copywriter` | `content/landing.ts` — all copy, pricing, FAQ, nav (§3 text, §4 copy rules) |
| 2 | `tc-mockups` | `components/mockups/**` — every animated product UI mockup |
| 2 | `tc-seo` | §5 metadata, OG image, sitemap, robots, icons |
| 3 | `tc-sections-top` | §3.1 Announcement, §3.2 Navbar, §3.3 Hero, §3.4 Integrations marquee, §3.13 Footer |
| 3 | `tc-sections-story` | §3.5 Why, §3.6 How it works (sticky scroll), §3.7 Feature deep-dives |
| 3 | `tc-sections-business` | §3.8 Multi-store & teams, §3.9 Control & security, §3.10 Pricing, §3.11 FAQ, §3.12 Final CTA |
| 4 | `tc-qa` | §6 checks + §7 definition of done: lint, build, responsive, themes, reduced motion, a11y, Lighthouse, hydration |

## File ownership (only the owner writes; everyone else reads)

| Path | Owner |
|------|-------|
| `package.json`, configs, `app/layout.tsx`, `app/globals.css`, `app/(marketing)/layout.tsx`, `app/(marketing)/page.tsx`, `app/(app)/`, `app/sign-in`, `app/sign-up`, `components/ui/**`, `components/brand/**`, `components/marketing/shared/**`, `components/theme-*`, `lib/**`, `config/site.ts`, `content/types.ts`, `README.md` | tc-foundation |
| `content/landing.ts` | tc-copywriter |
| `components/mockups/**` | tc-mockups |
| `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `app/sitemap.ts`, `app/robots.ts`, `app/icon.*`, `app/apple-icon.*`, metadata block in `app/layout.tsx` | tc-seo |
| `components/marketing/{announcement-bar,navbar,mobile-menu,hero,integrations-marquee,footer}.tsx` | tc-sections-top |
| `components/marketing/{why,how-it-works,features}.tsx` (+ private sub-files prefixed with those names) | tc-sections-story |
| `components/marketing/{multi-store,security,pricing,faq,final-cta}.tsx` (+ private sub-files) | tc-sections-business |

Exception: in wave 3, a section agent that lacks a field may make an **additive** edit to its own section's block in `content/types.ts` + `content/landing.ts` (never touch other blocks). A section agent that needs a new shadcn component runs `pnpm dlx shadcn@latest add <name>` (allowed in `components/ui/`).

## Contracts

### Section stubs (created by tc-foundation, replaced by wave 3)
`app/(marketing)/page.tsx` renders, in order, named exports from `components/marketing/`:
`AnnouncementBar`, `Navbar`, `Hero`, `IntegrationsMarquee`, `Why`, `HowItWorks`, `Features`, `MultiStore`, `Security`, `Pricing`, `Faq`, `FinalCta`, `Footer`.
Anchor ids: `product` (Why), `how-it-works`, `features`, `pricing`, `faq`. Hero CTA "See how it works →" → `#how-it-works`.

### Shared primitives (tc-foundation, `components/marketing/shared/`)
- `Section` — `<section>` wrapper, max-w ~1200px, vertical spacing, `id` prop.
- `SectionHeading` — `{ eyebrow: string; title: [string, string]; description?: string; align?: "left" | "center" }` (two-line headline with deliberate break).
- `Reveal` — scroll reveal via `motion`, no-op under reduced motion.
- `SpotlightCard` — surface card with a subtle green border/tint on hover (CSS only; name kept from the original spotlight version).
- ~~`GradientGlow`~~ — removed in the black + green redesign (no gradients/glows).
- `lib/use-reduced-motion.ts` re-export of motion's `useReducedMotion`.
- `components/brand/logo.tsx` — `Logo` (icon + wordmark), `LogoIcon` (`variant?: "brand" | "mono"`; `brand` = solid theme green, `mono` = `currentColor`).
- Color tokens (both themes): `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text`, plus `background`, `surface`, `surface-2`, `foreground`, `muted-foreground`, `border`, `border-strong`, `success`, `warning`, `danger`.

### Mockups (tc-mockups, barrel `components/mockups/index.ts`)
All accept `className?: string`. Client components only where animation requires it.
- `MockupFrame` — app-window chrome with Trendcart `LogoIcon` + "Demo Store" in the top bar.
- `PipelineMockup` — hero, auto-cycles 5 states with progress indicator; pauses on hover/focus; static under reduced motion.
- `FlowDiagram` — TikTok post → Trendcart → Shopify + TikTok Ads.
- `HowItWorksMockup` — `{ step: 0 | 1 | 2 | 3 | 4 | 5 }`; shows approval badge on steps with a human checkpoint.
- `ProductAnalysisMockup`, `SupplierMarginMockup`, `ShopifyPageMockup`, `VideoComplianceMockup`, `AdsBuilderMockup`, `TiktokPostingMockup`.
- `BrandSwitcherMockup`, `ConnectionsMockup`, `ProxySettingMockup`, `TeamMockup`.
- Sample data lives in `components/mockups/data.ts` (fake products, "Demo Store"). This is mockup data, not landing copy.

### Content (`content/types.ts` by tc-foundation, values by tc-copywriter)
`landing` object with one key per section: `announcement`, `nav`, `hero`, `integrations`, `why`, `howItWorks`, `features`, `multiStore`, `security`, `pricing`, `faq`, `finalCta`, `footer`. Pricing plans include `monthly`, `yearly`, limits (brands/stores, seats, products/month), features, CTA, `highlighted`. Placeholder prices $29 / $79 / $199 with `// TODO: confirm pricing with client`.

## Rules for parallel waves

- Do **not** run `pnpm build` in waves 2–3 (shared `.next/` collides). Use `pnpm lint` and `pnpm exec tsc --noEmit`. `pnpm build` runs in waves 1 and 4.
- Do not run `pnpm add` in waves 2–3; dependencies are installed by tc-foundation. If one is truly missing, report it instead.
- Commit only your own paths: `git add <your paths> && git commit -m "<scope>: …"`. If `index.lock` exists, wait and retry.
- Finish with a short report: files created, contract deviations, open TODOs.
