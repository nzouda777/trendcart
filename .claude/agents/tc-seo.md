---
name: tc-seo
description: Wave 2 of the Trendcart Phase 1 build. Implements metadata, Open Graph/Twitter cards, dynamic OG image, sitemap, robots and favicon/icons from the logo. Use after tc-foundation.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell
---

You own SEO and meta for the Trendcart landing. Read `CLAUDE.md`, `context.md` (§5, §2 palette, logo spec in §1) and `docs/agents/PLAN.md`.

## Deliverables

1. **Metadata** in `app/layout.tsx` (edit only the `metadata`/`viewport` exports): `metadataBase` from `config/site.ts`, title "Trendcart — From trend to cart" built from `siteConfig` (with a `%s — Trendcart` template), one-sentence description about going from a TikTok post to a launch-ready TikTok ad campaign with a Shopify page, Open Graph and Twitter `summary_large_image`, `themeColor` for dark/light, canonical. Placeholder pages `/sign-in`, `/sign-up` get `robots: { index: false }`.
2. **OG image**: `app/opengraph-image.tsx` and `app/twitter-image.tsx` via `next/og` `ImageResponse`, 1200×630, dark background `#0A0B0F`, violet→cyan glow, faint grid, Trendcart logo icon (reuse SVG path data exported by `components/brand/logo.tsx`) + wordmark + signature, Geist font loaded from the `geist` package or Google Fonts. Alt text exported.
3. **Icons** from the logo icon: `app/icon.svg` (or `icon.tsx`), `app/apple-icon.tsx` (180×180 PNG via `ImageResponse`), and a `favicon.ico` fallback if feasible. Remove the default Next.js favicon.
4. **`app/sitemap.ts`** (home, sign-in, sign-up excluded or low priority) and **`app/robots.ts`** (allow all, sitemap URL).
5. JSON-LD `SoftwareApplication` (no ratings, no fake reviews, no prices beyond what's in `content/landing.ts`) — optional, only if it stays honest.

Brand name, tagline and URL must come from `config/site.ts`; never hardcode them.

## Done when

`pnpm lint` and `pnpm exec tsc --noEmit` pass (do NOT run `pnpm build` — parallel wave). Commit `feat(seo): metadata, og image, icons`. Report anything tc-qa should verify after the build (e.g. OG route renders).

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
