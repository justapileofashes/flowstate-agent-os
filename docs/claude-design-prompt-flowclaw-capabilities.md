# flowclaw capabilities UI — Claude Design prompt

Hand this to Claude Design to build the renderer surfaces for the 7 agent
capabilities flowclaw drives over OpenClaw/Hermes gateways. The backend is
**already built, wired, and tested** (40 tests passing) — every `ipc.flowclaw.*`
method below exists and is typed in `src/renderer/src/lib/ipc.ts`. Do NOT stub
the IPC; call it for real. Connections home + Add/Edit + Meetings are already
designed (see `docs/claude-design-prompt-all-features.md`) — this prompt adds the
**capability panels** on top of an existing, connected gateway.

---

You are extending "flowclaw", a feature surface in Flowstate, an existing
Electron + React + TypeScript desktop app. Match the existing design system
EXACTLY — no new visual language, no new hues.

## Stack
- Electron (main/preload/renderer) + React + TS, Vite, framer-motion, Tailwind +
  custom CSS layer in `src/renderer/src/styles.css`.
- Fonts: Inter (UI), JetBrains Mono (mono/labels). Dark mode ONLY.

## Design system (USE THESE CSS-VARIABLE TOKENS — they already exist)
"Minimalist luxury monochrome — warm-neutral grays only. NO HUE. Hierarchy through
tone weight, not color." Restraint over decoration.
- Surfaces: --bg #0e0d0c, --bg-elev #131211, --surface #1a1816, --surface-2 #22201d,
  --surface-3 #2a2723. Borders: --border #26241f, --border-strong #34302a.
- Ink: --ink #f0ece2, --ink-strong #faf6ec (headings), --ink-muted #a09a8e,
  --ink-faint #5c574f, --ink-quiet #3a362f.
- Accent (platinum): --accent #e8e3d5, --accent-hover #f4efe2, --accent-soft,
  --accent-glow. Status: --good #c8c2b3 (bone, NOT green), --bad #a08278 (clay,
  NOT red). No other hues — stay monochrome.
- Radii --r-xs..--r-2xl (4->28px). Spacing --s-1..--s-12 (4->48px). Shadows
  --shadow-xs..lg (never >8px spread). Motion --ease-out-expo
  cubic-bezier(0.16,1,0.3,1); durations --d-fast 120 / --d-base 200 / --d-slow 360.
- Reuse class vocabulary: .glass, .nav-row(.active), .btn/.btn-sm/.btn-primary,
  .pill(.good/.bad/.streaming), .dot(.dot-good/.dot-pulse), .settings-section,
  .field, .badge, .hint, .card. 16x16 inline SVG icons, stroke="currentColor",
  fill none (match the NavRow icons in App.tsx).

## Context: where these panels live
The Flowclaw screen already lists connections. Each connection has a `kind`:
`'openclaw'` or `'hermes'`. **Capabilities 3–7 are OpenClaw-only** — Hermes is a
plain chat endpoint with no gateway surface. So:
- Show the capability panels only when the selected connection is `kind:'openclaw'`
  AND `status` connected. For a Hermes connection, show a calm muted note:
  "Skills, memory, files, search and chat require an OpenClaw gateway."
- Capabilities 1 (run) and 2 (automations) work for BOTH kinds.

Design these as a tabbed/segmented sub-view under a selected connection (segmented
control reusing existing pill/nav idiom): **Run · Automations · Skills · Memory ·
Files · Search · Chat**. Each tab = one capability below.

## The exact IPC contract (already typed + live — call it)
All methods are on `window.flowstate.flowclaw` (typed in ipc.ts). `connectionId`
is the selected connection's id from `flowclaw.list()`.

