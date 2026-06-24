# Flowstate — Claude Design prompt: public marketing website frontend

Hand this whole file to Claude Design in one session. It covers every UI
surface of the **public Flowstate marketing website**. The backend (API
routes, database, PayRam crypto payment integration) is already built — build
only the frontend that calls those routes.

---

## Role / goal

You are building the **public marketing website frontend** for Flowstate, a
local AI agent desktop app. The website lives in the `website/` directory of
the monorepo as a Next.js 14+ App Router project.

**DO NOT modify anything under:**
- `website/app/api/` — these are the backend API routes; call them, don't touch them
- `website/lib/` — server-side utilities (rate limiting, validation, Supabase/PayRam clients)
- `website/supabase/` — database migrations and RLS policies

Your job is to build only the pages, components, and client-side logic that
**call** those existing routes.

---

## Visual identity

The website must match the Flowstate desktop app design system **exactly**.
The app's aesthetic is **minimalist luxury monochrome — warm-neutral grays
only. No hue. Hierarchy through tone weight, not color. Restraint over
decoration.**

### Design tokens (copy verbatim into `website/app/globals.css`)

```css
:root {
  /* Minimalist luxury monochrome — warm-neutral grays only. No hue.
     Hierarchy through tone weight, not color.
     Tokens follow the Flowstate v2 design (Claude Design bundle). */
  --bg: #0e0d0c;              /* near-black, faint warmth */
  --bg-deep: #08080a;          /* page surround behind everything */
  --bg-elev: #131211;
  --surface: #1a1816;
  --surface-2: #22201d;
  --surface-3: #2a2723;
  --border: #26241f;
  --border-strong: #34302a;
  --ink: #f0ece2;             /* warm bone */
  --ink-strong: #faf6ec;       /* peak whites — headings */
  --ink-muted: #a09a8e;
  --ink-faint: #5c574f;
  --ink-quiet: #3a362f;        /* comments, deep faint */
  --accent: #e8e3d5;           /* platinum / near-white */
  --accent-warm: #d6cdb6;      /* secondary accent */
  --accent-hover: #f4efe2;
  --accent-soft: rgba(232, 227, 213, 0.06);
  --accent-glow: rgba(232, 227, 213, 0.12);
  --good: #c8c2b3;             /* lighter bone — no green */
  --good-soft: rgba(200, 194, 179, 0.08);
  --bad: #a08278;              /* muted clay — barely warm, still readable */
  --bad-soft: rgba(160, 130, 120, 0.10);

  /* radii */
  --r-xs: 4px;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 20px;
  --r-2xl: 28px;

  /* spacing */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px;  --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px;  --s-10: 40px; --s-12: 48px;

  /* shadows — never above 8px spread */
  --shadow-xs: 0 1px 0 rgba(0,0,0,0.4);
  --shadow-sm: 0 2px 4px rgba(0,0,0,0.35), 0 1px 1px rgba(0,0,0,0.25);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.3);

  /* motion */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-mid: cubic-bezier(0.45, 0, 0.55, 1);
  --d-fast: 120ms;
  --d-base: 200ms;
  --d-slow: 360ms;
}
```

### Fonts

```css
/* In layout.tsx or globals.css */
/* Inter — UI text */
/* JetBrains Mono — code labels, version strings, mono displays */
```

Use `next/font` to load both. Apply Inter as the base font; JetBrains Mono
only where mono context is needed (version badges, code snippets, labels
on technical cards).

### Dark mode only

The website is **dark mode only**. Set `<html class="dark">` statically — no
light mode toggle, no `prefers-color-scheme` switching. `background-color`
defaults to `var(--bg)`.

---

## Motion direction

Motion must feel **tasteful and luxurious — quiet confidence, never bouncy or
playful**. Match the desktop app's calm motion language. The site is
**interactive**: an animated background reacts to the cursor and scroll, and
sections animate as a function of scroll position (not just on/off reveal). All
of it stays **monochrome and restrained** — motion is felt, not stared at. No
hue ever enters; depth and life come from tone, blur, grain, and slow drift.

### Interactive animated background

A persistent, full-viewport background canvas sits behind all content
(`position: fixed; inset: 0; z-index: -1; pointer-events: none`) and is
**alive + cursor-reactive**, never a static image. Build it as one client
component `<InteractiveBackground />` mounted once in the root layout. Keep it
**strictly monochrome** — only the warm-neutral palette tokens, no hue, low
contrast so text always wins.

