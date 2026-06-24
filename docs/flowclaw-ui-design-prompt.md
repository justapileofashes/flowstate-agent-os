# flowclaw UI — Claude Design prompt

> **SUPERSEDED** by `docs/claude-design-prompt-all-features.md`, which bundles
> this screen plus the Meetings card, Capture card, and the Business tab into
> one Claude Design handoff. Use that file.

Hand this to Claude Design to produce the flowclaw UI and wire it into the
existing app. The backend service layer is already built + tested (see
`docs/superpowers/specs/2026-06-09-flowclaw-design.md`); when the UI returns,
the `ipc.flowclaw.*` handlers will be wired to match it.

---

You are designing a new feature surface called "flowclaw" for Flowstate, an
existing Electron + React desktop app, and integrating it into the current UI.
Match the existing design system EXACTLY — do not introduce a new visual language.

## The app & stack
- Electron (main/preload/renderer) + React + TypeScript, Vite, framer-motion for
  transitions, Tailwind + a custom CSS layer in src/renderer/src/styles.css.
- Fonts: Inter (UI), JetBrains Mono (mono/labels). Dark mode ONLY.

## Design system (USE THESE TOKENS — they already exist as CSS variables)
"Minimalist luxury monochrome — warm-neutral grays only. NO HUE. Hierarchy through
tone weight, not color." Restraint over decoration.
- Surfaces: --bg #0e0d0c, --bg-elev #131211, --surface #1a1816, --surface-2 #22201d,
  --surface-3 #2a2723. Borders: --border #26241f, --border-strong #34302a.
- Ink: --ink #f0ece2, --ink-strong #faf6ec (headings), --ink-muted #a09a8e,
  --ink-faint #5c574f, --ink-quiet #3a362f.
- Accent (platinum, near-white): --accent #e8e3d5, --accent-hover #f4efe2,
  --accent-soft, --accent-glow. Status: --good #c8c2b3 (bone, NOT green),
  --bad #a08278 (muted clay, NOT red). There are no other hues — keep it monochrome.
- Radii --r-xs..--r-2xl (4->28px). Spacing --s-1..--s-12 (4->48px). Shadows
  --shadow-xs..lg (never >8px spread). Motion eases --ease-out-expo /
  cubic-bezier(0.16,1,0.3,1), durations --d-fast 120 / --d-base 200 / --d-slow 360.
- Reuse existing class vocabulary: .glass, .sidebar, .nav-row(.active), .btn/.btn-sm/
  .btn-primary, .pill(.good/.bad/.streaming), .dot(.dot-good/.dot-pulse),
  .settings-section, .field, .badge, .hint, .card. 16x16 inline SVG icons,
  stroke="currentColor", fill none (match the NavRow icons in App.tsx).

## What flowclaw does (functional spec)
flowclaw is a desktop control-plane/UI over self-hosted AI-agent gateways. The user
connects Flowstate to:
- OpenClaw — a local WebSocket gateway (default ws://127.0.0.1:18789, bearer-token auth).
- Hermes Agent — a REST agent (OpenAI-compatible /v1/chat/completions, /api/jobs cron,
  api-key auth).
Both are model-agnostic and support LOCAL models (Ollama); Flowstate already runs
Ollama locally. flowclaw lets the user: add/test/manage gateway connections, pick a
model per connection (including local models), create scheduled tasks that target a
backend (local | openclaw | hermes), and watch live run logs.

## Screens / states to design
1. flowclaw home: list of connected gateways as cards — kind badge (OpenClaw/Hermes),
   host:port, connection status pill (connected / connecting / error / disabled),
   selected model, Test + enable/disable + remove. Plus an "Add connection" affordance.
2. Add/Edit connection: kind picker, host/port (default to localhost), token/api-key
   field (masked), model dropdown (merged list: local Ollama models + gateway models;
   allow free-text model id), Test button with inline result.
3. Tasks: list of scheduled tasks (reuse the Routines visual pattern), each showing
   target backend + model + schedule + next-run + last-status. Create/edit task with a
   backend/model selector.
4. Run detail: live-streaming terminal-style log (JetBrains Mono), run status, tokens/
   cost if available, with a tail that works whether or not the panel was open.
5. Empty states (no connections yet — guide the user to add one), connecting skeleton,
   and error states (gateway unreachable / bad token) using --bad clay, never red.

## Integration into the existing UI (be specific)
- Add a left-sidebar nav entry "flowclaw" as a <NavRow> in src/renderer/src/App.tsx,
  with a 16x16 stroke icon consistent with the existing Dashboard/Models/Brain/
  Connectors/Routines/Settings icons. Place it near Connectors/Routines.
- Extend the View union (`{ kind: 'flowclaw' }`), the subtitle map, and document.title.
- Create src/renderer/src/screens/Flowclaw.tsx (+ small subcomponents) following the
  structure/idioms of the existing Connectors.tsx, Routines.tsx, and Settings.tsx
  screens. Wrap screen entry in the same framer-motion AnimatePresence pattern App.tsx
  uses for other views.
- Assume an IPC surface `ipc.flowclaw.*` (list/add/test/remove connections, list models,
  create/list tasks, subscribe to run events) — stub the calls with typed placeholders;
  the main-process handlers are built separately. Secrets (tokens) never live in the
  renderer beyond a write-only input — show masked, never read back.

## Output
- Production-grade React + TSX consistent with this codebase (not generic AI
  aesthetics, no new color palette). Reuse tokens/classes above.
- Provide: the Flowclaw.tsx screen + subcomponents, the exact App.tsx diffs to wire
  nav + view + subtitle, any new CSS added to styles.css using the existing tokens,
  and a short note on the assumed ipc.flowclaw.* shape.
- Honor accessibility (focus states, aria-live for streaming log), keyboard, and the
  app's existing motion language. Keep it calm, dense, and minimal.

## Addendum: Meetings card (Zoom recorder)

Add a "Meetings" card to the Flowclaw screen. It uses `window.flowstate.zoom.*`:

- `zoom.saveCreds({accountId, clientId, clientSecret})` → `{ok}` — three password
  fields (Server-to-Server OAuth app from Zoom Marketplace). Write-only: never
  display stored values; show "credentials saved" state instead.
- `zoom.test()` → `{ok, error?}` — "Test" button next to the creds form.
- `zoom.record({meetingId? | topic?, agentId, connectionId, model?})` →
  `{jobId, joinUrl?, error?}` — form: meeting ID input OR new-meeting topic
  input (tabs/toggle), agent picker, flowclaw connection picker
  (`flowclaw.list()`), optional model. When `joinUrl` returns, show it as a
  copyable link.
- `zoom.jobs()` → `{jobs: ZoomJobDto[]}` — job list, poll every ~10s while
  visible. Status chip per job: armed/waiting/downloading/summarizing/done/error
  (use --good for done, --bad for error, muted for in-flight). When done: button
  "Open recording" per local file via `zoom.openRecording(path)`, link to the
  summary chat via `chatId`, and the Zoom share link.

Same monochrome token rules as the rest of this prompt.
