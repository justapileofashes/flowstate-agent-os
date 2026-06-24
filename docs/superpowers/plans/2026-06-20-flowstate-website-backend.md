# Flowstate Website Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend (API route handlers + Supabase schema + webhook extension) for the Flowstate marketing website, plus a Claude Design prompt for the frontend.

**Architecture:** A standalone Next.js (App Router) app in `website/`, deployed to Vercel independently of the Electron app. We write only `app/api/**` route handlers, `lib/**` pure logic, a Supabase migration, and an extension to the existing `stripe-webhook` Edge Function. All DB writes go through a server-only service-role client; route handlers are thin glue over unit-tested pure functions. No UI is written here — Claude Design builds it from `docs/claude-design-prompt-website.md`.

**Tech Stack:** Next.js 15 (App Router, route handlers), TypeScript, `@supabase/supabase-js`, `stripe`, `zod`, Vitest. Supabase (existing project) for storage, Stripe (existing account) for checkout.

## Global Constraints

- Stack is **Next.js App Router route handlers only** — write NO React components, pages, or layouts. Claude Design owns all UI.
- `website/` is **fully decoupled** from `src/`: it imports nothing from `src/` and `src/` imports nothing from it. Shared values (tier ids, prices) are copied, not imported.
- Secrets are **server-only**: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, all `STRIPE_PRICE_*`. Never `NEXT_PUBLIC_*`, never returned to the client, never logged.
- Tiers internal ids: `pro`, `power` (display: Pro, Max). Prices: Pro $5/mo · $50/yr, Max $12/mo · $120/yr.
- Every request body validated with zod before use; every POST is IP rate-limited.
- All new Supabase tables have RLS enabled with **no anon/auth policies** — access only via service role inside handlers/webhook.
- Route handlers must set `export const runtime = 'nodejs'` (service-role + stripe need Node, not Edge).
- Tests cover pure logic only (no network), mirroring `supabase/functions/stripe-webhook/logic_test.ts` style.

---

### Task 1: Website scaffold

**Files:**
- Create: `website/package.json`
- Create: `website/next.config.mjs`
- Create: `website/tsconfig.json`
- Create: `website/.gitignore`
- Create: `website/.env.example`
- Create: `website/README.md`
- Create: `website/app/api/health/route.ts`

**Interfaces:**
- Produces: a buildable Next.js app rooted at `website/`; a `GET /api/health` returning `{ ok: true }` used to prove routing works.

- [ ] **Step 1: Create `website/package.json`**

```json
{
  "name": "flowstate-website",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "next": "^15.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "stripe": "^17.5.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^20.19.39",
    "@types/react": "^18.3.28",
    "typescript": "^5.9.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create `website/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};
export default nextConfig;
```

- [ ] **Step 3: Create `website/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `website/.gitignore`**

```
node_modules
.next
.env
.env.local
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 5: Create `website/.env.example`**

```
# --- server-only (never expose) ---
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=
STRIPE_PRICE_POWER_MONTHLY=
STRIPE_PRICE_POWER_ANNUAL=
CHECKOUT_SUCCESS_URL=https://flowstate.app/thanks
CHECKOUT_CANCEL_URL=https://flowstate.app/pricing
# --- public (safe to expose) ---
NEXT_PUBLIC_SITE_URL=https://flowstate.app
```

- [ ] **Step 6: Create `website/README.md`**

```markdown
# Flowstate website

Marketing site for Flowstate. Next.js App Router, deployed to Vercel.

This repo folder holds the **backend** (API route handlers in `app/api`, pure
logic in `lib`, the Supabase migration in `supabase/migrations`). The frontend
(pages/components) is built from `docs/claude-design-prompt-website.md`.

## Develop
```bash
cd website
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

## Test
```bash
npm test
```

Reuses the existing Flowstate Supabase project + Stripe account. See the design
spec at `docs/superpowers/specs/2026-06-20-flowstate-website-backend-design.md`.
```

- [ ] **Step 7: Create `website/app/api/health/route.ts`**

```ts
export const runtime = 'nodejs';

export function GET(): Response {
  return Response.json({ ok: true });
}
```

- [ ] **Step 8: Install and verify build**

Run:
```bash
cd website && npm install && npm run build
```
Expected: build succeeds, route `/api/health` listed in the build output.

- [ ] **Step 9: Commit**

```bash
git add website/
git commit -m "feat(website): scaffold Next.js backend app + health route"
```

---

### Task 2: Request validation schemas (`lib/validate.ts`)

**Files:**
- Create: `website/lib/validate.ts`
- Test: `website/tests/validate.test.ts`

