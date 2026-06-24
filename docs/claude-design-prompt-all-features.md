# Flowstate UI — Claude Design prompt (all pending features)

Hand this whole file to Claude Design in one session. It covers every UI
surface whose backend is already built (or specced) in Flowstate: the
**Flowclaw screen** (gateway connections + tasks + Meetings card + Capture
card) and the new **Business tab**. The IPC surfaces named below already
exist (or are pinned by spec) — build the screens to call them exactly.

This file supersedes `docs/flowclaw-ui-design-prompt.md`.

---

You are designing new feature surfaces for Flowstate, an existing
Electron + React desktop app, and integrating them into the current UI.
Match the existing design system EXACTLY — do not introduce a new visual
language.

## The app & stack

- Electron (main/preload/renderer) + React + TypeScript, Vite, framer-motion
  for transitions, Tailwind + a custom CSS layer in
  `src/renderer/src/styles.css`.
- Fonts: Inter (UI), JetBrains Mono (mono/labels). Dark mode ONLY.
- All IPC goes through `window.flowstate.*` (typed in
  `src/renderer/src/lib/ipc.ts` as `ipc.*`).

## Design system (USE THESE TOKENS — they already exist as CSS variables)

"Minimalist luxury monochrome — warm-neutral grays only. NO HUE. Hierarchy
through tone weight, not color." Restraint over decoration.

- Surfaces: --bg #0e0d0c, --bg-elev #131211, --surface #1a1816,
  --surface-2 #22201d, --surface-3 #2a2723. Borders: --border #26241f,
  --border-strong #34302a.
- Ink: --ink #f0ece2, --ink-strong #faf6ec (headings), --ink-muted #a09a8e,
  --ink-faint #5c574f, --ink-quiet #3a362f.
- Accent (platinum, near-white): --accent #e8e3d5, --accent-hover #f4efe2,
  --accent-soft, --accent-glow. Status: --good #c8c2b3 (bone, NOT green),
  --bad #a08278 (muted clay, NOT red). No other hues — keep it monochrome.
- Radii --r-xs..--r-2xl (4→28px). Spacing --s-1..--s-12 (4→48px). Shadows
  --shadow-xs..lg (never >8px spread). Motion eases --ease-out-expo /
  cubic-bezier(0.16,1,0.3,1), durations --d-fast 120 / --d-base 200 /
  --d-slow 360.
- Reuse existing class vocabulary: .glass, .sidebar, .nav-row(.active),
  .btn/.btn-sm/.btn-primary, .pill(.good/.bad/.streaming),
  .dot(.dot-good/.dot-pulse), .settings-section, .field, .badge, .hint,
  .card. 16x16 inline SVG icons, stroke="currentColor", fill none (match the
  NavRow icons in App.tsx).

## Integration into the existing UI (applies to both features)

- Add left-sidebar nav entries as `<NavRow>`s in `src/renderer/src/App.tsx`:
  "flowclaw" (near Connectors/Routines) and "Business" (near the top, under
  Dashboard). 16x16 stroke icons consistent with existing nav icons.
- Extend the View union (`{ kind: 'flowclaw' }`, `{ kind: 'business' }`),
  the subtitle map, and document.title.
- New screens follow the structure/idioms of the existing Connectors.tsx,
  Routines.tsx, Settings.tsx. Wrap screen entry in the same framer-motion
  AnimatePresence pattern App.tsx uses for other views.
- Secrets (tokens, API keys, client secrets) are write-only across IPC:
  masked password inputs, never read back, show a "saved" state instead.
- Honor accessibility (focus states, aria-live for streaming/feed regions),
  keyboard, and the app's existing motion language. Keep it calm, dense,
  minimal. Production-grade TSX, no generic AI aesthetics, no new palette.

---

# Feature 1 — Flowclaw screen

flowclaw is a desktop control-plane/UI over self-hosted AI-agent gateways:

