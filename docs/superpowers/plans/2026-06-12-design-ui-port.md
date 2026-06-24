# Design UI port — Flowclaw screen, Business tab, nav icons

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Branch:** `session/capture-business-ui` (same branch as the capture + business plans; this plan runs THIRD, after both backends exist — it consumes `ipc.capture.*` and `ipc.business.*`).
>
> **Tests:** renderer has no unit-test rig. Verification per task = `npx tsc --noEmit -p tsconfig.web.json` (and `-p tsconfig.node.json` where main-process files are touched), plus a final manual smoke via `npm run dev`. Never run `npm test`.
>
> **Visual source of truth:** `.design-import/flowstate/project/` — `flowclaw.jsx` (509 lines), `flowclaw-appliances.jsx` (321), `business.jsx` (360), `flowclaw.css` (158), `business.css` (204), `chrome.jsx` (nav), `flowclaw-icon.png`, `settings-icon.png`, `brain-icon.png`. Recreate markup/classes pixel-faithfully; replace all `window.FLOWCLAW_DATA` / `window.APPLIANCE_DATA` / `window.BUSINESS_DATA` seeds and `setTimeout` simulations with real IPC.
>
> **Scope (user-approved):** Flowclaw screen (Connections / Tasks / Appliances incl. Meetings + Capture), Business tab, custom nav PNG icons, "Flowclaw" capitalized in all UI strings. SKIP everything else in the bundle (pixel-mascot world, whole-app chrome redesign, workshops).
>
> **Carry the prototype's defensive fixes:** guard feed pushes (`if (next) …`, `.filter(Boolean)` before map), no `setState(...) || setTimeout(...)` chaining, and an error boundary around each new screen.

## Design-token / class audit (already done — do not redo)

`src/renderer/src/styles.css` already defines every token the prototype CSS uses (`--ink-strong`, `--surface-2/3`, `--border(-strong)`, `--r-sm/md/lg`, `--d-fast/base`, `--ease`, `--accent`, `--good`, `--bad`, `--font-mono`) and the shared classes `.pill(.good/.bad/.streaming) .dot .btn(-sm/-primary/-ghost) .card .card-interactive .field .tabs .tab.on .glass .modal-backdrop .modal-head .modal-body .eyebrow .section-title .screen-enter .row .gap-* .mt-* .muted .faint .mono .text-xs/.text-sm @keyframes pulse .dot-pulse`.

Missing (must be added in Task 2): `.card-2`, top-level `.hint`, `.ink`, `.scroll` (prototype uses them; app only has scoped `.settings-row .hint` etc.).

## Real-IPC ↔ prototype mapping (the wiring deltas)