Direction (pick the approach you can make genuinely smooth at 60fps):
- **Drifting field of faint nodes/grain.** A sparse constellation of dim
  points/lines (think a quiet "agent network") drifting slowly over `--bg`.
  Near the cursor, points brighten toward `--ink-faint`/`--accent-soft` and
  lines connect within a small radius — a soft gravitational lens that follows
  the pointer. Away from the cursor it settles back to near-invisible.
- **Cursor spotlight + grain.** A large, very soft radial `--accent-glow`
  gradient (~6–10% opacity) that eases toward the pointer with lag
  (lerp ~0.06/frame), layered over an animated film-grain/noise texture that
  slowly shifts. The spotlight reveals a faint geometric grid only where it
  passes.

Requirements either way:
- Pointer position drives it with **easing/lag**, never 1:1 snapping. Use a
  `requestAnimationFrame` loop with linear interpolation toward the target.
- **Scroll-reactive too:** background drift speed / parallax offset / grid
  density shift subtly with `useScroll` progress, so scrolling feels connected
  to the backdrop (tie into the hero parallax below).
- Canvas/WebGL is fine, but **throttle**: cap DPR at ~1.5, pause the rAF loop
  when the tab is hidden (`document.hidden`) and when the canvas is fully
  scrolled out of view (IntersectionObserver), and debounce resize.
- On touch / no fine pointer (`(pointer: coarse)`), drop the cursor reactivity
  and keep only the slow autonomous drift.
- It must read as **luxury ambience**: slow, low-opacity, blurred. If it ever
  competes with the copy, it's too strong — dial opacity/contrast down.

### Smooth scroll

Use **Lenis** (`@studio-freight/react-lenis`) for smooth scroll. Wrap the
root layout in `<ReactLenis root>`. Disable Lenis entirely when
`prefers-reduced-motion` is active.

```tsx
// app/layout.tsx (simplified)
import { ReactLenis } from '@studio-freight/react-lenis'

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body>
        <ReactLenis root>{children}</ReactLenis>
      </body>
    </html>
  )
}
```

### Scroll-reveal sections

Use **framer-motion** `whileInView` for section entry animations. Every major
content section (feature cards, pricing, etc.) fades in with a small upward
translate. Stagger child elements.

```tsx
// Canonical reveal pattern
const sectionVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } },
}

<motion.section
  variants={sectionVariants}
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, margin: '-80px' }}
>
```

Use `staggerChildren: 0.08` in parent variants to stagger card/item entry.
Keep `once: true` so elements don't re-animate on scroll-up.

### Interactive scroll animations (scroll-linked, not just reveal)

Beyond one-shot `whileInView` reveals, make key elements animate **as a
continuous function of scroll position** using framer-motion `useScroll` +
`useTransform` (and `useSpring` to smooth the value). The page should feel
"scrubbed" by the scroll, not just toggled.

- Per-section `useScroll({ target: ref, offset: ['start end', 'end start'] })`,
  mapping `scrollYProgress` to subtle `y`, `opacity`, `scale`, or `blur` —
  e.g. feature visuals rise + sharpen (blur → 0) as they cross center, then
  ease back. Keep ranges small (luxury, not a rollercoaster): `y` within
  ~±32px, `scale` within 0.98–1.02.
- A thin top **scroll-progress bar** (1px, `--accent` at low opacity) driven by
  the page `scrollYProgress` — quiet, optional but on-brand.
- Numbers/section headings can do a small parallax counter-shift vs their
  section so layers feel layered.
- Wrap raw progress in `useSpring(progress, { stiffness: 120, damping: 30 })`
  so the motion is silky, never jumpy. These scroll-linked transforms ride on
  top of Lenis smooth scroll, so the whole page feels one connected surface.

### Hero

A **restrained parallax-lite hero** layered over the global
`<InteractiveBackground />`: a mid-layer (subtle noise texture or abstract
geometric grid) shifts at ~0.3× the scroll speed using a `useScroll` +
`useTransform` hook while the foreground text stays put. In the hero the
interactive background is at its most present (cursor reactivity most visible
here), then fades to quieter ambience as you scroll into the content. Keep the
depth subtle — accent, not spectacle.

### Button / CTA micro-interactions