- OpenClaw — local WebSocket gateway (default ws://127.0.0.1:18789,
  bearer-token auth).
- Hermes Agent — REST agent (OpenAI-compatible /v1/chat/completions,
  api-key auth).

Both are model-agnostic and support LOCAL models (Ollama); Flowstate already
runs Ollama locally. The screen lets the user: manage gateway connections,
pick a model per connection, schedule tasks targeting a backend, watch live
runs, and use two appliance cards (Meetings, Capture).

## 1a. Connections (ipc.flowclaw.*)

- `flowclaw.list() → {connections}` — cards: kind badge (OpenClaw/Hermes),
  host:port, status pill (connected / connecting / error / disabled),
  selected model, Test + enable/disable + remove, "Add connection"
  affordance.
- Add/Edit: kind picker, host/port (default localhost), token/api-key field
  (masked, write-only), model dropdown (local Ollama models + free-text
  model id), `flowclaw.test(connection) → {ok, status?, error?}` inline
  result. `flowclaw.save(connection) → {ok}`,
  `flowclaw.remove(id) → {ok}`.
- Empty state (no connections — guide to add one), connecting skeleton,
  error states (gateway unreachable / bad token) using --bad clay.

## 1b. Tasks

Scheduled tasks reuse the Routines visual pattern; each shows target backend
(local agent | flowclaw connection) + model + schedule + next-run +
last-status. Backed by the existing `ipc.routines.*` surface — routines
carry an optional `target?: { kind: 'flowclaw', connectionId, model? }`
(absent = local agent). Create/edit gets a backend/model selector.

## 1c. Meetings card (Zoom recorder, ipc.zoom.*)

- `zoom.saveCreds({accountId, clientId, clientSecret}) → {ok}` — three
  masked fields (Server-to-Server OAuth app from Zoom Marketplace).
  Write-only; show "credentials saved" state.
- `zoom.test() → {ok, error?}` — Test button next to the creds form.
- `zoom.record({meetingId? | topic?, agentId, connectionId, model?}) →
  {jobId, joinUrl?, error?}` — form: meeting-ID input OR new-meeting topic
  (tabs/toggle), agent picker, flowclaw connection picker, optional model.
  When `joinUrl` returns, show it as a copyable link.
- `zoom.jobs() → {jobs: ZoomJobDto[]}` — poll ~10s while visible. Status
  chip per job: armed/waiting/downloading/summarizing/done/error (--good
  done, --bad error, muted in-flight). When done: "Open recording" per local
  file via `zoom.openRecording(path)`, link to the summary chat via
  `chatId`, and the Zoom share link.

## 1d. Capture card (webinar/system-audio recorder, ipc.capture.*)

Records ANY meeting/webinar (Zoom/Meet/Teams) without a paid plan by
capturing system audio locally, then transcribing + summarizing.

- Start flow: title input, agent picker, flowclaw connection picker,
  optional model → `capture.start({title, agentId, connectionId, model?}) →
  {captureId}`, then call the existing renderer helper
  `startSystemAudioCapture(captureId)` from `src/renderer/src/lib/capture.ts`
  (it handles getDisplayMedia + chunk streaming). Keep the returned handle;
  Stop button calls `handle.stop()` (which flushes + calls
  `capture.stop(captureId)` itself).
- While recording: elapsed timer + running size (`bytes` from the job),
  pulsing recording dot (.dot-pulse).
- `capture.jobs() → {jobs: CaptureJobDto[]}` — poll ~10s. Status chips:
  recording/transcribing/summarizing/done/error. Done jobs link to the notes
  chat (`chatId`) and show the local audio path.
- Transcriber settings (collapsible): mode toggle `openai | cli`; openai →
  url + model + optional API key (masked, write-only); cli → command
  template with `{file}` placeholder. `capture.saveTranscriber(config) →
  {ok}`, `capture.testTranscriber() → {ok, error?}` Test button.
