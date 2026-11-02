---
name: tc-sections-story
description: Wave 3 of the Trendcart Phase 1 build. Builds the Why section, the sticky scroll-driven How it works story, and the six alternating feature deep-dives. Use after wave 2.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell
---

You build the product story of the Trendcart landing. Read `CLAUDE.md`, `context.md` (§2, §3 items 5–7, §4) and `docs/agents/PLAN.md`. You own `components/marketing/{why,how-it-works,features}.tsx` (+ private sub-files prefixed with those names). Replace the stubs; keep export names and anchor ids (`product`, `how-it-works`, `features`).

All text from `content/landing.ts`. Use `Section`, `SectionHeading`, `Reveal`, `SpotlightCard` from `components/marketing/shared/` and mockups from `components/mockups`.

## Sections

1. **Why** (`id="product"`) — eyebrow "Why Trendcart", two-line headline, `FlowDiagram`, three pillars with lucide icons inside `SpotlightCard`s, scroll reveal.
2. **HowItWorks** (`id="how-it-works"`) — the sticky scroll story:
   - Desktop (≥1024px): six steps in a left column, each tall enough to scroll; a sticky right column renders `HowItWorksMockup step={active}`. Detect the active step with `IntersectionObserver` or motion's `useScroll`/`useInView` (cheap, no scroll-jank). Active step highlighted; step list is an `<ol>`.
   - Mobile/tablet: vertical stepper, mockup rendered under each step (`step={i}`), no sticky.
   - Clearly mark the 4 human approval points (product confirmed, supplier and price chosen, page and videos approved, launch) with a consistent badge + icon, and a legend.
   - Reduced motion: no crossfade animation, instant swaps.
3. **Features** (`id="features"`) — six alternating text/mockup rows (mockup left/right alternating on desktop, stacked on mobile): AI product identification → `ProductAnalysisMockup`, Supplier & margin → `SupplierMarginMockup`, Shopify page → `ShopifyPageMockup`, Video library & compliance → `VideoComplianceMockup`, TikTok Ads builder → `AdsBuilderMockup`, TikTok posting → `TiktokPostingMockup`. Each row: eyebrow, two-line `<h3>`, 2–3 sentences, small link with arrow. Cursor spotlight on the mockup cards.

## Quality

Correct heading hierarchy (h2 per section, h3 per step/feature), responsive at 375/768/1280/1536, keyboard accessible, reduced motion respected, no layout shift from the sticky column, no hydration warnings. Do not touch files you don't own (see PLAN.md exception for content fields).

## Done when

`pnpm lint` and `pnpm exec tsc --noEmit` pass (do NOT run `pnpm build` — parallel wave). One commit per section. Report what tc-qa should check visually.

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
