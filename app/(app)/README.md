# `app/(app)/` — product app

Authenticated Trendcart app, served under `/app/*` (the folder `app/` inside
this route group). `layout.tsx` renders the shell (`components/app-shell`) and
redirects to `/sign-in` or `/sign-up/workspace` when there is no session or no
active workspace. `proxy.ts` also bounces signed-out visitors before render.

## Rules for pages here

- No business logic in pages: call services (`lib/services/*`) with the
  context from `getWorkspaceContext()` / `requireWorkspacePage()`
  (`lib/auth/session`).
- Never import `lib/db/client`; business data only through `ctx.db`
  (`lib/tenant/scoped-db`), which is bound to the session workspace.
- Session reads are request-time: keep them inside a `<Suspense>` boundary
  (the layout already wraps `children` in one).
- Use `PageHeader` and `EmptyState` from `components/app-shell`.
- Hide controls with `can(role, "resource:action")` from `lib/auth/permissions`,
  but always re-check in the service with `requirePermission`.

## Routes

- `/app` — overview: products waiting at a gate, connection health. Owners
  of a workspace without brands are sent to `/app/onboarding`.
- `/app/onboarding` — create the first brand after workspace creation.
- `/app/brands`, `/app/brands/[id]` — brand list and creation, brand settings, delete.
- `/app/connections` — Shopify, TikTok Ads, TikTok profiles and proxy of the
  active brand; shows OAuth callback results from the query string.
- `/app/import` — paste a TikTok or product link.
- `/app/products`, `/app/products/[id]` — list (status and brand filters,
  pagination) and detail on `getProductPipeline`: gate tracker, analysis,
  retry, GATE 1, GATE 2 supplier choice with live margin quote
  (`components/app/product/supplier-choice.tsx`), and the GATE 3 page review
  (`page-review.tsx`). Server actions are in `products/[id]/actions.ts`.
- `/app/team` — members, invitations, roles (Better Auth client, owner only).
- `/app/usage` — AI cost and paid API calls per month.
- `/app/account/security` — TOTP two-factor setup.

Shared pieces: `app/(app)/app/_lib` (page context, `runAction` for server
actions) and `components/app/**`.

## GATE 3 page review rules

- The approval sends `pageCopyVersion` from the DTO. A stale version comes
  back with `fieldErrors.copyVersion` (`STALE_COPY_FIELD`), and the dialog
  offers Reload instead of a retry. The action matches the service message
  text; a dedicated error code is an M3 open question.
- While the page part is `publishing`, every page action is disabled and the
  page auto-refreshes.
- Rate-limited rebuilds (`rate_limited`) show a disabled "Try again later"
  (`limit-action.tsx`).
- The description preview is a sandboxed `srcdoc` iframe. Never combine
  `allow-scripts` with `allow-same-origin` (QA M2 N7).
- `/app/connections` saves the template suffix with `setShopifyTemplate`,
  which checks it against the live theme. The field is still free text.

Running it locally: [docs/setup.md](../../docs/setup.md). What each screen does
for users: [docs/user-guide.md](../../docs/user-guide.md).
