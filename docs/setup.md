# Local development setup

This page gets Trendcart running on your machine in **mock mode**: fake Shopify, TikTok and AI
adapters, so you need no external accounts. To connect real services, see
[integrations.md](integrations.md). For production, see [operations.md](operations.md).

## Prerequisites

- Node.js 20.9 or newer.
- pnpm. The repo pins `pnpm@12.15.0` in `package.json`; `corepack enable` picks it up, or
  install it with `npm i -g pnpm`.
- Git.

No database server is needed for local work: an embedded Postgres (PGlite) stores data in
`.data/dev` (git-ignored).

## 1. Install

```bash
pnpm i
cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
```

## 2. Fill in `.env.local`

Minimum for local mock mode:

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
DATABASE_URL=pglite:./.data/dev
BETTER_AUTH_SECRET=<random, 32+ chars>
ENCRYPTION_KEY=<base64 32-byte key>
INTEGRATIONS_MODE=mock
```

Generate the two secrets:

```bash
# BETTER_AUTH_SECRET
openssl rand -base64 32
# or, without openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# ENCRYPTION_KEY (must decode to exactly 32 bytes; base64 or 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`DATABASE_URL` options:

| Value                       | Use                                                                          |
| --------------------------- | ---------------------------------------------------------------------------- |
| `pglite:./.data/dev`        | Local embedded Postgres, persisted. Migrations run automatically.            |
| `pglite:memory`             | Throwaway in-memory database (lost on restart).                              |
| Neon pooled connection URL  | A real Neon database (staging, production, or shared dev).                   |

`pglite:` URLs are refused when `NODE_ENV=production` or `VERCEL_ENV=production`. A plain local
Postgres server does not work: the app uses the Neon serverless driver (WebSockets).

Every other variable in `.env.example` is optional in mock mode.

## 3. Seed demo data

Stop `pnpm dev` first: PGlite is single-process, so only one program can open `.data/dev` at a
time.

```bash
pnpm db:seed
```

With `pglite:` the seed applies migrations itself. With Neon, run `pnpm db:migrate` first.
The seed is idempotent (safe to run twice) and refuses to run in production.

**After every pull that adds migrations, run `pnpm db:migrate` against your Neon database**
(stop `pnpm dev` first if you use PGlite, though PGlite also migrates on start). M2 adds
`0001` to `0003` in `lib/db/migrations`: page copy on `product`, Shopify token and page URL
columns, and the `expiring` and `revoked` connection statuses.

### Demo accounts

All seeded users have a verified email and the password **`trendcart-demo-2026`**
(`DEMO_PASSWORD` in `lib/db/seed.ts`). The `.test` domain can never receive mail.

| Workspace       | Owner                  | Media buyer            | Creative                  | Viewer                  |
| --------------- | ---------------------- | ---------------------- | ------------------------- | ----------------------- |
| Northwind Goods | `owner@northwind.test` | `buyer@northwind.test` | `creative@northwind.test` | `viewer@northwind.test` |
| Lumen Beauty    | `owner@northwind.test` | `buyer@lumen.test`     | `creative@lumen.test`     | `viewer@lumen.test`     |

`owner@northwind.test` owns both workspaces, so you can try the workspace switcher. Brands
seeded: Northwind Home (FR, EUR) and Northwind Pets (US, USD) in Northwind Goods; Lumen Skin
(GB, GBP) in Lumen Beauty. No connections or products are seeded.

## 4. Run

```bash
pnpm dev        # http://localhost:3000
```

The landing page is at `/`, the app at `/app` (sign in at `/sign-in`). On start the server
logs `[db] Local PGlite database ready at ...`.

## Mock vs live mode

`INTEGRATIONS_MODE` selects every adapter in `lib/integrations/*` (`mock.ts` or `live.ts`).