Primary CTA buttons:
- `whileHover`: subtle `scale: 1.015` + `y: -1` (spring, `stiffness: 400, damping: 30`)
- `whileTap`: `scale: 0.985`
- Hover state adds `box-shadow: 0 0 0 1px var(--accent-glow), 0 0 16px var(--accent-glow)` — the "accent-glow" pulse
- Transition on background/color: `var(--d-base) var(--ease)`

Secondary/ghost buttons: no scale, only color/border opacity shift.

### Sticky nav condensing

The nav starts at full height (~64px) with the logo at full size. On scroll
past ~80px, it condenses to ~48px height and the logo scales down slightly.
Animate with `transition: height var(--d-base) var(--ease), ...`. Use a
`useScroll` listener (`scrollY > 80`) to toggle a `data-condensed` attribute
or CSS class. Add `backdrop-filter: blur(16px) saturate(1.2)` when condensed.

### Reduced motion fallback

Wrap all motion primitives with a `useReducedMotion()` hook (framer-motion
exports this). When true:
- Pass `{ duration: 0 }` overrides or `initial={false}` to all motion
  components
- Disable Lenis by checking the same condition before initializing
- Skip parallax transforms entirely
- Skip all scroll-linked `useTransform`/`useSpring` motion — render elements in
  their final state
- `<InteractiveBackground />` drops its rAF animation and cursor reactivity and
  renders a single **static** monochrome gradient/grain frame (or nothing) — no
  motion, no pointer tracking

```tsx
const prefersReduced = useReducedMotion()
// Then: <motion.div animate={{ opacity: 1 }} transition={prefersReduced ? { duration: 0 } : undefined}>
```

---

## Page architecture

### Routes

```
website/app/
  page.tsx              ← single landing page (all sections)
  pricing/page.tsx      ← standalone /pricing page
  thanks/page.tsx       ← /thanks post-checkout success page
  layout.tsx            ← root layout (Lenis, fonts, nav, footer)
  globals.css           ← tokens above + base resets
```

### Navigation (sticky, condensing)

```
[Flowstate logo]   Features   Pricing   Download   [Download CTA button]
```

- Logo links to `/#hero`
- "Features", "Pricing", "Download" are smooth-scroll anchor links (Lenis
  handles the easing)
- Right CTA button: primary style, links to `/#download`
- Mobile: hamburger menu, full-screen overlay drawer, same links

---

## Landing page sections (`website/app/page.tsx`)

### 1. Hero

**Position:** top of page, full-viewport-height (100dvh), centered.

**Content:**
- Product name: `Flowstate` — large display heading, `--ink-strong`
- Tagline: `Local AI agents on your own machine — no API keys, no cloud.`
  in `--ink-muted`
