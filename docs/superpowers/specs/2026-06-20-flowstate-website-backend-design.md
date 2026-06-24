# Flowstate marketing website — backend design

Date: 2026-06-20

## Goal

A public marketing website for **Flowstate** (the local AI agent desktop app),
matching the app's "minimalist luxury monochrome" theme and feel, with smooth
scroll animations and motion-graphic micro-interactions. This spec covers the
**backend only**. The frontend is built separately by Claude Design from
`docs/claude-design-prompt-website.md` (produced as part of this work).

Scope decisions (locked):
- Stack: **Next.js (App Router) API route handlers on Vercel**. We write only
  `app/api/**`, `lib/**`, env scaffolding, and Supabase migrations — **no UI**.
- Reuses the **existing Supabase project** (new tables) and **existing Stripe
  account** + `stripe-webhook` Edge Function (small extension).
- Web-purchase reconciliation: **email-claim** (option A).
- Email sending (confirmations / contact notifications): **skipped for now** —
  endpoints store to the DB only. A provider can be layered on later without
  changing the route contracts.

## Where it lives

A new top-level `website/` folder in this repo, deployed as its own Vercel
project (its own `package.json`, `next.config.mjs`, `tsconfig.json`). It is
independent of the Electron app build; nothing in `src/` imports from it and it
imports nothing from `src/`. Shared values (tier ids, price mapping) are copied,
not imported, to keep the two deploys decoupled.

```
website/
  app/
    api/
      waitlist/route.ts
      contact/route.ts
      latest/route.ts
      download/[variant]/route.ts
      checkout/route.ts
  lib/
    supabase-admin.ts      # service-role client (server-only)
    stripe.ts              # Stripe SDK client + tier→price map
    validate.ts            # zod schemas for every request body
    ratelimit.ts           # IP token-bucket (in-memory; swappable)
    releases.ts            # read latest release row, shape the /latest payload
    pricing.ts             # tier + interval → Stripe price id (copied from app)
  supabase/
    migrations/<ts>_website_backend.sql
  tests/
    validate.test.ts
    pricing.test.ts
    reconciliation.test.ts
  package.json
  next.config.mjs
  tsconfig.json
  .env.example
  README.md
```

(`app/page.tsx`, layout, components, etc. are intentionally NOT in this spec —
Claude Design owns them.)

## Endpoints

All handlers: validate with zod first (400 on bad input), rate-limit by IP,
never trust the client for anything security-relevant. Responses are JSON.
All DB writes use the service-role client and run server-side only.

### POST /api/waitlist
- Body: `{ email: string, source?: string }`.
- Validate email shape. Insert into `waitlist` (idempotent on email — duplicate
  returns `{ ok: true, already: true }`, never an error, never reveals more).
- Rate-limit: 5 / min / IP.
- Response: `{ ok: true }`.

### POST /api/contact
- Body: `{ name: string, email: string, message: string, website?: string }`.
  `website` is a **honeypot** — if non-empty, return `{ ok: true }` and drop
  silently (bot).
- Validate; insert into `contacts`. (No email-out for now — stored only.)
- Rate-limit: 3 / min / IP.
- Response: `{ ok: true }`.

### GET /api/latest
- No body. Reads the newest row from `releases`.
- Response:
  `{ version, notes, pubDate, assets: { setup: string, portable: string } }`
  where `assets.*` are public asset URLs (GitHub Release or Supabase Storage).
- Cache: `s-maxage=300, stale-while-revalidate`. Returns 404 JSON if no release
  row exists yet.

### GET /api/download/[variant]
- `variant` ∈ `setup` | `portable` (anything else → 400).
- Increments the counter for that variant in `download_counts` (best-effort;
  a count failure must NOT block the download).
- 302-redirects to the matching asset URL from the latest `releases` row.
- This is the URL the website's Download buttons point at, so counts are real.

### POST /api/checkout
- Body: `{ tier: 'pro' | 'power', interval: 'monthly' | 'annual', email?: string }`.
- Maps `(tier, interval)` → Stripe **price id** via `lib/pricing.ts`. Unknown
  combo → 400.
- Creates a Stripe **Checkout Session** (`mode: 'subscription'`), with:
  - `line_items: [{ price, quantity: 1 }]`
  - `customer_email: email` when provided (prefills + ties the session to email)
  - `metadata: { tier, source: 'website' }` and the same on
    `subscription_data.metadata` so later subscription events self-identify
  - `success_url` / `cancel_url` back to the site (configurable via env)
  - `allow_promotion_codes: true`
- Response: `{ url }` (the hosted Checkout URL). Frontend redirects to it.
- Rate-limit: 10 / min / IP.

## Web-purchase reconciliation (email-claim, option A)

Problem: a website buyer has **no Supabase account at checkout time**, unlike
the in-app flow which sets `client_reference_id = supabase user id`. So the
existing webhook cannot grant a tier to a user that does not exist yet.

