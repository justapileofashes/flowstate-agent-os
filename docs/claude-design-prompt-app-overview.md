  # Flowstate — Claude Design master brief: the whole app

  Hand this file to Claude Design **first**, before any feature-specific prompt.
  It is the single source of truth for *what Flowstate is*, *how it's built*, *its
  design language*, and *every feature surface*. Read it end-to-end so any screen
  you design fits the existing product exactly — same vocabulary, same restraint,
  no new visual language.

  Per-feature prompts (`claude-design-prompt-*.md`) build on top of this; this
  file is the shared context they all assume.

  ---

  ## 1. What Flowstate is

  Flowstate is a **local-first AI agent desktop app**. It runs AI agents on the
  user's own machine — local inference via **Ollama**, no API keys required, no
  cloud dependency, no data leaving the device. It is a calm, dense **command
  center** for running many agents at once: research, automation, trading
  analysis, business autopilot, meeting capture, knowledge management.

  Positioning in one line: *"Local AI agents on your own machine — no API keys,
  no cloud."*

  The product personality is **quiet confidence**. It is a power-user tool that
  looks expensive and restrained, not a flashy consumer app. Think a luxury
  terminal: monochrome, dense, precise, fast.

  ---

  ## 2. The core primitive: agents

  Everything orbits **agents**. An agent is a configured persona with:
  - a **model** (a local Ollama model, auto-matched to the agent's role/hardware),
  - **tools** it can call (file ops, shell, web, MCP connectors, etc.),
  - **memory** (short-term chat context + long-term "Brain"),
  - a **chat** surface where the user (or a schedule) drives it.

  Derived concepts the UI exposes everywhere:
  - **Chats** — a conversation/run with one agent. Routines and appliances spin up
    fresh chats per run.
  - **Team runs / multi-agent** — several agents fan out on one task in parallel,
    then converge. The Business tab is a structured, scheduled instance of this.
  - **Runs have status** — idle / streaming / done / error — surfaced as status
    rings, pills, and pulsing dots throughout.
  - **Local inference** — all model calls go through Ollama on the user's box.
    "No data leaves your machine" is a hard product promise; never design a
    surface that implies cloud upload of user data.

  ---

  ## 3. Stack & architecture

  - **Electron** (main / preload / renderer) + **React** + **TypeScript**, built
    with **Vite** (`electron.vite.config.ts`).
  - **framer-motion** for transitions. **Tailwind** + a custom CSS layer in
    `src/renderer/src/styles.css` (the tokens + class vocabulary below live here).
  - **Dark mode ONLY.** No light theme, no theme toggle.
  - **Fonts:** Inter (all UI text), JetBrains Mono (labels, version strings, code,
    terminal/feed regions, numeric displays).
  - **All main↔renderer communication goes through IPC**, surfaced to the renderer
    as `window.flowstate.*` and typed in `src/renderer/src/lib/ipc.ts` as `ipc.*`.
    Channel DTOs live in `src/shared/ipc-channels.ts`. When you design a screen,
    call the existing `ipc.<domain>.*` methods — never invent a transport. If a
    shape is missing, note the assumed gap rather than guessing silently.
  - Backend services live in `src/main/services/` (one file per domain:
    `license-service`, `second-brain`, `mcp-manager`, `business-sprint`,
    `stock-analysis`, `flowclaw-store`, `capture-recorder`, `zoom-service`,
    `model-catalog`, `secret-store`, `audit-logger`, `budget`, `notify`, …).
  - Renderer screens live in `src/renderer/src/screens/`. Top-level shell +
    left-sidebar nav is `src/renderer/src/App.tsx` (a `View` union switches the
    active screen).

  ---

  ## 4. Design system — USE THESE TOKENS (they already exist as CSS variables)

  **"Minimalist luxury monochrome — warm-neutral grays only. NO HUE. Hierarchy
  through tone weight, not color."** Restraint over decoration. No blues, greens,
  purples, brand reds — ever. `--good` is bone (not green), `--bad` is clay (not
  red). Depth comes from tone, blur, grain, slow motion — never color.

  ```css
  /* Surfaces */
  --bg: #0e0d0c;  --bg-elev: #131211;  --surface: #1a1816;
  --surface-2: #22201d;  --surface-3: #2a2723;
  --border: #26241f;  --border-strong: #34302a;
  /* Ink */
  --ink: #f0ece2;  --ink-strong: #faf6ec; /* headings */  --ink-muted: #a09a8e;
  --ink-faint: #5c574f;  --ink-quiet: #3a362f;
  /* Accent — platinum / near-white */
  --accent: #e8e3d5;  --accent-warm: #d6cdb6;  --accent-hover: #f4efe2;
  --accent-soft: rgba(232,227,213,0.06);  --accent-glow: rgba(232,227,213,0.12);
  /* Status (still monochrome) */
  --good: #c8c2b3;  --good-soft: rgba(200,194,179,0.08);
  --bad: #a08278;   --bad-soft: rgba(160,130,120,0.10);
  /* Radii 4→28: --r-xs --r-sm --r-md --r-lg --r-xl --r-2xl */
  /* Spacing 4→48: --s-1 --s-2 --s-3 --s-4 --s-5 --s-6 --s-8 --s-10 --s-12 */
  /* Shadows --shadow-xs..lg — never above 8px spread */
  /* Motion */
  --ease / --ease-out-expo: cubic-bezier(0.16,1,0.3,1);
  --ease-in: cubic-bezier(0.7,0,0.84,0);  --ease-mid: cubic-bezier(0.45,0,0.55,1);
  --d-fast: 120ms;  --d-base: 200ms;  --d-slow: 360ms;
  ```

  **Reuse the existing class vocabulary** (already in `styles.css`): `.glass`,
  `.sidebar`, `.nav-row`(`.active`, `.nav-row-locked`), `.btn` / `.btn-sm` /
  `.btn-primary`, `.pill`(`.good` / `.bad` / `.streaming`), `.dot`(`.dot-good` /
  `.dot-pulse`), `.settings-section`, `.field`, `.badge`, `.hint`, `.card`,
  `.glass`. Icons are **16×16 inline SVG, `stroke="currentColor"`, `fill="none"`**
  — match the NavRow icons in `App.tsx`. Don't import an icon library or add
  colored/filled icons.

  **Motion language:** calm and luxurious — quiet confidence, never bouncy or
  playful. Screen transitions use framer-motion `AnimatePresence` (see how
  `App.tsx` wraps each view). Honor `prefers-reduced-motion` and provide visible
  `:focus-visible` rings on every interactive element.

  ---

  ## 5. The shell & navigation (`src/renderer/src/App.tsx`)

  A fixed left sidebar of `<NavRow>`s switches a `View` union. Order top→bottom
  (some rows are hideable via prefs `hiddenNav`, and some are tier-locked — see
  §7):

  | Nav row | View kind | Tier | One-liner |
  |---|---|---|---|
  | **Dashboard** | `dashboard` | Free | Multi-agent grid — every agent at a glance |
  | **Business** | `business` | **Max** (power) | "Run your business" daily-sprint autopilot |
  | **Stocks** | `stocks` | **Pro** | Research / analyse / predict stocks + crypto |
  | **Models** | `models` | Free | Browse + download local Ollama models |
  | **Brain** | `brain` | Free | Long-term knowledge base + vector search |
  | **Connectors** | `connectors` | Free | One-click MCP integrations + secrets |
  | **Flowclaw** | `flowclaw` | **Max** (power) | Gateway control plane + appliances |
  | **Routines** | `routines` | Free | Scheduled (cron) agent runs |
  | **Settings** | `settings` | Free | Account / license / models / prefs |
  | *(per-agent)* | `chat` | Free | The chat shell for one agent |

  Locked rows show a `<LockBadge tier="pro|power">` and route to the upgrade
  surface instead of the screen. A top "subtitle" map + `document.title` track the
  active view.

  ---

  ## 6. Every feature surface (what each screen is)

  ### Dashboard (`Dashboard.tsx`)
  The home command center. A grid of agent cards — each with a **live status ring**
  (idle/streaming/done/error), run counts, memory/context usage, and a click-through
  to that agent's chat. The composer here can route a free-form task to the right
  agent (or create one). This is the "every agent at a glance" surface.

  ### Chat (`Chat.tsx`)
  The per-agent conversation shell: streaming responses, tool-call traces, file
  mentions, context-cap awareness per model, prompt history/snippets. Also hosts
  **team mode** (multi-agent fan-out on one task). Routines, Zoom, and Capture all
  deep-link into a chat (`chatId`) for their summary/output.

  ### Business (`Business.tsx`) — Max/power
  Polsia-style autopilot. A setup wizard captures a company profile (name, product,
  audience, goals, links, daily schedule) and auto-creates three role agents
  (Strategy / Marketing / Ops). A **daily sprint** plans → executes in parallel →
  writes a briefing. Outward actions (emails, posts, code) never auto-execute —
  they queue as **proposed actions** in an approval queue the user accepts/rejects.
  Centerpiece surfaces: live activity feed (mono, aria-live), approval queue,
  briefing (markdown), sprint history. IPC: `ipc.business.*`. See
  `claude-design-prompt-all-features.md` for the full screen spec.

  ### Stocks (`Stocks.tsx`) — Pro
  Research / analyse / predict a symbol (stocks + crypto). Live watchlist,
  candlestick chart with the AI's **forward forecast** + detected patterns, a
  buy/hold/sell **signal** (entry · stop-loss · take-profit), a factor breakdown,
  and a risk calculator. All inference local. **Persistent banner: "Educational
  analysis — NOT financial advice."** Free tier sees the chrome behind a locked
  overlay (no IPC called). IPC: `ipc.stocks.*`. See `claude-design-prompt-stocks.md`.

  ### Models (`Models.tsx`)
  Browse the model catalog and manage local Ollama models. Filter tags
  (all/general/code/reasoning/vision/small), download with live pull progress, and
  auto-assign/match models to agents based on role + hardware. IPC:
  `ipc.models.*` (catalog, pull progress, auto-assign).

  ### Brain (`Brain.tsx`)
  Long-term memory for agents — a personal knowledge base. Categories
  (Inbox/…fleeting captures, etc.), note ingestion, and **vector search** over
  everything. "Grows with your work." IPC: `ipc.brain.*`.

  ### Connectors (`Connectors.tsx`)
  One-click **MCP** (Model Context Protocol) integrations. Each preset is a known
  MCP server Flowstate can spawn; adding one writes to the same `settings.mcp_servers`
  store Settings uses. Per-connector: **encrypted secret management** (write-only,
  masked, never read back) and a **Test** button. "Connect any tool. Keep secrets
  secret." See also `McpServersCard.tsx`.

  ### Flowclaw (`Flowclaw.tsx`) — Max/power
  Control plane over self-hosted agent **gateways**: OpenClaw (local WebSocket) and
  Hermes (REST, OpenAI-compatible). Manage connections (kind/host/port/token/model,
  Test, enable/disable), pick a model per connection, target tasks at a backend,
  watch live runs. Plus an **Appliances** tab: **Meetings** (Zoom Server-to-Server
  recorder → transcribe → summarize) and **Capture** (records ANY meeting/webinar
  via local system-audio, no paid plan, with a required consent notice). IPC:
  `ipc.flowclaw.*`, `ipc.zoom.*`, `ipc.capture.*`. Full spec in
  `claude-design-prompt-all-features.md` and `claude-design-prompt-flowclaw-capabilities.md`.

  ### Routines (`Routines.tsx`)
  Claude-Code-style scheduled agents. Pick an agent + prompt + a friendly schedule
  (hourly / daily / weekdays / weekly / interval / raw cron). A backend ticker
  fires each routine on schedule, spinning up a fresh chat per run; click a
  routine's last run to open that session. Routines can optionally target a
  Flowclaw connection. IPC: `ipc.routines.*`.

  ### Settings (`Settings.tsx`)
  Account + license (Supabase auth, tier state via `useLicense`), model defaults,
  connectors/MCP store, notifications, budget, audit log, dev tools, and the
  upgrade/paywall entry. Tier labels: `free` → "Free", `pro` → "Pro", `power` →
  "Power" internally (the marketing/website name for `power` is **"Max"**).

  Supporting surfaces also worth knowing: agent **packs** (importable bundles of
  preconfigured agents), desktop **notifications**, **budget**/token-estimate
  guards, **audit logging**, **snapshots/backup**, run export. See
  `claude-design-prompt-agent-packs-notify.md` and
  `claude-design-prompt-paywall-upgrade.md`.

  ---

  ## 7. Tiers & monetization

  Three tiers. Marketing names vs API/internal names matter — **display the
  marketing name, gate on the internal one**:

  | Marketing | Internal/API | Price (mo / yr) | Unlocks |
  |---|---|---|---|
  | **Free** | `free` | $0 | Dashboard, Chat, Models, Brain, Connectors, Routines |
  | **Pro** | `pro` | $5 / $50 | + **Stocks** |
  | **Max** | `power` | $12 / $120 | + **Business**, **Flowclaw** (everything) |

  - Auth = Supabase; entitlement = signed tier claim (ES256/JWKS) checked by
    `license-service` / `entitlements-service`; the renderer gates nav via
    `allowed(surface)` + `<LockBadge>`.
  - Payments on the **website** are crypto via **PayRam** (one-time, renews each
    period — no card subscriptions). In-app upgrade routes to the paywall surface.
  - Locked surfaces must **never call their IPC** — render the chrome behind a
    locked overlay (Stocks does exactly this) and route to upgrade.

  ---

  ## 8. Hard constraints (apply to every screen)

  - **No new hues.** Monochrome warm-neutral + platinum accent only. `--good` is
    bone, `--bad` is clay.
  - **Secrets are write-only across IPC** — masked password inputs, never read
    back, show a "saved" state. (Tokens, API keys, client secrets.)
  - **Local-first promise** — never imply user data is uploaded to a cloud.
  - **Dark mode only.** Inter for UI, JetBrains Mono for labels/code/feeds/numbers.
  - **Accessibility** — visible `:focus-visible` rings, `aria-live` for streaming
    feeds, keyboard support, `prefers-reduced-motion` honored.
  - **Density + calm** — production-grade TSX, no generic "AI app" aesthetics, no
    emoji, no colorful icons, no new palette. Reuse the class vocabulary in §4.
  - **Match existing screens** — new screens follow the structure/idioms of
    `Connectors.tsx`, `Routines.tsx`, `Settings.tsx`, and the `App.tsx`
    `AnimatePresence` view-transition pattern.

  ---

  ## 9. How to use this brief

  1. Read this file fully — it is the app's ground truth.
  2. For a specific surface, read the matching `claude-design-prompt-<feature>.md`;
    it assumes everything here and only adds the screen-level detail + exact IPC.
  3. Always call the real `ipc.*` methods (typed in
    `src/renderer/src/lib/ipc.ts`); flag any shape you had to assume.
  4. Never introduce a new visual language. When in doubt, choose restraint.
