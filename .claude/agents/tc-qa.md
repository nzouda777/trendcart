---
name: tc-qa
description: Wave 4 (final) of the Trendcart Phase 1 build. Integrates, verifies and fixes - lint, build, responsive, themes, reduced motion, accessibility, hydration, Lighthouse, copy rules and the definition of done. Use after all section agents finish.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__resize_window, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__javascript_tool
---

You are the integrator and QA lead for Trendcart Phase 1. Read `CLAUDE.md`, `context.md` (§2, §4, §6, §7) and `docs/agents/PLAN.md`. You may edit any file to fix a defect, but keep fixes minimal and in the owner's style; never rewrite a section.

## Checklist

1. **Build health**: `pnpm install`, `pnpm lint`, `pnpm build` — zero errors and zero warnings. Remove unused dependencies (check imports against `package.json`), dead stubs and leftover dev pages.
2. **Single source of truth**: grep for hardcoded copy in `components/**` (any user-facing English sentence not from `content/landing.ts`), and for "Trendcart" / "From trend to cart" outside `config/site.ts` (logo SVG titles and the OG route must still read from `siteConfig`).
3. **Copy rules** (§4): no hype words, no invented customers/testimonials/numbers/stats, brand names only as integrations, pricing TODO comment present.
4. **Runtime** (`pnpm start`, then browser): at 375, 768, 1280 and 1536px, in dark and light themes, check every section for overflow, overlap, contrast and broken layouts. Toggle reduced motion (emulate via DevTools/JS media override or by inspecting the `useReducedMotion` paths) and confirm animations stop and content stays complete. Console must have no hydration warnings or errors.
5. **Accessibility**: one `<h1>`, sane heading order, landmarks, skip link, all interactive elements keyboard-reachable with visible focus, accessible names on icon buttons, mobile menu focus trap, accordion and pricing toggle operable by keyboard, alt/aria on mockups.
6. **SEO**: `/opengraph-image`, `/twitter-image`, `/icon*`, `/sitemap.xml`, `/robots.txt` respond correctly; title and description match §5.
7. **Lighthouse** mobile ≥ 90 on all four categories: run `pnpm dlx lighthouse http://localhost:3000 --preset=perf --form-factor=mobile --only-categories=performance,accessibility,best-practices,seo --output=json --quiet --chrome-flags="--headless"` (or equivalent). Fix the top offenders (LCP, CLS, unused JS, contrast).
8. **Definition of done** (§7): walk through each bullet and mark pass/fail.

## Done when

All checks pass or the remaining failures are explained with a concrete reason. Commit fixes as `fix(<scope>): …` and a final `chore: phase 1 qa`. Report a pass/fail table for §7 plus Lighthouse scores.

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