Flow:
1. Website checkout sets `customer_email` + `metadata.source = 'website'`.
2. On `checkout.session.completed`, the **extended** `stripe-webhook` function:
   - If `client_reference_id` is present (in-app purchase) → existing behavior,
     unchanged.
   - Else if `metadata.source === 'website'` and an email is present → upsert a
     row into `pending_entitlements` `{ email (lower-cased), tier, stripe_customer_id,
     subscription_id, status: 'pending', created_at }`.
3. The desktop app, on sign-in / token refresh, calls a new in-app check
   ("claim pending entitlement"): look up `pending_entitlements` by the signed-in
   user's email; if found and unclaimed, an admin call sets `app_metadata.tier`
   for that user and marks the row `claimed`. (Implemented app-side later; this
   spec only guarantees the row exists and is shaped for it.)
4. `customer.subscription.updated/.deleted` continue to work via the stamped
   `subscription_data.metadata` (the webhook already stamps and reads this), so
   revocation/renewal needs no change.

Backend deliverables here: (a) the `pending_entitlements` table + RLS, (b) the
webhook extension in `supabase/functions/stripe-webhook/`, with pure decision
logic added to `logic.ts` and covered in `logic_test.ts` (mirrors existing
style). The in-app *claim* is noted as a follow-up, not built in this spec.

## Supabase schema (one migration)

| Table | Columns (essentials) | Notes |
|---|---|---|
| `waitlist` | `id`, `email` unique, `source`, `created_at` | dedupe on email |
| `contacts` | `id`, `name`, `email`, `message`, `created_at` | |
| `releases` | `id`, `version`, `notes`, `setup_url`, `portable_url`, `pub_date`, `created_at` | newest row = current |
| `download_counts` | `variant` PK (`setup`/`portable`), `count`, `updated_at` | atomic increment via RPC or `update ... set count = count + 1` |
| `pending_entitlements` | `id`, `email`, `tier`, `stripe_customer_id`, `subscription_id`, `status`, `created_at`, `claimed_at` | email-claim reconciliation |

RLS: enabled on all. **No anon/auth policies** that allow direct read/write —
every access goes through the service-role client inside route handlers (which
bypasses RLS) or the webhook (service role). This keeps the anon key inert
against these tables.

## Security

- Service-role key and Stripe secret key are **server-only** env vars; never
  `NEXT_PUBLIC_*`, never returned to the client, never logged.
- Every request body validated with zod before use.
- IP rate-limiting on all POSTs (in-memory token bucket; documented as
  per-instance — fine for launch volume, swappable for Upstash/KV later).
- Contact honeypot field to cut bot spam without a captcha.
- `download_counts` increment is best-effort and wrapped so it can never block
  or 500 the redirect.
- The checkout route trusts only `(tier, interval)` for pricing — the resolved
  price id comes from server-side `pricing.ts`, never from the client.

## Testing

Vitest on pure logic only (no network), matching the repo's existing pattern:
- `validate.test.ts` — zod schemas accept/reject the right shapes.
- `pricing.test.ts` — `(tier, interval)` → correct price id; unknown → null.
- `reconciliation.test.ts` — the webhook decision: in-app (client_reference_id)
  vs website (source+email) vs neither → correct branch/output.

Route handlers themselves are thin glue over tested pure functions, kept that
way deliberately so the logic is unit-testable without a server.

## Env (`website/.env.example`)

```
# server-only
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=
STRIPE_PRICE_POWER_MONTHLY=
STRIPE_PRICE_POWER_ANNUAL=
CHECKOUT_SUCCESS_URL=https://flowstate.app/thanks
CHECKOUT_CANCEL_URL=https://flowstate.app/pricing
# public (safe to expose)
NEXT_PUBLIC_SITE_URL=https://flowstate.app
```

## Claude Design handoff

Deliverable `docs/claude-design-prompt-website.md` covers, for the frontend:
- The exact monochrome design tokens (palette, radii, spacing, motion eases)
  lifted from `src/renderer/src/styles.css` so the site matches the app.
- Motion direction: smooth scroll-reveal on sections, parallax-lite hero,
  button/CTA micro-interactions, animated nav — framer-motion + a scroll lib
  (e.g. Lenis) called out, with restraint to match the app's "luxury" tone.
- Page/section spec: hero, feature showcase (mapped to the app's real surfaces —
  Dashboard, multi-agent, Flowclaw, Business, Trading, Connectors, Brain,
  Routines), pricing (Free/Pro/Max with the real $0/$5/$12 numbers), download
  CTA, waitlist, contact, footer.
- The **exact API contract** for every route above (method, body, response) so
  the frontend wires to the backend correctly.

## Out of scope (this spec)

- Any website UI/components/pages (Claude Design owns these).
- Email sending (deferred; endpoints store-only for now).
- The in-app "claim pending entitlement" implementation (follow-up; backend only
  guarantees the table + webhook row).
- Analytics, CMS, blog, i18n.
