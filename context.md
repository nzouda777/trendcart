# Project kickoff — Phase 1: Trendcart marketing landing page

You are building Trendcart, a SaaS web app, from scratch. In this phase, build ONLY the marketing landing page, but set up the repository so the product app can be added later without restructuring. Do not implement auth, database, or any business logic yet.

## 0. First, create `CLAUDE.md` at the repo root with this project context

Product: Trendcart, a platform for e-commerce operators that takes a TikTok post (or a product link) all the way to a ready-to-launch TikTok ad campaign, inspired by runblitzads.com. Brand signature: "From trend to cart."

Core workflow (to be built in later phases):
1. Import a TikTok video from a link, or find TikTok videos featuring a product.
2. AI identifies the product, finds matching listings online (images, prices, details), and computes the margin.
3. Generates a Shopify product page from the store's existing template (variants, prices, photos), created as a draft.
4. Collects videos of the same product and checks each one against TikTok ad rules.
5. Publishes selected videos to connected TikTok profiles (within TikTok's publishing permissions).
6. Creates the campaign, ad groups and ads in TikTok Ads Manager, all paused. Nothing launches without explicit human approval.
7. Supports custom product links and TikTok URLs supplied by the user.
8. Multi-tenant: multiple users per workspace with roles; multiple Shopify stores from different Shopify accounts, TikTok profiles and TikTok ad accounts, grouped by brand.
9. Optional proxy per brand/environment.
10. Uses Claude, ChatGPT, Gemini and Perplexity internally. An MCP server is planned AFTER v1, not now.

Hard constraints for all phases:
- Stack: Next.js (App Router, TypeScript strict), Neon Postgres (Drizzle ORM), deployed on Vercel. Keep the project light.
- No persistent video storage on our side. Store only links, IDs and metadata. Approved videos are hosted on the target Shopify store as product media and on TikTok; candidate videos are never stored.
- Every business table will carry a workspace_id; all data access goes through a scoped data-access layer.
- Human approval gates before publishing a page, using a video, and launching a campaign.

## 1. Setup

- Latest stable Next.js with App Router, TypeScript strict, pnpm.
- Tailwind CSS v4, shadcn/ui, `motion` (Framer Motion), lucide-react, next-themes, simple-icons (for integration logos only).
- Fonts: Geist Sans and Geist Mono via `next/font`.
- ESLint and Prettier configured. No unused dependencies.
- Route groups ready for later:
  - `app/(marketing)/` for the landing.
  - `app/(app)/` as an empty placeholder with a README; do NOT build the dashboard.
- `/sign-in` and `/sign-up` routes: simple placeholder pages in the same style ("Coming soon"), so CTAs don't 404.

Folder structure:
- `components/marketing/` for landing sections.
- `components/mockups/` for animated product UI mockups.
- `components/ui/` for shadcn.
- `content/landing.ts` holds ALL landing copy, pricing plans, FAQ and nav links. No copy hardcoded in components.
- `config/site.ts` holds the product name ("Trendcart"), tagline ("From trend to cart."), URLs and social links, used everywhere the brand appears.

Logo:
- A simple wordmark "Trendcart" in Geist Sans semibold.
- A small icon: an abstract upward trend line that ends inside a cart or shopping-bag shape, drawn as an inline SVG component in solid brand green (no gradient).
- Provide monochrome variants for light and dark themes, and reuse the icon for the favicon.

## 2. Design direction

Reference for structure and feel: https://wajub.com. It is a dark, product-led landing where every section pairs a short, confident headline with a live, animated mockup of the real product UI. Reproduce that approach with Trendcart's own content and identity. Do not copy their text, assets, logos or exact visuals.

Theme:
- Dark by default, with a light theme available through a toggle (next-themes, `defaultTheme="dark"`).
- All colors are CSS variables / Tailwind tokens.

Palette (revised by client, 2026-10-23): **black + Shopify green only, no gradients anywhere** (no gradient text, buttons, borders, glows or logo). Emphasis comes from different doses of the green (solid fill, text, tint, border), tuned per theme so highlighted text stays AA.
- Dark: background `#000000`, surfaces `#0B0B0B` / `#141414`, borders `rgba(255,255,255,0.08)`, text `#F5F5F5`, muted text `#9A9A9A`. Brand green `#95BF47` (Shopify logo green) for accents, highlights and primary buttons (black text on green).
- Light: background `#FFFFFF`, surfaces `#F7F7F5` / `#EFEFEC`, text `#0A0A0A`, muted text `#5C5C5C`. Brand green `#008060` (Shopify admin green) for accent text and primary buttons (white text); `#95BF47` only as non-text decoration.
- Tints: green at low opacity for soft backgrounds/borders (e.g. 8–14% fill, 30–40% border).
- Status colors stay functional in mockups only (always paired with a text label): success = brand green, warning amber, danger red; "Paused" is neutral grey.

Typography:
- Large tight headlines, often split over two lines with a deliberate line break.
- Small uppercase eyebrow labels above each section title.
- Generous spacing; max content width around 1200px.

Immersive feel:
- Hero background: plain black (or white) with a faint grid; no glow.
- Feature cards: subtle green border/highlight on hover (no radial spotlight glow).
- Scroll-reveal animations.
- One sticky scroll-driven section where the mockup changes as steps scroll by.
- Integration logo marquee.

Must stay fast and accessible:
- No 3D libraries, no video backgrounds.
- Respect `prefers-reduced-motion` everywhere.
- Lighthouse targets ≥ 90 on Performance, Accessibility, Best Practices and SEO.
- Fully responsive at 375 / 768 / 1280 / 1536px.
- Keyboard navigable, visible focus states, semantic HTML, alt text.

Mockups are built in React + Tailwind, with realistic but obviously sample data (fake product names, fake store "Demo Store"). Product examples use real photos (Unsplash License, no visible third-party brand) stored in `public/samples/` and rendered with `next/image`; credits listed in README. They should feel like the real Trendcart app, with the Trendcart logo in their top bar.

## 3. Page sections (in order)

1. **Announcement bar** (dismissible). Example: "Trendcart is in early access — join the waitlist".

2. **Navbar**
   - Sticky, translucent with backdrop blur, shrinks on scroll.
   - Trendcart logo, links: Product, How it works, Features, Pricing, FAQ.
   - Right side: theme toggle, "Sign in", primary "Get started".
   - Mobile: animated sheet menu.

3. **Hero**
   - Eyebrow: "TikTok → Shopify → TikTok Ads".
   - H1 (two lines): "From a TikTok post / to a launch-ready campaign."
   - Subline: one sentence on how Trendcart takes a TikTok link and, in minutes, identifies the product, finds the supplier, drafts the Shopify page and prepares the ad campaign, with nothing launching until you approve.
   - CTAs: "Get started" (primary) and "See how it works →" (anchor link).
   - Three trust bullets: "Human approval before every launch", "Multi-store, multi-account", "No videos stored on our servers".
   - Visual: animated pipeline mockup that auto-cycles through states, with progress indicators. Pausable on hover, static under reduced motion. States:
     1. Paste a TikTok link.
     2. AI identifies the product (card with product name, key features).
     3. Supplier match with price and computed margin.
     4. Shopify draft page preview with variants.
     5. Campaign tree created as "Paused" with an "Approve & launch" button.

4. **Integrations marquee**: "Works with" + Shopify, TikTok, TikTok Ads, Claude, ChatGPT, Gemini, Perplexity. Monochrome logos from simple-icons. No customer logos, no claims of partnership.

5. **Why section**
   - Eyebrow "Why Trendcart".
   - Two-line headline, e.g. "Less setup, / more tests that matter."
   - Small animated flow diagram: TikTok post → Trendcart → Shopify + TikTok Ads.
   - Three pillars with icons:
     - Save hours per product.
     - One place for every store and ad account.
     - You stay in control.

6. **How it works** (sticky scroll story)
   - Six steps on the left: Import, Identify, Source, Build the page, Prepare videos, Create the campaign.
   - A sticky mockup on the right updates per step.
   - On mobile: a vertical stepper with the mockup under each step.
   - Clearly mark the 4 human approval points (product confirmed, supplier and price chosen, page and videos approved, launch).

7. **Feature deep-dives**: alternating text/mockup rows. Each row has an eyebrow, a two-line headline, 2–3 sentences and a small link.
   - AI product identification: analysis card with detected product, selling points, confidence.
   - Supplier & margin: matches table plus a live margin calculator mock (selling price, cost, shipping, fees → margin %).
   - Shopify page from your own template: page preview with variant chips, price, compare-at price, and a "Draft" badge.
   - Video library & compliance check: video cards with check results (format ✓, length ✓, claims ⚠).
   - TikTok Ads builder: campaign → ad groups → ads tree, all "Paused", a pre-launch checklist and an "Approve & launch" button.
   - TikTok posting: post scheduler card to connected profiles.

8. **Multi-store & teams** section
   - Brand switcher mock.
   - Connections panel listing stores, TikTok profiles and ad accounts with green/orange/red status dots.
   - Per-brand proxy setting.
   - Team members with roles.

9. **Control & security** grid of 6 cards:
   - Nothing launches without approval.
   - No videos stored.
   - Encrypted account tokens.
   - Isolated workspaces.
   - Roles & 2FA.
   - Limited, adjustable activity pace.

10. **Pricing**
    - Monthly/yearly toggle ("2 months free" yearly).
    - 3 plans read from `content/landing.ts`: Starter, Growth (highlighted "Most popular"), Scale.
    - Limits per plan: brands/stores, team seats, products per month.
    - Feature checklist and CTA per plan.
    - Use placeholder prices ($29 / $79 / $199 per month) with a `// TODO: confirm pricing with client` comment.
    - Add an "Enterprise / custom" line below.

11. **FAQ**: accordion, about 8 questions. Topics:
    - What Trendcart does.
    - Does it launch ads automatically? (no, approval required)
    - Which Shopify themes work? (Online Store 2.0 templates)
    - Multiple stores and accounts.
    - Are videos stored? (no)
    - TikTok permissions.
    - AI models used.
    - Data security.

12. **Final CTA band**: solid black/green band (no glow), two-line headline (e.g. "Your next winner is already trending. / Get it to the cart."), primary and secondary buttons.

13. **Footer**
    - Trendcart logo plus the signature "From trend to cart."
    - Link columns: Product, Resources, Company, Legal.
    - Newsletter input (UI only, no backend).
    - Social icons and "© Trendcart" with the current year.

## 4. Copy rules

- English, clear and confident, short sentences, no hype words like "revolutionary".
- Never invent customer names, testimonials, user counts, revenue numbers or performance statistics. Where proof would go, use product facts (e.g. "4 approval checkpoints") or leave a clearly marked TODO.
- Brand names (Shopify, TikTok, Claude, etc.) only as integrations, never implying endorsement.

## 5. SEO & meta

- Metadata API:
  - Title "Trendcart — From trend to cart".
  - Description: one sentence on going from a TikTok post to a launch-ready TikTok ad campaign with a Shopify page.
  - Open Graph and Twitter cards.
- Dynamic OG image via `next/og` in the site's style, with the Trendcart logo and signature.
- `sitemap.ts`, `robots.ts`, favicon/icons from the logo icon.

## 6. How to work

1. Start by showing me a short plan: component tree, design tokens, logo approach, and list of mockups. Then build.
2. Build section by section. After each section, run `pnpm lint` and `pnpm build` and fix all errors and warnings.
3. Check every section at 375px and 1280px, in both dark and light themes, and with reduced motion.
4. No hydration warnings in the console.
5. Make small, well-named commits per section.

## 7. Definition of done

- All 13 sections built, responsive, dark default with working light toggle.
- Trendcart logo and favicon in place.
- All copy and pricing in `content/landing.ts`; brand name and tagline only in `config/site.ts`.
- Lighthouse ≥ 90 across the board on mobile.
- `CLAUDE.md` written as described.
- `pnpm build` passes, deployable to Vercel as-is.
- A short `README.md` with setup and run instructions.

Stop after the landing page is complete. The next phase (auth, workspaces, Neon schema, Shopify and TikTok connections) will come in a separate prompt.