- Primary CTA: "Download for Windows" — an `<a href="/api/download/setup">`
  (NOT a fetch — it's a direct 302 redirect to the installer). Style as the
  primary button with accent-glow hover.
- Secondary CTA: "See features" — ghost button, smooth-scrolls to
  `#features`
- Subtle animated backdrop: a slow-drifting geometric grid or noise overlay
  at low opacity (`--accent-soft`). Keep it barely perceptible — atmosphere,
  not art. Parallax at 0.3× scroll speed.
- Version badge: fetch `GET /api/latest` on mount; show `v{version}` in a
  small JetBrains Mono pill below the CTAs. If 404, hide it gracefully.

```tsx
// Version fetch pattern
const [release, setRelease] = useState<{ version: string } | null>(null)
useEffect(() => {
  fetch('/api/latest')
    .then(r => r.ok ? r.json() : null)
    .then(setRelease)
    .catch(() => {})
}, [])
```

---

### 2. Feature showcase (`#features`)

**Layout:** alternating left/right or stacked cards as the design fits,
scroll-driven reveal. One card per app surface.

Map each feature to a real Flowstate app surface in this order:

| Feature card | App surface | Suggested copy hook |
|---|---|---|
| **Dashboard** | Multi-agent grid with live status rings, run counts, memory usage | "Every agent at a glance. One command center." |
| **Multi-agent / Team runs** | Parallel agent orchestration, fan-out tasks | "Fan out. Coordinate. Converge — all locally." |
| **Flowclaw** | Gateway control plane (OpenClaw/Hermes), model picker, live run watcher | "Your own gateway. Your own models. Zero cloud dependency." |
| **Business autopilot** | Business task automation, scheduled workflows | "Automate the repetitive. Own the output." |
| **Trading** | Research, analyse, predict — stocks + crypto | "Market signals, local inference. No data leaves your machine." |
| **Connectors (MCP)** | MCP server registry, secret management, test buttons | "Connect any tool. Keep secrets secret." |
| **Brain** | Knowledge base ingestion, vector search | "Long-term memory for your agents. Grows with your work." |
| **Routines** | Scheduled tasks, cron-driven agent runs | "Set it. Forget it. Audit it later." |

Each card contains:
- Feature name (heading, `--ink-strong`)
- One-sentence description (`--ink-muted`)
- A visual: an abstract mock or a simplified wireframe of the app surface
  (static illustration, monochrome, uses only the design tokens above —
  no photography, no colorful icons)
- Revealed via `whileInView` with stagger

---

### 3. Pricing (`#pricing`)

**Layout:** three cards side by side (responsive: stack on mobile).

**Toggle:** monthly / annual billing switch at the top. Defaults to monthly.

| Tier | Display name | Monthly price | Annual price |
|---|---|---|---|
| Free | Free | $0 | $0 |
| pro | Pro | $5/mo | $50/yr |
| power | Max | $12/mo | $120/yr |

Note: the API tier names are `pro` and `power` (not "Max"). Display "Max"
in the UI but send `tier: 'power'` to the API.

**Billing copy (below the price):** "Pay with crypto — one-time, renews each period."

**Card anatomy:**
- Tier name + price (large, `--ink-strong`)
- Billing period label (`--ink-muted`)
- Billing copy: "Pay with crypto — one-time, renews each period." (`--ink-muted`, smaller)
- Feature list (checkmark rows; use `--good` tinted dot or `✓`)
- CTA button

**CTA behaviour:**
- Free card → `<a href="/api/download/setup">` (same as hero Download)
- Pro/Max cards → collect the user's **email** first (show an email input
  above the button if not yet provided — it is required), then call
  `POST /api/checkout` on click:

```tsx
async function startCheckout(
  tier: 'pro' | 'power',
  interval: 'monthly' | 'annual',
  email: string,
) {
  if (!email) {
    setCheckoutError('Please enter your email to continue.')
    return
  }
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier, interval, email }),
  })
  if (!res.ok) {
    const { error } = await res.json()
    setCheckoutError(error ?? 'Something went wrong. Please try again.')
    return
  }
  const { url } = await res.json()
  window.location.href = url  // PayRam hosted crypto payment page
}
```

Show a loading spinner on the card button while the request is in-flight.
Show an inline error message below the button if the request fails (use
`--bad` colour). Never show a modal — inline only.

The Pro card should have a subtle `--border-strong` ring and "Most popular"
badge to differentiate it.

---

### 4. Download (`#download`)

**Layout:** prominent full-width block, centered.

**Content:**
- Heading: "Download Flowstate"
- Subheading: "Windows · Free to start"
- Two download buttons side by side:
  - "Download Setup (.exe)" → `<a href="/api/download/setup">` direct link
  - "Download Portable (.zip)" → `<a href="/api/download/portable">` direct link
  - Both are `<a>` tags (not fetch) because the route 302-redirects to the
    installer. Do NOT intercept with JavaScript.
- Version + release date: fetch `GET /api/latest` on mount and display
  `v{version} · Released {pubDate}` in JetBrains Mono below the buttons.

```tsx
// /api/latest response shape
type LatestRelease = {
  version: string
  notes: string
  pubDate: string
  assets: { setup: string; portable: string }
}
// On 404 → { error: 'no_release' } — hide the version line gracefully
```

---

### 5. Waitlist (`#waitlist`)

**Layout:** centered narrow column, ~480px max-width.

**Content:**
- Heading: "Join the waitlist"
- Short copy: "Be first to know when new features and tiers ship."
- Single email input + "Join" button

**Behaviour:**
- On submit: `POST /api/waitlist` with `{ email, source: 'website' }`
- Success (`{ ok: true }`): replace form with "You're on the list!" message
- Already subscribed (`{ ok: true, already: true }`): show "You're already
  on the list — we'll be in touch." — still friendly, not an error
- Network/server error: show inline `--bad` message "Something went wrong.
  Please try again."
- Disable the button and show a subtle spinner while in-flight

```tsx
const res = await fetch('/api/waitlist', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, source: 'website' }),
})
const data = await res.json()
if (!res.ok) { setError(true); return }
setSuccess(data.already ? 'already' : 'new')
```