**Interfaces:**
- Produces:
  - `waitlistSchema` → `{ email: string; source?: string }`
  - `contactSchema` → `{ name: string; email: string; message: string; website?: string }`
  - `checkoutSchema` → `{ tier: 'pro'|'power'; interval: 'monthly'|'annual'; email?: string }`
  - Each is a `zod` schema; consumers call `.safeParse(body)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { waitlistSchema, contactSchema, checkoutSchema } from '../lib/validate';

describe('waitlistSchema', () => {
  it('accepts a valid email', () => {
    expect(waitlistSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });
  it('rejects a bad email', () => {
    expect(waitlistSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('contactSchema', () => {
  it('accepts a full message', () => {
    const r = contactSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'hi there' });
    expect(r.success).toBe(true);
  });
  it('rejects an empty message', () => {
    const r = contactSchema.safeParse({ name: 'A', email: 'a@b.com', message: '' });
    expect(r.success).toBe(false);
  });
  it('allows the honeypot field through (filtered later, not rejected)', () => {
    const r = contactSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'hi there', website: 'bot' });
    expect(r.success).toBe(true);
  });
});

describe('checkoutSchema', () => {
  it('accepts pro/annual', () => {
    expect(checkoutSchema.safeParse({ tier: 'pro', interval: 'annual' }).success).toBe(true);
  });
  it('rejects an unknown tier', () => {
    expect(checkoutSchema.safeParse({ tier: 'enterprise', interval: 'monthly' }).success).toBe(false);
  });
  it('rejects an unknown interval', () => {
    expect(checkoutSchema.safeParse({ tier: 'pro', interval: 'weekly' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && npx vitest run tests/validate.test.ts`
Expected: FAIL — cannot resolve `../lib/validate`.

- [ ] **Step 3: Write `website/lib/validate.ts`**

```ts
import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(320);

export const waitlistSchema = z.object({
  email,
  source: z.string().trim().max(64).optional(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  message: z.string().trim().min(1).max(5000),
  website: z.string().max(200).optional(), // honeypot — accepted, handled by route
});

export const checkoutSchema = z.object({
  tier: z.enum(['pro', 'power']),
  interval: z.enum(['monthly', 'annual']),
  email: email.optional(),
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website && npx vitest run tests/validate.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add website/lib/validate.ts website/tests/validate.test.ts
git commit -m "feat(website): zod request schemas + tests"
```

---

### Task 3: Tier/interval → Stripe price mapping (`lib/pricing.ts`)

**Files:**
- Create: `website/lib/pricing.ts`
- Test: `website/tests/pricing.test.ts`

**Interfaces:**
- Consumes: `CheckoutInput['tier']` and `['interval']` from Task 2.
- Produces: `priceIdFor(tier, interval, env): string | null` — pure, env injected so it is testable without `process.env`. `env` is `Record<string,string|undefined>`. Returns the price id or `null` for an unknown combo / missing env var.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { priceIdFor } from '../lib/pricing';

const ENV = {
  STRIPE_PRICE_PRO_MONTHLY: 'price_pm',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pa',
  STRIPE_PRICE_POWER_MONTHLY: 'price_xm',
  STRIPE_PRICE_POWER_ANNUAL: 'price_xa',
};