| Prototype seed | Real source | Delta |
|---|---|---|
| `FLOWCLAW_DATA.connections[]` `{host, port, scheme, status, hasSecret, latencyMs}` | `ipc.flowclaw.list()` → `FlowclawConnectionDto {id, kind:'hermes'\|'openclaw', label, baseUrl, model?, enabled}` | No host/port — parse `baseUrl` with `new URL()` for display; compose `baseUrl = \`${scheme}://${host}:${port}\`` on save. No live `status` — derive: `enabled ? 'connected' : 'disabled'`, and show error state only from an explicit Test click (`ipc.flowclaw.test(conn)` → `{ok, status?, error?}`). No `hasSecret` field — token is write-only; placeholder "•••••••• (leave blank to keep)" on edit, always. |
| `FLOWCLAW_DATA.localModels` / `gatewayModels` | `ipc.chat.listModels()` (`ChatListModelsResponse`) | One merged list for the model datalist; no gateway/local tag buttons (drop `.fc-modeltags` row or tag all as `local`). |
| `FLOWCLAW_DATA.tasks[]` `{backend, scheduleLabel, nextRun, lastStatus}` | `ipc.routines.list()` → `RoutineDto {id, name, agentId, prompt, schedule, target?, enabled, nextRunAt, lastRunAt, lastChatId, runCount}` | Backend label: `target?.kind === 'flowclaw'` → connection label from the connections list (fall back to `connectionId`), else `local · Ollama`. Model column: `target?.model ?? '—'`. Schedule label: format from `RoutineSchedule` (`frequency` + `time`/`intervalMinutes`/`cron`). `nextRun` = `new Date(nextRunAt).toLocaleString()`; lastStatus pill: `lastRunAt ? 'ok' : 'never'` (no per-run status stored — keep it honest). |
| `FcRunDetail` fake streamed log | No live run-log IPC exists | Replace modal body: row click opens the routine's `lastChatId` chat via the `onOpenChat` prop (same prop Routines.tsx already receives); if `lastChatId` is null, "Run now" via `ipc.routines.runNow(id)`. Keep the modal OUT of v1 — simpler and honest. |
| Meetings card seeds | `ipc.zoom.saveCreds/test/record/jobs/openRecording` (`ZoomJobDto`) | Direct fit. `record({meetingId?\|topic?, agentId, connectionId, model?})` → `{jobId, joinUrl?}`; show `joinUrl` row when present. Creds: no `credsSaved` read-back — keep a local `saved` flag set after a successful `saveCreds`, and treat a passing `ipc.zoom.test()` on mount as "credentials saved". |
| Capture card seeds | `ipc.capture.start/chunk/stop/jobs/saveTranscriber/testTranscriber` + `startSystemAudioCapture(captureId)` helper from `src/renderer/src/lib/capture.ts` (built in the webinar-capture plan) | Start: `ipc.capture.start({title, agentId, connectionId, model?})` → `{captureId}` → `startSystemAudioCapture(captureId)` → keep returned `stop()` in a ref. Elapsed/bytes: local timer for mm:ss; bytes from polled job row. Consent notice VERBATIM: "Recording calls may require participant consent depending on your jurisdiction and the host's terms. You are responsible for obtaining consent." |
| `AP_AGENTS` hardcoded names | `agents: AgentDto[]` prop passed from App.tsx (same as Routines screen) | Select holds `agentId`, label shows `agent.name`. |
| `BUSINESS_DATA.*` | `ipc.business.getProfile/saveProfile/runSprint/sprints/actions/approve/reject/feed/subscribeFeed` (DTOs per business-tab plan Task 4) | `roles` card: derive from `profile.roleAgentIds` + agents list. `activeSprint` = first sprint with non-terminal status, else latest. `briefing` = latest sprint's `briefing`. `history` = sprints list (skip the active one). Feed: initial `ipc.business.feed()`, then `subscribeFeed` broadcast appends (guard + cap at 500 client-side). |

## Task 1 — nav icons, View union, App.tsx wiring

**Files:**
- copy `.design-import/flowstate/project/{flowclaw-icon,settings-icon,brain-icon}.png` → `src/renderer/src/assets/` (new dir)
- new `src/renderer/src/assets.d.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/lib/customize-schema.ts`
- `src/renderer/src/chat/CustomizeDrawer.tsx`

- [ ] `assets.d.ts` (no env.d.ts exists today):
   ```ts
   declare module '*.png' {
     const src: string;
     export default src;
   }
   ```
- [ ] App.tsx: extend the View union (`App.tsx:30-37`) with `| { kind: 'flowclaw' } | { kind: 'business' }`.
- [ ] NavRows (around `App.tsx:288-336`), matching prototype order from `chrome.jsx:186-208`: insert **Business** right after Dashboard (briefcase SVG from `chrome.jsx:191` — Business keeps an SVG icon in the prototype), insert **Flowclaw** after Connectors. Swap the Brain row's SVG for `<img src={brainIcon} …>` and the Settings row's SVG for `<img src={settingsIcon} …>`; Flowclaw row uses `<img src={flowclawIcon} …>`. Img styling per prototype: `className="icon"` + `style={{ width: 16, height: 16, objectFit: 'contain', opacity: 0.85 }}` + `alt=""`. Import the PNGs at top of App.tsx.
- [ ] Both new rows respect hiddenNav: extend `customize-schema.ts:46` enum to `['models','brain','connectors','flowclaw','business']`, extend the filter at `:133-135`, and add the two ids+labels to the nav list CustomizeDrawer iterates (find the array near `CustomizeDrawer.tsx:224`).
- [ ] Subtitle ternary (`App.tsx:255-268`): add `'Flowclaw'` and `'Business'` arms. document.title effect (`App.tsx:240-244`): leave generic arms — falls through to `'Flowstate'`, fine.
- [ ] Render switch (`App.tsx:424-447`): add `view.kind === 'flowclaw' ? <Flowclaw agents={agents} onOpenChat={openChat} /> : view.kind === 'business' ? <Business /> :` arms (screens stubbed as empty `<div>`-returning components in this task if built later — but Tasks 3/4 land in the same branch before any commit of broken imports; simplest: commit Task 1 with minimal placeholder screen files exporting the header-only page, fleshed out by Tasks 3/4).
- [ ] Capitalization sweep: `grep -ri "flowclaw" src/renderer` — every user-visible string must read "Flowclaw" (identifiers/channels stay lowercase).

