# Flowstate UI — Claude Design prompt (agent packs, notifications, meters, run export)

Hand this whole file to Claude Design in one session. Four small surfaces
whose backend already exists on main: **agent pack export/import**, a
**desktop-notifications toggle**, **live resource meters**, and a
**run export button**. The IPC surfaces named below are live —
build the UI to call them exactly. This is additive; follow the same design
system and integration rules as `docs/claude-design-prompt-all-features.md`
(monochrome warm-neutral tokens, existing class vocabulary, 16x16 stroke
icons, framer-motion patterns). Do NOT introduce a new visual language.

---

## Context

Flowstate is an Electron + React + TypeScript desktop app (dark only,
Tailwind + custom CSS vars in `src/renderer/src/styles.css`, Inter +
JetBrains Mono). All IPC goes through the typed `ipc.*` surface in
`src/renderer/src/lib/ipc.ts`.

## Surface 1 — Agent pack export / import

Users can now share agents as portable JSON files ("agent packs") and
import packs from other people. Main process owns the file dialogs — the
renderer just invokes and renders the result.

### IPC (already typed in `ipc.ts`)

- `ipc.chat.exportAgentPack(ids: string[])` →
  `{ ok: boolean; canceled?: boolean; path?: string; count?: number }`
  Opens a native save dialog. `canceled: true` = user closed it (silent
  no-op, NOT an error). On `ok: true` show "Exported {count} agents" with
  the file path.
- `ipc.chat.importAgentPack()` →
  `{ ok: boolean; canceled?: boolean; agents?: AgentDto[] }`
  Opens a native open dialog, validates, creates the agents (collision-safe
  names/workspaces, shell-enabled imports auto-downgraded to cautious
  approval — no UI work needed for that). On `ok: true` show
  "Imported {agents.length} agents", then refresh the agent list the same
  way agent create/delete does today (the `refreshAgents` flow in App.tsx).
  A thrown error means a bad file ("Not a valid FlowState agent pack…") —
  surface the message in the existing error/hint style.

### Placement + interaction

- Add "Export" / "Import" affordances wherever agent management currently
  lives (App.tsx sidebar agent area / Dashboard) — `.btn .btn-sm .btn-ghost`
  buttons or a small overflow menu, your call, but keep it quiet: this is a
  power feature, not a hero action.
- Export needs an agent picker: a small modal (reuse the modal idiom from
  `AgentFormModal.tsx`) listing agents with checkboxes + avatar dots in
  their `avatarColor`, "Select all", count in the confirm button
  ("Export 3 agents"). Pre-check nothing. Disabled confirm at 0 selected.
- Import is one click → native dialog → result toast. No picker.
- Busy states: buttons show "Exporting…" / "Importing…" while the promise
  is in flight; disable during.

## Surface 2 — Desktop notifications toggle (Settings)

Backend fires native desktop notifications when the window is unfocused or
minimized: (a) a tool call waits for approval, (b) an agent run finishes or
fails. Opt-out is a settings KV flag.

### IPC

- Read: `ipc.settings.get('notifications_enabled')` → value is `'false'`
  when disabled; anything else (including null/unset) means enabled.
- Write: `ipc.settings.set('notifications_enabled', 'true' | 'false')`.

### Placement + interaction

- New row in the existing Settings screen (`Settings.tsx`), inside an
  existing or new `.settings-section` titled "Notifications".
- One toggle: label "Desktop notifications", hint copy: "Notify when an
  agent needs approval or finishes a run while the window is in the
  background." Match the toggle/checkbox idiom already used in Settings.
- Optimistic UI; revert on IPC failure.

## Surface 3 — Live resource meters (Dashboard)

Small always-on system meters so the user can see what local models are
costing the machine: CPU %, RAM, and GPU (util % + VRAM) when an NVIDIA
card is present.

### IPC

- `ipc.system.stats()` →
  `{ at: number; cpuPct: number; ramUsedMB: number; ramTotalMB: number;
     gpu: { name: string; utilPct: number; vramUsedMB: number;
            vramTotalMB: number } | null }`
- Poll it from the renderer (2-3s interval, `setInterval` cleaned up on
  unmount; pause polling when the Dashboard view is not active). First call
  after app start reads ~0% CPU — that's expected (percentages are
  interval-deltas); render it as-is.

### Placement + interaction

- A compact meter strip or row of 3 small `.card`s on the Dashboard:
  "CPU", "RAM", "GPU". Thin horizontal bars (2-4px) in `--accent` over
  `--surface-2` — monochrome, no traffic-light colors. Values in
  JetBrains Mono ("38%", "21.3 / 31.8 GB", "5.2 / 16.0 GB VRAM").
- `gpu: null` → hide the GPU meter entirely (no "N/A" placeholder).
- Animate bar width with the standard motion tokens; no pulsing.

## Surface 4 — Export run (chat header)

One-click export of a whole chat run (transcript + tool calls + audit
trail) to a shareable markdown file. Backend builds the document and owns
the save dialog.

### IPC

- `ipc.chat.exportRun(chatId: string)` →
  `{ ok: boolean; canceled?: boolean; path?: string }`
  `canceled: true` = silent no-op. On `ok: true` show "Run exported" with
  the path, same toast/hint idiom as agent pack export.

### Placement + interaction

- Small icon button ("Export run", download-style 16x16 stroke icon) in
  the chat header next to the existing audit/snapshot affordances
  (see `chat/AuditButton.tsx` for the idiom). Tooltip: "Export this chat
  as markdown (transcript + audit trail)".
- Busy state while in flight; disable when the chat has no messages.

## Out of scope

No notification routing per agent, no pack marketplace/browsing UI, no
pack preview before import (main process validates), no historical
stats/charting (live snapshot only), no PDF/HTML run export. Don't touch
the Business/Flowclaw screens.