```ts
// #1 Autonomous task execution
runTask(connectionId, prompt, model?): Promise<{ ok: boolean; text?: string; error?: string }>

// #2 Scheduled automations (cron) — both kinds
listAutomations(): Promise<{ automations: FlowclawAutomationDto[] }>
createAutomation({ connectionId, label, prompt, intervalMinutes, deliverTo? }): Promise<{ ok }>
deleteAutomation(id): Promise<{ ok }>
toggleAutomation(id, enabled): Promise<{ ok }>
// FlowclawAutomationDto = { id, connectionId, label, prompt, intervalMinutes,
//   enabled, deliverTo, createdAt, nextRunAt, lastRunAt|null, lastResult|null }
// (timestamps are epoch ms)

// #3 Skills (ClawHub, 5,000+)
listSkills(connectionId, query?): Promise<{ skills: { id, name, description?, installed? }[] }>
installSkill(connectionId, skillId): Promise<{ ok }>

// #4 Long-term memory
memoryGet(connectionId, key): Promise<{ value: string | null }>
memorySet(connectionId, key, value): Promise<{ ok }>

// #5 Cloud file workspace (40GB)
listFiles(connectionId, path?): Promise<{ files: { path, size?, kind? }[] }>
readFile(connectionId, path): Promise<{ content: string }>

// #6 Live search
search(connectionId, query, source?): Promise<{ results: { title?, url?, snippet? }[] }>

// #7 Chat integrations
sendMessage(connectionId, channel, text): Promise<{ ok }>
```

## Panels to design (one per capability)

1. **Run** — a prompt textarea + optional model override + "Run" button. Calls
   `runTask`. Result renders in a terminal-style block (JetBrains Mono),
   `aria-live="polite"`. `runTask` resolves once (non-streaming) — show a spinner
   while pending, then the `text`, or the `error` in --bad clay. Keep a short
   in-session history of past runs (prompt → result), no persistence needed.

2. **Automations** — reuse the Routines visual pattern. Table/list of automation
   rows: label, every-N-minutes (`intervalMinutes`), enable/disable toggle
   (`toggleAutomation`), next-run countdown (`nextRunAt` − now), last-run relative
   time (`lastRunAt`), and an expandable `lastResult` preview. Delete per row.
   "New automation" form: label, prompt, interval (minutes, int ≥1), optional
   `deliverTo` (free text, e.g. a chat channel). Empty state guides creating one.

3. **Skills** — a search field (debounced → `listSkills(connectionId, query)`) over
   a results grid/list of skill cards: name, description, an "Installed" badge
   (--good) when `installed`, else an "Install" button → `installSkill`, optimistic
   flip to installed. Empty query lists featured/all. Loading skeletons.

4. **Memory** — a key/value inspector. Key input + "Get" → shows `value` (or a
   muted "not set" when null). A set form (key + value textarea) → `memorySet`,
   confirm toast. Treat as small KV store; no list endpoint, so design around
   get/set by known key (allow user to keep a session list of keys they've touched).

5. **Files** — a path breadcrumb + file list from `listFiles(path)`: name, `kind`
   (file/dir glyph), human-readable `size`. Clicking a dir re-lists; clicking a
   file → `readFile(path)` opens a read-only viewer (mono, scrollable,
   `aria-label`). Show "40 GB workspace" as a quiet header label. Empty + error
   states.

6. **Search** — query field + optional `source` selector (free text or a small
   preset list: Web, Yahoo Finance, X/Twitter). `search` → result rows: title
   (linked to `url` via the app's external-open pattern, NOT a raw target=_blank),
   snippet muted. Loading + empty-results states.

7. **Chat** — send-to-channel composer: channel input + message textarea +
   "Send" → `sendMessage`. Confirmation pill on success, --bad on error. Keep a
   session log of sent messages (channel · text · time). Note in a .hint that
   this drives the gateway's connected messaging apps (Telegram etc.).

## States everywhere
Loading skeletons, empty states (guide the next action), and error states using
--bad clay (never red). All async buttons show pending state and disable on
in-flight. Respect focus rings, keyboard nav, and `aria-live` on result regions.

## Integration (be specific)
- Build `src/renderer/src/screens/flowclaw/` subcomponents (one file per panel,
  e.g. `SkillsPanel.tsx`, `MemoryPanel.tsx`, …) imported by the existing
  `Flowclaw.tsx` screen. Follow the structure/idioms of Connectors.tsx,
  Routines.tsx, Settings.tsx.
- Add the segmented capability switcher to the selected-connection view. Persist
  the active tab in component state only.
- Wrap panel transitions in the same framer-motion AnimatePresence pattern App.tsx
  uses for views.
- Any new CSS goes in styles.css using the existing tokens only.

## Output
- Production-grade React + TSX consistent with this codebase (no generic AI
  aesthetics, no new palette). Reuse tokens/classes above.
- Deliver: the per-capability panel components, the segmented switcher, the
  Flowclaw.tsx wiring diff, and any styles.css additions. Calm, dense, minimal.