**Verify:** `npx tsc --noEmit -p tsconfig.web.json`. Commit.

## Task 2 — CSS port

**File:** `src/renderer/src/styles.css` (append two clearly-delimited blocks at the end).

- [ ] Append the full contents of `.design-import/flowstate/project/flowclaw.css` under a `/* ── Flowclaw screen (design import) ── */` banner.
- [ ] Append the full contents of `business.css` (appliances + business) under a `/* ── Appliances + Business (design import) ── */` banner.
- [ ] Prepend a small shim block for the four missing helpers, scoped to match prototype usage:
   ```css
   .card-2 { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-md); }
   .hint { color: var(--ink-faint); font-size: 11.5px; line-height: 1.5; }
   .ink { color: var(--ink); font-style: normal; }
   .scroll { overflow-y: auto; }
   ```
   (Check first that none collide: existing rules are scoped like `.settings-row .lab .hint` — a bare `.hint` with lower specificity is safe.)
- [ ] Watch the duplicate `@keyframes pulse` (styles.css already defines it twice at 217/338) — do NOT bring a third copy from the prototype; strip any `@keyframes pulse` from the appended blocks. Keep `fc-shimmer` and the `prefers-reduced-motion` block.

**Verify:** `npx tsc --noEmit -p tsconfig.web.json` (unchanged), `npm run dev` boots with no devtools CSS errors. Commit.

## Task 3 — `src/renderer/src/screens/Flowclaw.tsx`

