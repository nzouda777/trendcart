---
name: tc-sections-business
description: Wave 3 of the Trendcart Phase 1 build. Builds Multi-store & teams, Control & security grid, Pricing with monthly/yearly toggle, FAQ accordion and the final CTA band. Use after wave 2.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell
---

You build the business and conversion sections of the Trendcart landing. Read `CLAUDE.md`, `context.md` (§2, §3 items 8–12, §4) and `docs/agents/PLAN.md`. You own `components/marketing/{multi-store,security,pricing,faq,final-cta}.tsx` (+ private sub-files prefixed with those names). Replace the stubs; keep export names and anchor ids (`pricing`, `faq`).

All text, plans and FAQ from `content/landing.ts`. Use primitives from `components/marketing/shared/`, mockups from `components/mockups`, shadcn components from `components/ui/`.

## Sections

1. **MultiStore** — headline + bento layout combining `BrandSwitcherMockup`, `ConnectionsMockup` (green/orange/red status dots with a text legend — never color alone), `ProxySettingMockup`, `TeamMockup`.
2. **Security** — grid of 6 `SpotlightCard`s with lucide icons: Nothing launches without approval, No videos stored, Encrypted account tokens, Isolated workspaces, Roles & 2FA, Limited adjustable activity pace. 1/2/3 columns at 375/768/1280.
3. **Pricing** (`id="pricing"`) — accessible monthly/yearly toggle (shadcn `Switch` or radio group, with "2 months free" badge on yearly), 3 plans from content, Growth highlighted "Most popular" with gradient border, limits (brands/stores, seats, products/month), feature checklist, CTA per plan, prices animate subtly on toggle (static under reduced motion), "Enterprise / custom" line below. Prices are rendered from content only; keep the `// TODO: confirm pricing with client` in content untouched.
4. **Faq** (`id="faq"`) — shadcn `Accordion` (single, collapsible) with ~8 items from content. Optionally a `FAQPage` JSON-LD script built from the same content.
5. **FinalCta** — band with `GradientGlow`, two-line headline, primary (sign-up) and secondary (`#how-it-works` or sign-in) buttons.

## Quality

Responsive at 375/768/1280/1536, keyboard accessible with visible focus, semantic HTML (`<h2>` per section, plan names as `<h3>`, price with sr-only period text), reduced motion respected, no hydration warnings. Do not touch files you don't own (see PLAN.md exception for content fields).

## Done when

`pnpm lint` and `pnpm exec tsc --noEmit` pass (do NOT run `pnpm build` — parallel wave). One commit per section. Report what tc-qa should check visually.

## Palette override (client, 2026-10-23)

The palette is now **black + Shopify green only, no gradients or glows** (context.md §2). Any mention above of violet, cyan, gradients, `GradientGlow`, gradient buttons/text or a radial spotlight is obsolete: use the `brand`, `brand-foreground`, `brand-hover`, `brand-soft`, `brand-border`, `brand-text` tokens, a neutral grey "Paused" status, and the real sample photos in `public/samples/` (via `next/image`) for product examples.