| Mode   | Behaviour                                                                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock` | Default. No external calls. Verification and invitation links are printed to the server console (`[auth:mock-email]`). "Connect Shopify" and "Connect TikTok" skip the provider and land straight on our callback (mock store `trendcart-demo.myshopify.com`, whose theme has the default and `trendcart` product templates). Any TikTok video link imports and gets a canned AI analysis; a video id ending in `0000000` simulates "video not found". Supplier search returns deterministic listings (AliExpress, CJ Dropshipping, Alibaba, Temu), the copywriter returns safe sample copy, and drafts and publishing happen on the in-memory mock store. |
| `live` | Real APIs. Needs the keys in [integrations.md](integrations.md). Required on Vercel production (the app refuses to start otherwise).                                                                                                                                                                                                                |

### Pipeline engine

`PIPELINE_ENGINE` picks how product steps run. Leave it unset locally: it defaults to
`inline` (steps run inside the request that triggers them, such as an import or a gate
decision), and to `workflow` (Vercel Workflow, durable) when `VERCEL=1`. `workflow` is only
supported on Vercel. See [operations.md](operations.md#pipeline-engine-pipeline_engine).

### Walk through M2 in mock mode

Sign in as `owner@northwind.test`, connect a Shopify store under **Connections**, import any
TikTok link, then confirm at Gate 1, choose a supplier at Gate 2, and review, edit and approve
the page at Gate 3. Full steps: [milestones/M2.md](milestones/M2.md#demo-in-mock-mode).

Live mode on `localhost` needs real credentials and redirect URLs registered with each provider;
TikTok and Shopify generally require `https` redirect URLs, so use a tunnel or a Vercel preview
for live OAuth testing.

## Reset the local database

```bash
# stop pnpm dev first
rm -rf .data/dev                 # PowerShell: Remove-Item -Recurse -Force .data\dev
pnpm db:seed
pnpm dev
```

**If you change `ENCRYPTION_KEY` (or drop the key version that wrote them), reset and re-seed.**
Encrypted rows (Shopify and TikTok tokens, custom app secrets, proxy URLs) are bound to the key
and cannot be decrypted with a different one. Changing `BETTER_AUTH_SECRET` signs everyone out.

## Checks

| Command             | What it does                                                                     |
| ------------------- | -------------------------------------------------------------------------------- |
| `pnpm lint`         | ESLint, zero warnings allowed                                                    |
| `pnpm typecheck`    | `tsc --noEmit`                                                                   |
| `pnpm test`         | Vitest, full suite (several minutes; tests use their own in-memory PGlite)       |
| `pnpm test:watch`   | Vitest in watch mode                                                             |
| `pnpm format:check` | Prettier check (`pnpm format` writes)                                            |
| `pnpm build`        | Production build                                                                 |
| `pnpm db:generate`  | Generate a migration from `lib/db/schema` (offline)                              |
| `pnpm db:migrate`   | Apply migrations to `DATABASE_URL` (Neon, or a stopped PGlite directory)         |
| `pnpm db:studio`    | Drizzle Studio                                                                   |

Before committing: `pnpm lint` and `pnpm build` must pass with no warnings.

## Troubleshooting

- **Dashboard shows `Failed query: select ... "page_copy" ... from "product"`** (a Drizzle
  error raised from `listProducts` in `app/(app)/app/page.tsx`): your Neon database is missing
  the M2 migrations. Run `pnpm db:migrate` with `DATABASE_URL` pointing at that database, then
  reload. On Vercel, run it before each deploy (see the deploy checklist in
  [operations.md](operations.md#deploy-checklist-vercel)).
- **"The local PGlite database is not open"**: restart `pnpm dev`; the database is opened by
  `instrumentation.ts` at server start.
- **Seed or migrate fails, hangs, or the data looks wrong afterwards**: check that `pnpm dev`
  is not running against the same `.data/dev` directory. Stop it and run the command again.
- **Windows: `spawn EBUSY` on `esbuild.exe`** (during `pnpm i`, `pnpm db:seed`, or tests): some
  antivirus setups lock the binary while scanning it. Exclude the project folder from real-time
  scanning and retry.
- **"INTEGRATIONS_MODE must be set to live in production"**: you are running with
  `VERCEL_ENV=production`. Locally, leave `VERCEL_ENV` unset.