Port `flowclaw.jsx` + `flowclaw-appliances.jsx` into ONE file (or Flowclaw.tsx + FlowclawAppliances.tsx if >700 lines — executor's call), TypeScript, real IPC per the mapping table.

**Props:** `{ agents: AgentDto[]; onOpenChat: (agent: AgentDto, chatId?: string) => void }`.

**Connections tab:**
- Load on mount: `ipc.flowclaw.list()`; refresh after save/remove/toggle.
- Card: keep prototype markup (`FcKindBadge`, `FcStatusPill`, meta rows, actions). Status = `enabled ? 'connected' : 'disabled'`; per-card Test button → `ipc.flowclaw.test(conn)` (pass the DTO; token omitted = keep stored) → ok shows latency-free `reachable` pill, fail shows the returned `error` in `.fc-errline`.
- Toggle = `ipc.flowclaw.save({...conn, enabled: !conn.enabled})`. Remove = `ipc.flowclaw.remove(id)` (plain confirm() first).
- Modal: kind picker (FC_KINDS metadata verbatim), Host + Port inputs composing `baseUrl`; on edit, prefill via `new URL(conn.baseUrl)` in a try/catch (fallback: show one Base URL field with the raw string). Label, write-only secret (`type="password"`, never prefilled, omit `token` key entirely when blank — exactOptionalPropertyTypes: `...(secret ? { token: secret } : {})`), model input + `<datalist>` from `ipc.chat.listModels()`. Modal Test button: build the candidate DTO from current fields and call `ipc.flowclaw.test`. Save → `ipc.flowclaw.save(dto)` → close + refresh. Keep the hint line: "Stored encrypted by the main process. Never read back into the UI."
- Empty state + connecting skeleton: keep `FcEmpty`; skeleton only while the initial list loads.

**Tasks tab:** `ipc.routines.list()` rows per mapping table; row actions: enabled toggle (`ipc.routines.toggle`), Run now (`ipc.routines.runNow`), click opens `lastChatId` chat (resolve agent from `agents` by `routine.agentId`; if agent or chat missing, no-op). "New task" button: keep it but have it call the same create modal Routines.tsx uses ONLY if that modal is exported/extractable in <20 lines of change; otherwise render the button as "Manage in Routines" → no nav plumbing exists for cross-screen jump from here, so accept a callback prop `onGoRoutines?: () => void` wired in App.tsx to `setView({kind:'routines'})`.

**Appliances tab:** `<div className="ap-grid"><MeetingsCard …/><CaptureCard …/></div>`.
- `ApTargetRow`: agents from props, connections from the already-loaded flowclaw list (filter `enabled`), models datalist from `ipc.chat.listModels()`. Shared between both cards.
- MeetingsCard: per mapping table. Arm → `ipc.zoom.record(...)`; conditional-spread optional fields. Jobs: `ipc.zoom.jobs()` polled every 3s while tab visible (clear interval on unmount/tab switch). Job actions: open chat (`onOpenChat`), open recording (`ipc.zoom.openRecording(path)` — first of `recordingFiles`), share link (`ipc.shellOpen` if exists, else copy to clipboard).
- CaptureCard: per mapping table. Recording state machine: idle → `start()` → recording (ref holds `stop()` from `startSystemAudioCapture`) → Stop click awaits `stop()` → refresh jobs. Transcriber settings collapsible: controlled fields, Save → `ipc.capture.saveTranscriber({mode, ...conditionals})` (apiKey write-only, blank = keep), Test → `ipc.capture.testTranscriber()` result pill. Consent notice verbatim, `.ap-consent`.
- Status chip map `AP_STATUS` covers both Zoom and Capture statuses already — keep verbatim.

**Defensive:** every list render `.filter(Boolean)`; all IPC awaited in try/catch setting an `error` string rendered as `.fc-errline`; intervals cleaned up in effect returns.

**Verify:** `npx tsc --noEmit -p tsconfig.web.json`; `npm run dev` → Flowclaw nav opens, three tabs render, Add-connection modal opens/saves. Commit.

## Task 4 — `src/renderer/src/screens/Business.tsx`

Port `business.jsx`, TypeScript, real IPC.

**Error boundary first** (prototype's ScreenErrorBoundary fix): tiny class component in the same file:
```tsx
class BizErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() {
    return this.state.error
      ? <div className="biz-page"><div className="card biz-card"><div className="fc-errline">Business screen crashed: {String(this.state.error)}</div></div></div>
      : this.props.children;
  }
}
```
Exported `Business` wraps content in it.

**Wizard ↔ dashboard:** mount → `ipc.business.getProfile()`; null profile → `BizSetup` (markup verbatim; Save → `ipc.business.saveProfile({...})` — zod requires `time` `HH:MM`; goals filtered non-empty; conditional-spread `links` members) → on resolve, re-fetch profile and swap to dashboard ("Creating role agents…" button label while awaiting — role agents really are created in this call).

**Dashboard:**
- Initial load: `Promise.all([sprints(), actions(), feed()])`.
- `subscribeFeed` on mount (returns unsubscribe; clean up). Each event: append guarded (`if (!ev?.id) return;` dedupe by id), cap 500; on `kind` in `{'sprint-start','sprint-end','briefing','action-proposed','action-executed','action-failed','task-done','error'}` also re-fetch sprints+actions (cheap, debounced 500ms).
- `bizMarkdown` mini-renderer: port verbatim (typed: `(md: string | undefined) => JSX.Element[] | null`).
- Goals card: active sprint goals; status pill from `SPRINT_STATUS` map verbatim.
- Approval queue: pending (`status === 'proposed'`) on top, resolved below; `BizActionCard` markup verbatim; Approve → `ipc.business.approve(id)` then re-fetch actions (NO optimistic timeout fakery); Reject → `ipc.business.reject(id)` then re-fetch. Buttons disabled while in flight.
- Briefing card: latest non-empty `briefing` across sprints.
- Live feed: `.biz-feed` mono log, `role="log" aria-live="polite"`, autoscroll effect on feed change (prototype's `feedRef` pattern), rows `.filter(Boolean)`, `RoleBadge` maps role → glyph (roles arrive lowercase from backend — `'strategy'|'marketing'|'ops'`; capitalize for the badge title and map glyphs `ST/MK/OP`).
- Sprint history: all non-active sprints, date = `new Date(startedAt).toLocaleDateString()`, counts from `goals.length` / `tasks.length`, error line when present.
- Header: "Run sprint now" → `ipc.business.runSprint()`; result `{error}` → toast/inline error (`sprint already running`); disable while any sprint non-terminal. Schedule line from profile; Edit reopens wizard prefilled (pass profile into `BizSetup` as optional `initial` prop — small extension over the prototype, saves a separate schedule modal).

**Verify:** `npx tsc --noEmit -p tsconfig.web.json`; `npm run dev` → Business nav shows wizard, saving creates role agents and lands on dashboard, Run-sprint streams feed lines. Commit.

## Task 5 — final smoke + branch wrap

- [ ] `npx tsc --noEmit -p tsconfig.node.json` AND `-p tsconfig.web.json` — both clean.
- [ ] `npm run dev` full pass: nav icons render (3 PNGs), Flowclaw tabs all functional against real gateways if reachable (graceful errors if not), Capture start/stop produces a job, Business wizard→dashboard→run-sprint→approve round-trip.
- [ ] `npx vitest run` the capture + business test files one more time (regression).
- [ ] Commit any fixups; then invoke `superpowers:finishing-a-development-branch` (precedent: merge to main locally, no push).