---

### 6. Contact (`#contact`)

**Layout:** centered narrow column, ~600px max-width.

**Content:**
- Heading: "Get in touch"
- Three visible fields: Name, Email, Message (textarea)
- One **hidden honeypot field**: `website` — visually hidden, not a
  `display:none` (screen readers skip it via `tabIndex` and `aria-hidden`)

```tsx
{/* Honeypot — leave empty; bots fill it */}
<input
  type="text"
  name="website"
  value={honeypot}
  onChange={e => setHoneypot(e.target.value)}
  tabIndex={-1}
  aria-hidden="true"
  autoComplete="off"
  style={{
    position: 'absolute',
    left: '-9999px',
    width: '1px',
    height: '1px',
    opacity: 0,
    pointerEvents: 'none',
  }}
/>
```

**Behaviour:**
- On submit: `POST /api/contact` with `{ name, email, message, website }`
  (the honeypot value is always sent; the backend ignores real submissions
  where it's empty and discards spam where it's filled)
- Success: replace form with "Message sent — we'll get back to you soon."
- Error: inline `--bad` message

```tsx
const res = await fetch('/api/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, message, website: honeypot }),
})
```

---

### 7. Footer

**Content:**
- Left: Flowstate logo (small) + copyright `© {year} Flowstate`
- Center: nav links (Features · Pricing · Download · Contact)
- Right: tier note — "Free to start. Pro and Max plans available."
- Bottom micro-line: "Built for local inference. Your data stays on your machine."

---

## Sub-pages

### `/pricing`

A dedicated pricing page (same three-card layout as the landing section, but
full-page with its own hero heading). Also serves as a standalone pricing page
from nav.

### `/thanks`

Post-checkout status page. The URL includes `?ref=<reference_id>` (the PayRam
reference ID returned after the checkout redirect). This page **polls** the
backend until the payment is resolved.

**Behaviour:**
1. On mount, read `reference_id` from the URL query string (`?ref=...`).
2. Poll `GET /api/payment-status/<reference_id>` every 3 seconds.
3. While polling, show a "Waiting for payment confirmation…" spinner state.
4. When `status === 'FILLED'`: stop polling, show the success state.
5. When `status === 'CANCELLED'`: stop polling, show the retry state.
6. For any other status (`OPEN`, `PARTIALLY_FILLED`, `OVER_FILLED`): keep
   polling (backend handles partial/over-filled server-side).

**Success state:**
- Heading: "You're all set."
- Body: "Your payment has been confirmed. Download the app and log in to
  unlock your tier."
- CTA: "Download Flowstate" → `/api/download/setup`

**Retry state (CANCELLED):**
- Heading: "Payment not completed."
- Body: "Your payment was cancelled or expired. No funds were taken."
- CTA: "Try again" → `/pricing` (let them restart)

```tsx
// Polling pattern
useEffect(() => {
  if (!referenceId) return
  const interval = setInterval(async () => {
    const res = await fetch(`/api/payment-status/${referenceId}`)
    if (!res.ok) return  // network hiccup — keep polling
    const { status } = await res.json()
    if (status === 'FILLED') { clearInterval(interval); setPayState('success') }
    if (status === 'CANCELLED') { clearInterval(interval); setPayState('cancelled') }
  }, 3000)
  return () => clearInterval(interval)
}, [referenceId])
```

**Important:** This page is UX-only. Entitlement (tier upgrade) is granted
server-side by the PayRam webhook when the `FILLED` event arrives — the
frontend simply reflects state, it does not grant access.

---

## API contract (exact shapes — wire precisely)

| Route | Method | Request body | Response |
|---|---|---|---|
| `/api/waitlist` | POST | `{ email: string, source?: string }` | `{ ok: true, already?: true }` |
| `/api/contact` | POST | `{ name: string, email: string, message: string, website?: string }` | `{ ok: true }` |
| `/api/latest` | GET | — | `{ version, notes, pubDate, assets: { setup: string, portable: string } }` or 404 `{ error: 'no_release' }` |
| `/api/download/setup` | GET | — | 302 redirect to installer — use as `<a href>`, NOT fetch |
| `/api/download/portable` | GET | — | 302 redirect to portable zip — use as `<a href>`, NOT fetch |
| `/api/checkout` | POST | `{ tier: 'pro' \| 'power', interval: 'monthly' \| 'annual', email }` (**email required**) | `{ url }` → redirect to PayRam hosted crypto payment page; errors: `{ error: string }` with 4xx/5xx |
| `/api/payment-status/[reference_id]` | GET | — | `{ status: 'OPEN' \| 'FILLED' \| 'CANCELLED' \| 'PARTIALLY_FILLED' \| 'OVER_FILLED' }` |