- **Consent notice (required, verbatim-ish):** "Recording calls may require
  participant consent depending on your jurisdiction and the host's terms.
  You are responsible for obtaining consent." Render as a .hint, always
  visible on this card.

---

# Feature 2 — Business tab

A Polsia-style "run your business" autopilot. The user defines a company
profile; three role agents (Strategy / Marketing / Ops — they are normal
Flowstate agents auto-created on first save) run a **daily sprint**:
strategy plans goals + tasks → marketing/ops execute in parallel → strategy
writes a daily briefing. Outward actions (emails, posts, code, anything
leaving the machine) are NEVER executed during sprints — they queue as
proposed actions; the user approves or rejects each one. Approving makes the
role agent execute it via its connected tools.

IPC surface `ipc.business.*`:

- `business.getProfile() → {profile: BusinessProfileDto | null}` — null =
  not set up yet → show setup wizard.
- `business.saveProfile({name, product, audience, goals: string[],
  links?: {site?, repo?}, schedule: {enabled, time /* "HH:MM" */}}) →
  {ok, profile}` — first save auto-creates the three role agents.
- `business.runSprint() → {sprintId?, error?}` — "Run sprint now" button;
  error when a sprint is already active.
- `business.sprints() → {sprints: BusinessSprintDto[]}` — latest first.
  `BusinessSprintDto { id, status: 'planning'|'running'|'wrapping'|'done'|
  'error', goals: string[], tasks: {id, role, instruction, status,
  output?}[], briefing?, error?, startedAt, finishedAt? }`.
- `business.actions() → {actions: ProposedActionDto[]}` —
  `ProposedActionDto { id, sprintId, role, kind: 'email'|'post'|'code'|
  'other', title, body, status: 'proposed'|'approved'|'executing'|'done'|
  'failed'|'rejected', result?, createdAt, updatedAt }`.
- `business.approve(actionId) → {ok}` / `business.reject(actionId) → {ok}`.
- `business.feed(limit?) → {events: BusinessFeedEventDto[]}` and
  `business.subscribeFeed(cb) → unsubscribe` — live events
  `{ id, ts, sprintId?, role?, kind, text }` where kind ∈ sprint-start /
  phase / task-start / task-tool / task-done / action-proposed /
  action-executed / action-failed / briefing / sprint-end / error.

## Screens / states

1. **Setup wizard** (profile null): single calm form — company name, what
   you sell (product), who it's for (audience), goals (repeatable rows),
   optional site/repo links, daily sprint time + enable toggle. Saving
   creates the role agents; confirm with a quiet success state that
   introduces the three roles.
2. **Business dashboard** (profile exists):
   - Header: company name, schedule state (enabled + time, editable),
     "Run sprint now" button (disabled + streaming pill while a sprint is
     active).
   - **Goals card** — current sprint goals (or last sprint's).
   - **Live activity feed** — terminal-adjacent stream (JetBrains Mono),
     newest at bottom, auto-scroll, fed by `subscribeFeed` on top of an
     initial `feed()` load. Role shown as a small badge per line.
     aria-live="polite".
   - **Approval queue** — proposed actions as cards: kind badge, title,
     expandable body (mono for code/email), Approve / Reject buttons.
     Status chips for approved/executing/done/failed/rejected; show
     `result` when present. This is the centerpiece — make decisions
     one-glance easy.
   - **Briefing** — latest sprint briefing rendered as markdown.
   - **Sprint history** — compact list: date, status chip, #goals, #tasks,
     expandable task outputs.
3. Empty/edge states: no sprints yet (invite to Run now), sprint error
   (show `error` with --bad), action `failed` with result, feed empty.

## Output

- Provide: `screens/Flowclaw.tsx` and `screens/Business.tsx` (+ small
  subcomponents), the exact App.tsx diffs to wire nav + views + subtitles,
  any new CSS in styles.css using existing tokens only, and a short note on
  any assumed gaps in the `ipc.*` shapes above.
