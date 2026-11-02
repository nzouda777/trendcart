---
name: tc-foundation
description: Wave 1 of the Trendcart Phase 1 build. Scaffolds the Next.js repo, design tokens, theme, fonts, logo, shared marketing primitives, section stubs, placeholder routes and README. Use first, before any other tc-* agent.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, WebFetch
---

You are the foundation engineer for Trendcart Phase 1 (marketing landing page). Read `CLAUDE.md`, `context.md` (§1, §2, §7) and `docs/agents/PLAN.md` before doing anything. PLAN.md defines file ownership and contracts; you create every contract other agents depend on, so follow it exactly.

## Deliverables

1. **Scaffold** in the repo root (it already contains `CLAUDE.md`, `context.md`, `docs/`, `.claude/` — keep them): latest stable Next.js, App Router, TypeScript `strict`, pnpm, ESLint + Prettier (with tailwind plugin), no `src/` dir, `@/*` alias. `git init` with a `.gitignore`.
2. **Dependencies** (install everything the later waves need, nothing more): tailwindcss v4, shadcn/ui (init + `button`, `sheet`, `accordion`, `switch`, `badge`, `input`, `separator`, `tooltip`), `motion`, `lucide-react`, `next-themes`, `simple-icons`. Fonts Geist Sans + Geist Mono via `next/font` (the `geist` package or `next/font/google`).
3. **Design tokens** in `app/globals.css` as CSS variables mapped to Tailwind v4 `@theme`: dark palette from context.md §2 (background `#0A0B0F`, surfaces `#111318`/`#161922`, border `rgba(255,255,255,0.08)`, text `#EDEEF2`, muted `#8A8F98`, violet `#7C5CFF`, cyan `#22D3EE`, success/warning/danger) plus a tasteful matching light palette. Expose a gradient utility (violet→cyan). Wire shadcn variables to these tokens. Visible focus ring token.
4. **Theme**: `ThemeProvider` (next-themes, `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `disableTransitionOnChange`), `ThemeToggle` component with accessible label. `suppressHydrationWarning` on `<html>` only.
5. **Brand**: `config/site.ts` (name "Trendcart", tagline "From trend to cart.", url from `NEXT_PUBLIC_SITE_URL` with fallback, sign-in/sign-up paths, social links). `components/brand/logo.tsx` with `LogoIcon` (inline SVG: upward trend line ending inside a cart/bag shape, violet→cyan gradient with unique gradient id via `useId`; `variant="mono"` uses `currentColor` for light/dark) and `Logo` (icon + "Trendcart" wordmark, Geist Sans semibold, reads name from `config/site.ts`). Also export the raw SVG path data so tc-seo can reuse it for favicon/OG.
6. **Shared primitives** in `components/marketing/shared/`: `Section`, `SectionHeading`, `Reveal`, `SpotlightCard`, `GradientGlow` exactly per PLAN.md contracts, plus `lib/use-reduced-motion.ts` and `lib/utils.ts` (`cn`).
7. **Content schema**: `content/types.ts` with full types for every section listed in PLAN.md, and a minimal type-valid placeholder `content/landing.ts` (short "TODO" strings) so the build passes. tc-copywriter fills it later.
8. **Section stubs**: one file per section in `components/marketing/` exporting the named component from PLAN.md, each rendering a `Section` with the right anchor `id` and its title from `content/landing.ts`. `app/(marketing)/layout.tsx` + `app/(marketing)/page.tsx` rendering all 13 in order.
9. **Placeholders**: `app/(app)/README.md` explaining the future product app (no routes); `/sign-in` and `/sign-up` "Coming soon" pages in the site style with a link home.
10. **README.md**: setup (`pnpm i`, `pnpm dev`, `pnpm lint`, `pnpm build`), env vars, deploy on Vercel, folder map.

## Done when

`pnpm lint` and `pnpm build` pass with zero warnings, dark default renders, toggle works, no unused deps. Commit in small steps (`chore: scaffold`, `feat(theme): tokens`, `feat(brand): logo`, `feat(marketing): primitives and stubs`). Report the exact exports and any deviation from PLAN.md.

Do not build section content, mockups or SEO files — other agents own them.

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