**Notes:**
- `tier` values sent to the API are `pro` and `power`. Display "Pro" and
  "Max" in the UI respectively.
- `email` is **required** in the checkout body — collect it before calling
  the endpoint.
- Download routes are **direct `<a href>` links only** — never `fetch()`.
  The 302 redirect must reach the browser natively.
- On any 4xx/5xx from POST endpoints, parse `{ error }` and show a generic
  inline message. Do not throw or navigate.
- `/api/payram-webhook` is **server-to-server** (PayRam → backend). The
  frontend never calls it.

---

## Constraints and accessibility

### No new hues

Do not introduce any color not in the token list above. No blues, greens,
purples, or brand reds. The only palette is warm-neutral monochrome +
platinum accent. `--good` is bone (not green). `--bad` is clay (not red).

### Focus-visible rings

All interactive elements must have a visible focus ring:

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: var(--r-sm);
}
```

Never suppress outlines without replacing them.

### Reduced motion

```tsx
// All motion components:
const prefersReduced = useReducedMotion() // from framer-motion
// If true → skip whileInView animations (set initial={false} or duration 0)
// Disable Lenis ReactLenis root when true
// Skip parallax transforms in hero
```

### Responsive breakpoints

- Mobile first. Stacking below 768px.
- Nav collapses to hamburger below 640px.
- Pricing cards: 3-up ≥ 1024px, 1-up < 768px, 2-up in between (or 1-up for
  cleaner layout — designer's call).
- Feature showcase: alternating layout on desktop, single column on mobile.
- Max content width: 1200px centered.

### Semantic HTML

- `<nav>`, `<main>`, `<section>`, `<footer>` landmarks.
- Headings in logical order (h1 once per page, h2 per section, h3 per card).
- Form inputs with associated `<label>` elements (not placeholder-only).
- Buttons have descriptive accessible names.

---

## Component vocabulary (suggested)

These are suggestions — adapt as the design evolves, but keep naming
consistent:

```
components/
  InteractiveBackground.tsx — fixed cursor+scroll-reactive monochrome canvas (mounted once in layout)
  ScrollProgressBar.tsx     — 1px top progress bar driven by page scrollYProgress
  Nav.tsx              — sticky condensing nav
  Hero.tsx             — full-viewport hero with parallax (over InteractiveBackground)
  FeatureSection.tsx   — scroll-reveal feature cards
  FeatureCard.tsx      — individual feature card
  PricingSection.tsx   — billing toggle + three cards
  PricingCard.tsx      — single pricing card with checkout logic
  DownloadSection.tsx  — download buttons + version display
  WaitlistForm.tsx     — email capture with success states
  ContactForm.tsx      — name/email/message + honeypot
  Footer.tsx           — links + copyright
```

---

## Tone and copy style

- Headlines: short, confident, product-benefit focused. No hype.
- Body: plain English. Technical where accurate, never buzzword-heavy.
- CTAs: imperative verbs — "Download", "Join", "Send", "Get started".
- No exclamation marks in headings. Restraint in punctuation.
- Align with the app's aesthetic: **quiet confidence**.

---

## What to deliver

1. All pages and components under `website/` (App Router)
2. `website/app/globals.css` with the full token block above
3. Lenis + framer-motion wired in layout
4. `<InteractiveBackground />` — cursor + scroll-reactive monochrome animated
   background, mounted once in the root layout, throttled and reduced-motion-aware
5. Scroll-linked (scrubbed) section animations + a top scroll-progress bar, on
   top of the `whileInView` reveals
6. All six API integrations working (waitlist, contact, download x2, latest
   version, checkout)
7. The honeypot field in the contact form
8. Accessible focus rings + reduced-motion fallback throughout (background +
   scroll-linked motion both disabled when `prefers-reduced-motion`)
9. Responsive layout (mobile → desktop), with cursor reactivity gracefully
   dropped on touch / coarse pointers

Do not create any files outside `website/`. Do not add new API routes or
modify existing ones under `website/app/api/`, `website/lib/`, or
`website/supabase/`.
