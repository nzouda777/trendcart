---
name: tc-mockups
description: Wave 2 of the Trendcart Phase 1 build. Builds every animated product UI mockup in components/mockups/ (React + Tailwind, sample data, reduced-motion safe). Use after tc-foundation.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell
---

You build the product UI mockups for the Trendcart landing. Read `CLAUDE.md`, `context.md` (§2 design direction, §3 sections 3, 5, 6, 7, 8) and `docs/agents/PLAN.md` (Mockups contract — export names and props are fixed). You own `components/mockups/**` only.

## Principles

- Built in React + Tailwind with the design tokens from `app/globals.css`. No images, no 3D, no video.
- They must feel like the real Trendcart app: `MockupFrame` top bar with `LogoIcon` from `components/brand/logo.tsx`, "Demo Store", dense but readable UI, Geist Mono for numbers/IDs.
- Realistic but obviously fake data in `components/mockups/data.ts` (e.g. "Glow Mini Projector", "Demo Store", "@demo.creator"). No real brands as customers, no real people.
- Status colors: success = Approved/Connected, warning = Needs review, danger = Error, and a neutral/violet "Paused" badge. Reuse one `StatusBadge` and `StatusDot`.
- Animation with `motion`. Every animated mockup checks `useReducedMotion()` and renders a static, complete final/representative state instead. Animations pause when off-screen (`useInView`) to stay cheap.
- Decorative mockups get `aria-hidden` on purely visual parts plus a concise `aria-label`/sr-only description on the root (`role="img"` where appropriate). Interactive-looking buttons inside mockups are not focusable (`tabIndex={-1}`, no real handlers) except the hero pause control.
- Responsive from 375px: scale content, never overflow horizontally.
- No hydration mismatches: no `Date.now()`/`Math.random()` during render.

## Components to build (see PLAN.md for names)

1. `MockupFrame`, `StatusBadge`, `StatusDot` (shared).
2. `PipelineMockup` — hero; auto-cycles: paste TikTok link → AI identifies product (name, key features) → supplier match with price + computed margin → Shopify draft page preview with variants → campaign tree "Paused" with "Approve & launch". Progress indicator (5 steps), pauses on hover and focus-within, accessible pause/play button, static under reduced motion.
3. `FlowDiagram` — TikTok post → Trendcart → Shopify + TikTok Ads, animated connecting lines.
4. `HowItWorksMockup({ step })` — 6 views (Import, Identify, Source, Build the page, Prepare videos, Create the campaign), crossfade between steps, approval badge on the 4 checkpoint steps.
5. Feature mockups: `ProductAnalysisMockup` (detected product, selling points, confidence bar), `SupplierMarginMockup` (matches table + live margin calculator: selling price, cost, shipping, fees → margin %, computed from data, numbers animate), `ShopifyPageMockup` (variant chips, price, compare-at price, "Draft" badge), `VideoComplianceMockup` (video cards with gradient placeholders and checks: format ✓, length ✓, claims ⚠), `AdsBuilderMockup` (campaign → ad groups → ads tree all "Paused", pre-launch checklist, "Approve & launch"), `TiktokPostingMockup` (scheduler card to connected profiles).
6. Multi-store mockups: `BrandSwitcherMockup`, `ConnectionsMockup` (stores / TikTok profiles / ad accounts with green/orange/red dots), `ProxySettingMockup` (per-brand proxy), `TeamMockup` (members with roles).
7. `components/mockups/index.ts` barrel.

To preview, you may add a temporary `app/(marketing)/dev-mockups/page.tsx` but delete it before finishing.

## Done when

`pnpm lint` and `pnpm exec tsc --noEmit` pass (do NOT run `pnpm build` — parallel wave). Commit per group (`feat(mockups): pipeline`, …). Report final exports/props and any contract deviation.

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
