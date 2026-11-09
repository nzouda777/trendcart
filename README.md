# Trendcart

From a TikTok post to a launch-ready TikTok ad campaign, with the Shopify page in between.
This repository contains the **marketing landing page** (Phase 1, done) and the **product app**
(Phase 2, in progress: Milestones 1 and 2 done).

Project context: [CLAUDE.md](CLAUDE.md) · Phase 1 spec: [context.md](context.md) · Build plan: [docs/agents/PLAN.md](docs/agents/PLAN.md)

## Phase 2: product app

The app lives under `/app/*`. Today it covers auth, workspaces and roles, brands, Shopify and
TikTok connections, import and AI analysis (Gate 1), supplier search and margin (Gate 2), and
AI page copy, a draft Shopify page, review and publishing (Gate 3, page part). Start here:

- [docs/setup.md](docs/setup.md): local development (PGlite, seed, demo accounts, mock mode).
- [docs/integrations.md](docs/integrations.md): Shopify, TikTok, ScrapeCreators, Gemini, SerpApi,
  Firecrawl, Claude, Vercel Workflow, Upstash and cron setup for live mode.
- [docs/user-guide.md](docs/user-guide.md): how to use the app.
- [docs/shopify-template-kit.md](docs/shopify-template-kit.md): install the `product.trendcart`
  template on a store.
- [docs/operations.md](docs/operations.md): deploy and production checklists, runbook.
- [docs/milestones/M1.md](docs/milestones/M1.md), [docs/milestones/M2.md](docs/milestones/M2.md):
  what each milestone delivered, open questions.

Quick start (mock mode, no external accounts): copy `.env.example` to `.env.local`, set
`DATABASE_URL=pglite:./.data/dev`, `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY`, then
`pnpm db:seed` and `pnpm dev`. Details in [docs/setup.md](docs/setup.md). With a Neon database,
run `pnpm db:migrate` after each pull and before each deploy.

The sections below describe the landing page.

## Stack

Next.js (App Router, TypeScript strict, Turbopack, Cache Components) · Tailwind CSS v4 · shadcn/ui (Radix) ·
`motion` · lucide-react · next-themes · simple-icons · Geist Sans / Geist Mono via `next/font`.

## Setup

Requirements: Node.js 20.9+ and pnpm (`npm i -g pnpm`).

```bash
pnpm i            # install dependencies
cp .env.example .env.local   # optional, see "Environment variables"
pnpm dev          # http://localhost:3000
```

| Script           | What it does                                      |
| ---------------- | ------------------------------------------------- |
| `pnpm dev`       | Dev server with Turbopack                         |
| `pnpm lint`      | ESLint (Next core-web-vitals + TS), zero warnings |
| `pnpm typecheck` | `tsc --noEmit`                                    |
| `pnpm format`    | Prettier (+ Tailwind class sorting)               |
| `pnpm build`     | Production build                                  |
| `pnpm start`     | Serve the production build                        |

Before committing: `pnpm lint` and `pnpm build` must pass with no warnings.

## Environment variables

| Name                   | Required | Description                                                                                               |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | No       | Public site URL (metadata, OG images, sitemap). Falls back to `https://usetrendcart.com`. No trailing slash. |

The product app needs more variables: every one is documented in `.env.example`, and the
production list is in [docs/operations.md](docs/operations.md).

## Deploy on Vercel

1. Import the repository in Vercel (framework preset: Next.js, package manager: pnpm is auto-detected).
2. Set `NEXT_PUBLIC_SITE_URL` to the production domain (e.g. `https://usetrendcart.com`).
3. Deploy. The landing alone needs no other configuration. The product app needs the variables in
   [docs/operations.md](docs/operations.md), with `INTEGRATIONS_MODE=live` in production, and
   `pnpm db:migrate` run against the Neon database before each deploy.

## Folder map

```
app/
  layout.tsx            Root layout: fonts, ThemeProvider, metadata
  globals.css           Design tokens (CSS variables → Tailwind @theme), utilities
  (marketing)/          Landing page route group (page.tsx renders all 13 sections)
  (app)/                Product app, served under /app/* (see app/(app)/README.md)
  api/                  Auth, Shopify and TikTok OAuth/webhooks, cron routes
  sign-in/, sign-up/    Auth pages (sign-in, 2FA, sign-up, workspace, invitations)
components/
  brand/logo.tsx        Logo, LogoIcon, raw SVG path data
  marketing/            One file per landing section
  marketing/shared/     Section, SectionHeading, Reveal, SpotlightCard, ComingSoon
  mockups/              Animated product UI mockups (React + Tailwind)
  ui/                   shadcn/ui components
  theme-provider.tsx    next-themes provider (dark default)
  theme-toggle.tsx      Dark/light toggle
config/site.ts          Brand name, tagline, URLs, socials (single source of truth)
content/
  types.ts              Content schema
  landing.ts            All landing copy, pricing, FAQ and nav links
lib/                    cn(), useReducedMotion, getCurrentYear, plus the Phase 2 layers:
                        domain/, services/, integrations/, db/, auth/, tenant/, crypto/, ai/,
                        sourcing/, workflows/
```

## Conventions

- Copy lives in `content/landing.ts`; the brand name and tagline only in `config/site.ts`.
- Palette: black/white + Shopify green, no gradients or glows. Colors are tokens
  (`bg-background`, `bg-surface`, `bg-surface-2`, `text-muted-foreground`, `bg-brand` +
  `text-brand-foreground`, `hover:bg-brand-hover`, `bg-brand-soft`, `border-brand-border`,
  `text-brand-text`, `text-success|warning|danger`, …). Use green in doses: solid fill for the
  one primary action per view, `text-brand-text` for key words, tint + border for badges and
  highlighted cards, plain foreground everywhere else.
- Respect `prefers-reduced-motion`, keep keyboard navigation and visible focus, no hydration warnings.

## Sample photos

Mockup product photos in `public/samples/` are by
[Projector1 on Unsplash](https://unsplash.com/@projector1), used under the
[Unsplash License](https://unsplash.com/license):

- `projector-studio.jpg` — <https://unsplash.com/photos/jNeEaYfag9E>
- `projector-table.jpg` — <https://unsplash.com/photos/TiHLKH9qvEo>
- `projector-living-room.jpg` — <https://unsplash.com/photos/0VRMfiXG7Qk>