describe('priceIdFor', () => {
  it('maps each tier/interval to its price id', () => {
    expect(priceIdFor('pro', 'monthly', ENV)).toBe('price_pm');
    expect(priceIdFor('pro', 'annual', ENV)).toBe('price_pa');
    expect(priceIdFor('power', 'monthly', ENV)).toBe('price_xm');
    expect(priceIdFor('power', 'annual', ENV)).toBe('price_xa');
  });
  it('returns null when the env var is missing', () => {
    expect(priceIdFor('pro', 'monthly', {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && npx vitest run tests/pricing.test.ts`
Expected: FAIL — cannot resolve `../lib/pricing`.

- [ ] **Step 3: Write `website/lib/pricing.ts`**

```ts
type Tier = 'pro' | 'power';
type Interval = 'monthly' | 'annual';

const KEYS: Record<Tier, Record<Interval, string>> = {
  pro: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', annual: 'STRIPE_PRICE_PRO_ANNUAL' },
  power: { monthly: 'STRIPE_PRICE_POWER_MONTHLY', annual: 'STRIPE_PRICE_POWER_ANNUAL' },
};

/** Resolve a Stripe price id for a tier/interval from injected env. null if unset. */
export function priceIdFor(
  tier: Tier,
  interval: Interval,
  env: Record<string, string | undefined>,
): string | null {
  const key = KEYS[tier]?.[interval];
  if (!key) return null;
  const id = env[key];
  return id && id.length > 0 ? id : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website && npx vitest run tests/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/lib/pricing.ts website/tests/pricing.test.ts
git commit -m "feat(website): tier/interval -> Stripe price id mapping + tests"
```

---

### Task 4: IP rate limiter (`lib/ratelimit.ts`)

**Files:**
- Create: `website/lib/ratelimit.ts`
- Test: `website/tests/ratelimit.test.ts`

**Interfaces:**
- Produces: `rateLimit(key: string, limit: number, windowMs: number, now?: number): boolean` — returns `true` if allowed, `false` if over limit. In-memory fixed-window counter keyed by `key` (callers pass `${ip}:${routeName}`). `now` injectable for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { rateLimit } from '../lib/ratelimit';

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const k = 'ip1:test';
    expect(rateLimit(k, 2, 1000, 1000)).toBe(true);
    expect(rateLimit(k, 2, 1000, 1000)).toBe(true);
    expect(rateLimit(k, 2, 1000, 1000)).toBe(false);
  });
  it('resets after the window elapses', () => {
    const k = 'ip2:test';
    expect(rateLimit(k, 1, 1000, 5000)).toBe(true);
    expect(rateLimit(k, 1, 1000, 5000)).toBe(false);
    expect(rateLimit(k, 1, 1000, 6001)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && npx vitest run tests/ratelimit.test.ts`
Expected: FAIL — cannot resolve `../lib/ratelimit`.

- [ ] **Step 3: Write `website/lib/ratelimit.ts`**

```ts
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * Fixed-window in-memory rate limit. Returns true if the call is allowed.
 * Per-instance only (Vercel may run several) — adequate for launch volume;
 * swap for Upstash/KV if global limits are needed later.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website && npx vitest run tests/ratelimit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/lib/ratelimit.ts website/tests/ratelimit.test.ts
git commit -m "feat(website): in-memory IP rate limiter + tests"
```

---

### Task 5: Server clients + request helpers (`lib/supabase-admin.ts`, `lib/stripe.ts`, `lib/http.ts`)

**Files:**
- Create: `website/lib/supabase-admin.ts`
- Create: `website/lib/stripe.ts`
- Create: `website/lib/http.ts`
- Test: `website/tests/http.test.ts`

**Interfaces:**
- Produces:
  - `supabaseAdmin()` → a `SupabaseClient` built with the service-role key (server-only, throws if env missing).
  - `stripeClient()` → a configured `Stripe` instance (throws if `STRIPE_SECRET_KEY` missing).
  - `clientIp(req: Request): string` — best-effort IP from `x-forwarded-for`.
  - `tooMany(): Response` — `429 { error: 'rate_limited' }`.
  - `badRequest(msg?: string): Response` — `400 { error }`.

- [ ] **Step 1: Write the failing test (for the pure helper)**

```ts
import { describe, it, expect } from 'vitest';
import { clientIp } from '../lib/http';

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const req = new Request('https://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
  it('falls back to "unknown" with no header', () => {
    expect(clientIp(new Request('https://x'))).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && npx vitest run tests/http.test.ts`
Expected: FAIL — cannot resolve `../lib/http`.

- [ ] **Step 3: Write `website/lib/http.ts`**

```ts
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function badRequest(message = 'bad request'): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function tooMany(): Response {
  return Response.json({ error: 'rate_limited' }, { status: 429 });
}
```

- [ ] **Step 4: Write `website/lib/supabase-admin.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/** Service-role Supabase client. Server-only — never import into client code. */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin env not configured');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
```

- [ ] **Step 5: Write `website/lib/stripe.ts`**

```ts
import Stripe from 'stripe';

let cached: Stripe | null = null;

export function stripeClient(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  cached = new Stripe(key);
  return cached;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd website && npx vitest run tests/http.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add website/lib/supabase-admin.ts website/lib/stripe.ts website/lib/http.ts website/tests/http.test.ts
git commit -m "feat(website): server-only supabase/stripe clients + http helpers"
```

---

### Task 6: Supabase migration (tables + RLS)

**Files:**
- Create: `website/supabase/migrations/20260620000000_website_backend.sql`

**Interfaces:**
- Produces: tables `waitlist`, `contacts`, `releases`, `download_counts`, `pending_entitlements`, and an `increment_download(text)` RPC for atomic counting. All RLS-enabled, no anon/auth policies.

- [ ] **Step 1: Write the migration**

```sql
-- Flowstate website backend tables. RLS enabled, NO anon/auth policies:
-- all access is via the service role inside route handlers / the webhook.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  notes text,
  setup_url text not null,
  portable_url text not null,
  pub_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.download_counts (
  variant text primary key,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.download_counts (variant, count) values ('setup', 0), ('portable', 0)
  on conflict (variant) do nothing;

create table if not exists public.pending_entitlements (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null check (tier in ('pro','power')),
  stripe_customer_id text,
  subscription_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists pending_entitlements_email_idx
  on public.pending_entitlements (lower(email));

-- Atomic download counter. SECURITY DEFINER so the service role call is enough.
create or replace function public.increment_download(p_variant text)
returns void language sql security definer as $$
  insert into public.download_counts (variant, count, updated_at)
  values (p_variant, 1, now())
  on conflict (variant)
  do update set count = public.download_counts.count + 1, updated_at = now();
$$;

alter table public.waitlist enable row level security;
alter table public.contacts enable row level security;
alter table public.releases enable row level security;
alter table public.download_counts enable row level security;
alter table public.pending_entitlements enable row level security;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name: `website_backend`, the SQL above) OR `supabase db push` if using the CLI against the linked project. Then verify with `list_tables` that all five tables exist with RLS on.
Expected: five tables present; `download_counts` has rows `setup`/`portable`.

- [ ] **Step 3: Commit**

```bash
git add website/supabase/migrations/20260620000000_website_backend.sql
git commit -m "feat(website): supabase migration — waitlist/contacts/releases/downloads/pending_entitlements"
```

---

### Task 7: `POST /api/waitlist`

**Files:**
- Create: `website/app/api/waitlist/route.ts`

**Interfaces:**
- Consumes: `waitlistSchema` (T2), `rateLimit` (T4), `supabaseAdmin` (T5), `clientIp`/`badRequest`/`tooMany` (T5).
- Produces: `POST` handler. Body `{ email, source? }` → `{ ok: true, already?: true }` (200). Dedupe on email never errors.

- [ ] **Step 1: Write `website/app/api/waitlist/route.ts`**

```ts
import { waitlistSchema } from '@/lib/validate';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, badRequest, tooMany } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`${clientIp(req)}:waitlist`, 5, 60_000)) return tooMany();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('invalid json');
  }
  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) return badRequest('invalid email');

  const { email, source } = parsed.data;
  const db = supabaseAdmin();
  const { error } = await db.from('waitlist').insert({ email, source: source ?? null });
  if (error) {
    // unique_violation → already on the list; treat as success, reveal nothing else.
    if (error.code === '23505') return Response.json({ ok: true, already: true });
    console.error('[waitlist] insert failed:', error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd website && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke test (build proves the route compiles)**

Run: `cd website && npm run build`
Expected: build succeeds; `/api/waitlist` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add website/app/api/waitlist/route.ts
git commit -m "feat(website): POST /api/waitlist"
```

---

### Task 8: `POST /api/contact`

**Files:**
- Create: `website/app/api/contact/route.ts`

**Interfaces:**
- Consumes: `contactSchema` (T2), `rateLimit` (T4), `supabaseAdmin` (T5), helpers (T5).
- Produces: `POST` handler. Body `{ name, email, message, website? }`. Honeypot `website` non-empty → `{ ok: true }` and drop. Else insert into `contacts`.

- [ ] **Step 1: Write `website/app/api/contact/route.ts`**

```ts
import { contactSchema } from '@/lib/validate';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, badRequest, tooMany } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`${clientIp(req)}:contact`, 3, 60_000)) return tooMany();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('invalid json');
  }
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) return badRequest('invalid input');

  const { name, email, message, website } = parsed.data;
  // Honeypot: real users never fill `website`. Pretend success, store nothing.
  if (website && website.trim().length > 0) return Response.json({ ok: true });

  const db = supabaseAdmin();
  const { error } = await db.from('contacts').insert({ name, email, message });
  if (error) {
    console.error('[contact] insert failed:', error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd website && npm run typecheck && npm run build`
Expected: no errors; `/api/contact` in route list.

- [ ] **Step 3: Commit**

```bash
git add website/app/api/contact/route.ts
git commit -m "feat(website): POST /api/contact with honeypot"
```

---

### Task 9: Release payload shaping + `GET /api/latest`

**Files:**
- Create: `website/lib/releases.ts`
- Create: `website/app/api/latest/route.ts`
- Test: `website/tests/releases.test.ts`

**Interfaces:**
- Produces:
  - `shapeRelease(row)`: maps a DB row `{ version, notes, setup_url, portable_url, pub_date }` → `{ version, notes, pubDate, assets: { setup, portable } }`. Pure.
  - `GET /api/latest` → that shape (200) or `{ error: 'no_release' }` (404).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { shapeRelease } from '../lib/releases';

describe('shapeRelease', () => {
  it('maps a db row to the public payload', () => {
    const out = shapeRelease({
      version: '1.0.1',
      notes: 'fixes',
      setup_url: 'https://x/setup.exe',
      portable_url: 'https://x/portable.exe',
      pub_date: '2026-06-20T00:00:00Z',
    });
    expect(out).toEqual({
      version: '1.0.1',
      notes: 'fixes',
      pubDate: '2026-06-20T00:00:00Z',
      assets: { setup: 'https://x/setup.exe', portable: 'https://x/portable.exe' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && npx vitest run tests/releases.test.ts`
Expected: FAIL — cannot resolve `../lib/releases`.

- [ ] **Step 3: Write `website/lib/releases.ts`**

```ts
export interface ReleaseRow {
  version: string;
  notes: string | null;
  setup_url: string;
  portable_url: string;
  pub_date: string;
}

export interface ReleasePayload {
  version: string;
  notes: string | null;
  pubDate: string;
  assets: { setup: string; portable: string };
}

export function shapeRelease(row: ReleaseRow): ReleasePayload {
  return {
    version: row.version,
    notes: row.notes,
    pubDate: row.pub_date,
    assets: { setup: row.setup_url, portable: row.portable_url },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website && npx vitest run tests/releases.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `website/app/api/latest/route.ts`**

```ts
import { supabaseAdmin } from '@/lib/supabase-admin';
import { shapeRelease, type ReleaseRow } from '@/lib/releases';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('releases')
    .select('version, notes, setup_url, portable_url, pub_date')
    .order('pub_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[latest] query failed:', error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'no_release' }, { status: 404 });

  return Response.json(shapeRelease(data as ReleaseRow), {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
  });
}
```

- [ ] **Step 6: Typecheck + build**

Run: `cd website && npm run typecheck && npm run build`
Expected: no errors; `/api/latest` in route list.

- [ ] **Step 7: Commit**

```bash
git add website/lib/releases.ts website/app/api/latest/route.ts website/tests/releases.test.ts
git commit -m "feat(website): GET /api/latest + release payload shaping + tests"
```

---

### Task 10: `GET /api/download/[variant]`

**Files:**
- Create: `website/lib/download.ts`
- Create: `website/app/api/download/[variant]/route.ts`
- Test: `website/tests/download.test.ts`

**Interfaces:**
- Produces:
  - `isVariant(s): s is 'setup'|'portable'` — pure guard.
  - `GET` handler: validates variant, best-effort increments the counter via `increment_download` RPC, 302-redirects to the asset URL from the latest release.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isVariant } from '../lib/download';

describe('isVariant', () => {
  it('accepts setup and portable', () => {
    expect(isVariant('setup')).toBe(true);
    expect(isVariant('portable')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isVariant('exe')).toBe(false);
    expect(isVariant('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd website && npx vitest run tests/download.test.ts`
