---
name: tc-sections-top
description: Wave 3 of the Trendcart Phase 1 build. Builds the announcement bar, sticky navbar with mobile sheet, hero with animated background and pipeline mockup, integrations marquee, and footer. Use after wave 2.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell
---

You build the top and bottom chrome of the Trendcart landing. Read `CLAUDE.md`, `context.md` (§2, §3 items 1–4 and 13, §4) and `docs/agents/PLAN.md`. You own `components/marketing/{announcement-bar,navbar,mobile-menu,hero,integrations-marquee,footer}.tsx` (+ private sub-files prefixed with those names). Replace the stubs; keep the export names.

All text comes from `content/landing.ts`; brand/tagline/URLs from `config/site.ts`. Use primitives from `components/marketing/shared/`, mockups from `components/mockups`, `Logo` from `components/brand/logo.tsx`, `ThemeToggle` from foundation.

## Sections

1. **AnnouncementBar** — dismissible, close button with aria-label; dismissal remembered in `localStorage` (try/catch) without hydration mismatch (render visible on server, hide after mount, or use a CSS-first approach).
2. **Navbar** — sticky, translucent with backdrop blur, shrinks on scroll (passive scroll listener or `useScroll`), logo, anchor links, theme toggle, "Sign in", gradient "Get started". Mobile (<768px): shadcn `Sheet` animated menu, closes on link click, focus trapped. Proper `<nav aria-label>`, skip-to-content link.
3. **Hero** — eyebrow, two-line H1 (single `<h1>` on the page), subline, CTAs (`Get started` → sign-up, `See how it works →` → `#how-it-works`), 3 trust bullets with icons, `PipelineMockup`. Background: soft violet→cyan gradient glow + faint grid/noise via CSS (no images, no canvas), subtle drift animation disabled under reduced motion. Keep LCP fast: the H1 must not wait on JS animation (no initial `opacity: 0` on the H1).
4. **IntegrationsMarquee** — "Works with" + Shopify, TikTok, TikTok Ads, Claude, ChatGPT, Gemini, Perplexity as monochrome logos from `simple-icons` (import individual icons; if one is missing in simple-icons, render a text label). Infinite CSS marquee, paused on hover, static wrapped row under reduced motion, duplicated items `aria-hidden`. No customer logos, no partnership claims.
5. **Footer** — logo + signature, 4 link columns (Product, Resources, Company, Legal), newsletter input (UI only; `onSubmit` preventDefault with a local "Thanks" state, labelled input), social icons with aria-labels, `© {year} Trendcart` (year computed without hydration mismatch).

## Quality

Responsive at 375/768/1280/1536, keyboard navigable with visible focus, semantic HTML, `prefers-reduced-motion` respected, no hydration warnings. Do not touch files you don't own (see PLAN.md exception for content fields).

## Done when

`pnpm lint` and `pnpm exec tsc --noEmit` pass (do NOT run `pnpm build` — parallel wave). One commit per section (`feat(marketing): navbar`, …). Report what tc-qa should check visually.

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