Expected: FAIL — cannot resolve `../lib/download`.

- [ ] **Step 3: Write `website/lib/download.ts`**

```ts
export type Variant = 'setup' | 'portable';

export function isVariant(s: string): s is Variant {
  return s === 'setup' || s === 'portable';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd website && npx vitest run tests/download.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `website/app/api/download/[variant]/route.ts`**

```ts
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isVariant } from '@/lib/download';
import { badRequest } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ variant: string }> },
): Promise<Response> {
  const { variant } = await ctx.params;
  if (!isVariant(variant)) return badRequest('unknown variant');

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('releases')
    .select('setup_url, portable_url')
    .order('pub_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return Response.json({ error: 'no_release' }, { status: 404 });

  // Best-effort count — must never block the download.
  void db.rpc('increment_download', { p_variant: variant }).then(({ error: e }) => {
    if (e) console.error('[download] count failed:', e.message);
  });

  const url = variant === 'setup' ? data.setup_url : data.portable_url;
  return Response.redirect(url, 302);
}
```

- [ ] **Step 6: Typecheck + build**

Run: `cd website && npm run typecheck && npm run build`
Expected: no errors; `/api/download/[variant]` in route list.

- [ ] **Step 7: Commit**

```bash
git add website/lib/download.ts "website/app/api/download/[variant]/route.ts" website/tests/download.test.ts
git commit -m "feat(website): GET /api/download/[variant] with redirect + counter"
```

---

### Task 11: `POST /api/checkout`

**Files:**
- Create: `website/app/api/checkout/route.ts`

**Interfaces:**
- Consumes: `checkoutSchema` (T2), `priceIdFor` (T3), `rateLimit` (T4), `stripeClient` (T5), helpers (T5).
- Produces: `POST` handler. Body `{ tier, interval, email? }` → `{ url }` (the Stripe Checkout Session URL). Stamps `metadata.source='website'` + `metadata.tier` on both the session and the subscription so the webhook can reconcile.

- [ ] **Step 1: Write `website/app/api/checkout/route.ts`**

```ts
import { checkoutSchema } from '@/lib/validate';
import { priceIdFor } from '@/lib/pricing';
import { stripeClient } from '@/lib/stripe';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, badRequest, tooMany } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`${clientIp(req)}:checkout`, 10, 60_000)) return tooMany();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('invalid json');
  }
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return badRequest('invalid input');

  const { tier, interval, email } = parsed.data;
  const price = priceIdFor(tier, interval, process.env);
  if (!price) return badRequest('unknown plan');

  const successUrl = process.env.CHECKOUT_SUCCESS_URL ?? `${process.env.NEXT_PUBLIC_SITE_URL}/thanks`;
  const cancelUrl = process.env.CHECKOUT_CANCEL_URL ?? `${process.env.NEXT_PUBLIC_SITE_URL}/pricing`;

  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      ...(email ? { customer_email: email } : {}),
      allow_promotion_codes: true,
      metadata: { tier, source: 'website' },
      subscription_data: { metadata: { tier, source: 'website' } },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) return Response.json({ error: 'no_session_url' }, { status: 502 });
    return Response.json({ url: session.url });
  } catch (e) {
    console.error('[checkout] stripe error:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'checkout_failed' }, { status: 502 });
  }
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd website && npm run typecheck && npm run build`
Expected: no errors; `/api/checkout` in route list.

- [ ] **Step 3: Commit**

```bash
git add website/app/api/checkout/route.ts
git commit -m "feat(website): POST /api/checkout — Stripe Checkout Session"
```

---

### Task 12: Webhook extension for website purchases (pending entitlements)

**Files:**
- Modify: `supabase/functions/stripe-webhook/logic.ts` (add `decideWebsiteEntitlement`)
- Modify: `supabase/functions/stripe-webhook/logic_test.ts` (cover it)
- Modify: `supabase/functions/stripe-webhook/index.ts` (use it on `checkout.session.completed` when there is no `client_reference_id`)

**Interfaces:**
- Consumes: existing `tierFromId`, `StripeTier`.
- Produces: `decideWebsiteEntitlement(obj): { email: string; tier: StripeTier } | null` — pure. Given a checkout-session object, returns the email+tier to record as a pending entitlement when `metadata.source === 'website'`, else null. The `index.ts` change writes a `pending_entitlements` row via the service role.

- [ ] **Step 1: Write the failing test (append to `logic_test.ts`)**

```ts
import { decideWebsiteEntitlement } from "./logic.ts";

Deno.test("decideWebsiteEntitlement records website checkouts", () => {
  assertEquals(
    decideWebsiteEntitlement({
      metadata: { source: "website", tier: "pro" },
      customer_email: "buyer@example.com",
    }),
    { email: "buyer@example.com", tier: "pro" },
  );
});

Deno.test("decideWebsiteEntitlement ignores in-app checkouts", () => {
  assertEquals(
    decideWebsiteEntitlement({
      client_reference_id: "user-123",
      metadata: {},
      customer_email: "x@y.com",
    }),
    null,
  );
});

Deno.test("decideWebsiteEntitlement needs source=website, an email, and a valid tier", () => {
  assertEquals(decideWebsiteEntitlement({ metadata: { source: "website" }, customer_email: "x@y.com" }), null);
  assertEquals(decideWebsiteEntitlement({ metadata: { source: "website", tier: "pro" } }), null);
  assertEquals(decideWebsiteEntitlement({ metadata: { source: "other", tier: "pro" }, customer_email: "x@y.com" }), null);
  assertEquals(decideWebsiteEntitlement({ metadata: { source: "website", tier: "gold" }, customer_email: "x@y.com" }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/stripe-webhook/logic_test.ts`
Expected: FAIL — `decideWebsiteEntitlement` is not exported.

- [ ] **Step 3: Add `decideWebsiteEntitlement` to `logic.ts`**

```ts
/**
 * For a website checkout (no Supabase user yet), decide the pending entitlement
 * to record. Returns {email, tier} only when the session was started by the
 * website (metadata.source === 'website'), carries a valid tier, and has an
 * email to claim against later. Otherwise null (in-app flow / incomplete data).
 */
export function decideWebsiteEntitlement(obj: {
  client_reference_id?: string;
  customer_email?: string;
  metadata?: { source?: string; tier?: string };
}): { email: string; tier: StripeTier } | null {
  if (obj.client_reference_id) return null; // in-app flow handles itself
  if (obj.metadata?.source !== "website") return null;
  const email = obj.customer_email;
  const tier = obj.metadata?.tier;
  if (!email) return null;
  if (tier !== "pro" && tier !== "power") return null;
  return { email, tier };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/stripe-webhook/logic_test.ts`
Expected: PASS (all prior tests + 3 new).

- [ ] **Step 5: Wire it into `index.ts`**

In the `StripeObject` interface, add `customer_email?: string;` and extend `metadata` to `{ user_id?: string; tier?: string; source?: string }`. Add a service-role insert helper and call it in the `checkout.session.completed` branch when there is no `client_reference_id`.

Add the import:
```ts
import {
  decideSubscriptionTier,
  decideWebsiteEntitlement,
  parseStripeSigHeader,
  tierFromId,
  type StripeTier,
} from "./logic.ts";
```

Add this helper near `setUserTier`:
```ts
/** Record a website purchase as a pending entitlement, claimed in-app by email. */
async function recordPendingEntitlement(
  email: string,
  tier: StripeTier,
  obj: StripeObject,
): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/pending_entitlements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      email: email.toLowerCase(),
      tier,
      subscription_id: typeof obj.subscription === "string" ? obj.subscription : null,
      status: "pending",
    }),
  });
}
```

In the `checkout.session.completed` branch, before the `userId`/`nextTier` resolution that follows, handle the website case first:
```ts
if (type === "checkout.session.completed") {
  const pending = decideWebsiteEntitlement(obj);
  if (pending) {
    const res = await recordPendingEntitlement(pending.email, pending.tier, obj);
    if (!res.ok) {
      const detail = await res.text();
      console.error(`[stripe-webhook] pending insert failed (${res.status}): ${detail}`);
      return json(502, { error: "failed to record pending entitlement" });
    }
    console.log(`[stripe-webhook] website checkout: pending ${pending.tier} for ${pending.email}`);
    return json(200, { ok: true, pending: true, tier: pending.tier });
  }
  userId = obj.client_reference_id ?? "";
  const plinkId = obj.payment_link ?? "";
  nextTier = tierFromId(plinkId, { pro: PLINK_PRO, power: PLINK_POWER });
  if (typeof obj.subscription === "string") subToStamp = obj.subscription;
} else if (type === "customer.subscription.updated") {
```

(Add the `StripeObject` field changes noted above.)

- [ ] **Step 6: Re-run the webhook logic tests**

Run: `deno test supabase/functions/stripe-webhook/logic_test.ts`
Expected: PASS.

- [ ] **Step 7: Deploy the updated function (when ready to go live)**

Run: `supabase functions deploy stripe-webhook --no-verify-jwt`
(Deferred until live config is set; the logic is verified by tests regardless.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/stripe-webhook/logic.ts supabase/functions/stripe-webhook/logic_test.ts supabase/functions/stripe-webhook/index.ts
git commit -m "feat(license): webhook records website checkouts as pending entitlements"
```

---

### Task 13: Claude Design prompt for the frontend

**Files:**
- Create: `docs/claude-design-prompt-website.md`

**Interfaces:**
- Produces: a self-contained prompt for Claude Design to build the website frontend (pages/components) that calls the Task 7–11 routes.

- [ ] **Step 1: Write `docs/claude-design-prompt-website.md`**

Include, in full:
1. **Role/goal:** build the public marketing website frontend for Flowstate, a local AI agent desktop app, as Next.js App Router pages/components in the existing `website/` app. Match the app's visual identity exactly. Do NOT modify anything under `website/app/api`, `website/lib`, or `website/supabase` — those are the backend; build only UI that calls them.
2. **Design tokens (verbatim from `src/renderer/src/styles.css`):** the full monochrome palette (`--bg #0e0d0c`, `--bg-elev`, `--surface`/`-2`/`-3`, borders, ink scale `--ink`..`--ink-quiet`, accent platinum `--accent #e8e3d5` + hover/soft/glow, status `--good #c8c2b3` bone / `--bad #a08278` clay — NO other hues), radii `--r-xs..2xl` (4→28), spacing `--s-1..12`, shadows (never >8px spread), motion eases `cubic-bezier(0.16,1,0.3,1)`, durations 120/200/360. Fonts: Inter (UI) + JetBrains Mono (labels/mono). Dark mode only. Tone: "minimalist luxury monochrome — hierarchy through tone weight, not color. Restraint over decoration."
3. **Motion direction (the user explicitly asked for this):** smooth scroll (Lenis or `@studio-freight/react-lenis`), section reveal-on-scroll (fade + small y-translate, staggered, using framer-motion `whileInView`), a restrained parallax-lite hero, button/CTA micro-interactions (subtle scale/translate + accent-glow on hover, spring transitions), animated sticky nav that condenses on scroll. Keep it tasteful and luxurious, never bouncy/playful — match the app's quiet confidence.
4. **Page/section spec (single landing page + a few sub-pages):**
   - **Hero:** product name, one-line value prop ("Local AI agents on your own machine — no API keys, no cloud."), primary CTA "Download" (calls `/api/download/setup`), secondary "See features". Subtle animated backdrop.
   - **Feature showcase** (scroll-driven), mapped to the real app surfaces: Dashboard (multi-agent grid + live status), Multi-agent / Team runs, Flowclaw (control plane), Business autopilot, Trading, Connectors (MCP), Brain (knowledge base), Routines (scheduled tasks). Each feature = a section with copy + a visual/mock.
   - **Pricing:** three cards Free $0 / Pro $5/mo / Max $12/mo with a monthly/annual toggle (annual: Pro $50, Max $120). Buy buttons call `POST /api/checkout` with `{ tier, interval, email? }` and redirect to the returned `url`. Free card → Download.
   - **Download:** prominent block; buttons hit `/api/download/setup` and `/api/download/portable`; show latest version from `GET /api/latest`.
   - **Waitlist:** email field → `POST /api/waitlist`. Success + "already on the list" both show a friendly confirmation.
   - **Contact:** name/email/message → `POST /api/contact`. Include a hidden `website` honeypot input (visually hidden, `tabIndex=-1`, `autocomplete=off`).
   - **Footer:** links, tier note, copyright.
   - **/thanks** and **/pricing** sub-pages for Stripe success/cancel returns.
5. **Exact API contract** — reproduce this table so the frontend wires correctly:

   | Route | Method | Request | Response |
   |---|---|---|---|
   | `/api/waitlist` | POST | `{ email, source? }` | `{ ok: true, already?: true }` |
   | `/api/contact` | POST | `{ name, email, message, website? }` | `{ ok: true }` |
   | `/api/latest` | GET | — | `{ version, notes, pubDate, assets:{ setup, portable } }` or 404 `{ error:'no_release' }` |
   | `/api/download/setup` \| `/portable` | GET | — | 302 redirect to installer (use as an `<a href>`, not fetch) |
   | `/api/checkout` | POST | `{ tier:'pro'\|'power', interval:'monthly'\|'annual', email? }` | `{ url }` → redirect |

   Note `tier` values are `pro`/`power` (display Pro/Max). Errors are `{ error }` with a 4xx/5xx status; show a generic inline message on failure.
6. **Constraints:** no new color hues; reuse the monochrome system; accessible (focus-visible rings, reduced-motion fallback that disables scroll/parallax animation via `prefers-reduced-motion`); responsive.

- [ ] **Step 2: Commit**

```bash
git add docs/claude-design-prompt-website.md
git commit -m "docs(website): Claude Design prompt for the frontend"
```

---

## Self-Review

**Spec coverage:**
- Email waitlist → Task 7 ✓ · Contact → Task 8 ✓ · Download serving + version API → Tasks 9, 10 ✓ · Stripe checkout → Task 11 ✓ · Email-claim reconciliation → Tasks 6 (table) + 12 (webhook) ✓ · Tables/RLS → Task 6 ✓ · Lib/safety (validate, ratelimit, clients) → Tasks 2–5 ✓ · Tests on pure logic → Tasks 2,3,4,5,9,10,12 ✓ · Env scaffold → Task 1 ✓ · Claude Design prompt → Task 13 ✓ · "no UI / decoupled / server-only secrets" → Global Constraints ✓. No gaps.
- Email sending intentionally out of scope (per spec) — no task, correct.
- In-app "claim pending entitlement" intentionally a follow-up (per spec) — backend guarantees the table + webhook row (Tasks 6, 12), no task here, correct.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output.

**Type consistency:** `priceIdFor(tier, interval, env)` defined T3, used T11 identically. `supabaseAdmin()`/`stripeClient()` defined T5, used T7–11. `shapeRelease`/`ReleaseRow` T9 consistent. `isVariant` T10 consistent. `decideWebsiteEntitlement` signature T12 matches test + index.ts usage. `waitlist`/`contacts`/`releases`/`download_counts`/`pending_entitlements` column names match between T6 migration and T7–12 consumers (`setup_url`/`portable_url`/`pub_date`, `increment_download(p_variant)`, `pending_entitlements{email,tier,subscription_id,status}`).
