# Flowstate UI — Claude Design prompt (vibe-dev feature pack)

Hand this whole file to Claude Design in one session. Ten small developer
power-features whose backend already exists on main, all reachable through the
typed `ipc.devtools.*` surface in `src/renderer/src/lib/ipc.ts`. Build the UI to
call them exactly. Additive — follow the existing design system (monochrome
warm-neutral CSS vars in `src/renderer/src/styles.css`, JetBrains Mono numerics,
16×16 stroke icons, framer-motion modal idiom from `chat/AgentFormModal.tsx`,
the `.btn .btn-sm .btn-ghost` / `.pill` / `.settings-section` / pack-toast
vocabulary). Do NOT introduce a new visual language. Keep everything quiet:
these are power tools, not hero features.

All IPC below is live and typed. `canceled`/empty results are silent no-ops,
thrown errors surface in the existing hint/error style.

---

## Context

Flowstate is an Electron + React + TS desktop app (dark only). Agents are a
model + system prompt + sandboxed workspace. The chat composer lives in
`chat/Composer.tsx`; the global "Ask anything" box is `chat/GlobalAskBox.tsx`;
Settings is `screens/Settings.tsx`; the recent-chats list is in `App.tsx` /
`chat/ChatSidebar.tsx`. Built-in slash commands already exist in
`chat/slash-commands.ts` (a popover in the composer).

## Surface 1 — Prompt snippets library

Reusable parameterized prompts. A snippet has `{ id, name, label, body }`; the
body can contain `{{var}}`, `{{var|default}}`, and date builtins
(`{{date}}`/`{{time}}`/`{{datetime}}`). Trigger expansion in the composer by
typing `:` then the snippet `name` (mirror the existing `/` slash popover).

### IPC
- `ipc.devtools.listSnippets()` → `{ snippets: SnippetDto[] }`
- `ipc.devtools.saveSnippet({ id?, name, label, body })` → `{ ok, error? }`
  (`name` must be unique + lowercase-kebab; `ok:false` returns a human `error`)
- `ipc.devtools.deleteSnippet(id)` → `{ ok }`

### UI
- A manager in Settings (`.settings-section` "Prompt snippets"): list with
  edit/delete, an add/edit form (name, label, multiline body). Show the
  detected `{{vars}}` as small `.pill`s under the body field.
- In the composer: a `:` popover listing snippets by `label`. On pick, if the
  body has vars, open a tiny fill-in modal (one input per var, defaults
  pre-filled); otherwise insert immediately. Expansion math is the backend's
  job at send — the UI just collects var values and inserts the raw body, or
  you may preview the expanded text.

## Surface 2 — Custom slash commands

User-defined `/commands` alongside the built-ins. Each is
`{ cmd, label, hint, template }`; `{{input}}` in the template is replaced by
whatever the user typed after the command (appended if no placeholder).

### IPC
- `ipc.devtools.listCommands()` → `{ commands: UserCommandDto[] }`
- `ipc.devtools.saveCommands(commands)` → `{ ok, error? }` (whole-list save)

### UI
- Settings manager (`.settings-section` "Custom commands"): rows of
  cmd + label + hint, an editor with a `template` textarea (note `{{input}}`).
  Validate `cmd` looks like `/name`. Merge these into the composer's existing
  slash popover so they appear next to `/plan` etc.

## Surface 3 — Spend budget guard

Soft/hard caps on cloud spend. The backend reads real usage + caps and returns
a verdict; show a banner and (on `block`) prevent the send.

### IPC
- `ipc.devtools.getBudgetCaps()` → `{ perChatUsd, perDayUsd }` (0 = unlimited)
- `ipc.devtools.setBudgetCaps(perChatUsd, perDayUsd)` → `{ ok }`
- `ipc.devtools.evaluateBudget(chatId?)` →
  `{ level: 'ok'|'warn'|'block', scope?: 'chat'|'day', message? }`

### UI
- Settings (`.settings-section` "Spend budget"): two number inputs (USD) with a
  hint that 0 means no limit. Match the cloud-key input row idiom.
- In chat: call `evaluateBudget(chatId)` before a send. `warn` → a thin amber-
  free (monochrome) inline note with the `message`. `block` → disable Send +
  show the `message` with a link to Settings. Never use traffic-light colors;
  use `--ink-faint` text + the existing pill states.

## Surface 4 — @file mentions

Typing `@src/auth.ts ...` attaches that workspace file to the prompt. Backend
parses mentions, reads them sandboxed to the agent workspace, and returns a
ready-to-prepend context block.

### IPC
- `ipc.devtools.resolveMentions(agentId, text)` →
  `{ paths: string[], contextBlock: string }`

### UI
- As the user types `@`, optionally show an autocomplete from the workspace file
  list (`ipc.files.list`). Before send, call `resolveMentions`; show resolved
  paths as small removable `.pill` chips above the composer so the user sees
  what's attached. The `contextBlock` is prepended to the outgoing message
  (backend-provided — don't rebuild it).

## Surface 5 — Project conventions auto-context

When the agent workspace has an AGENTS.md / CLAUDE.md / .cursorrules / README,
the backend builds a system-prompt preamble from the top one or two.

### IPC
- `ipc.devtools.loadProjectContext(agentId)` → `{ files: string[], preamble }`

### UI
- A quiet toggle/indicator in the chat header or composer: when `files` is
  non-empty, show a small chip "convention: AGENTS.md" the user can click to see
  which files are feeding house style. No preamble editing UI needed.

## Surface 6 — Token preflight

A live estimate so the composer can warn before a too-big send.

### IPC
- `ipc.devtools.preflight(text, contextChars?, model?)` →
  `{ estTokens, level: 'ok'|'warn'|'over'|'unknown', message? }`

### UI
- A tiny mono token counter near the composer ("~3.2k") that turns into the
  `message` hint at `warn`/`over`. Debounce calls (~400ms); pass the active
  model and the length of any attached @file/context block as `contextChars`.
  `unknown` → show just the count, no verdict.

## Surface 7 — Environment doctor

One-click "is my setup healthy?" report.

### IPC
- `ipc.devtools.runDoctor()` →
  `{ overall: 'pass'|'warn'|'fail', checks: [{ id, label, status, detail, hint? }] }`

### UI
- A "Run diagnostics" button (Settings, or the Dashboard empty state). Render
  the checklist: each row a status dot (reuse `.dot`/`.pill` states — pass/warn/
  fail map to good/neutral/bad), `label` + `detail`, and the `hint` shown when
  not `pass`. A summary badge from `overall`. Re-run button.

## Surface 8 — Pinned chats

Float favorite sessions to the top of the recent list.

### IPC
- `ipc.devtools.listPins()` → `{ pinned: string[] }` (chat ids)
- `ipc.devtools.togglePin(chatId)` → `{ pinned: string[] }`

### UI
- A pin affordance on each recent-chat row (hover-revealed pin icon, filled when
  pinned). Order the list with pinned first — backend `orderByPin` semantics:
  pinned in pin-order, then the rest unchanged. Show a small "pinned" divider.

## Surface 9 — Composer prompt history

Shell-style up-arrow recall of previous prompts.

### IPC
- `ipc.devtools.getHistory()` → `{ history: string[] }` (most-recent-first)
- `ipc.devtools.pushHistory(entry)` → `{ history: string[] }` (call on send)

### UI
- In the composer: when empty and the caret is at the start, ArrowUp walks back
  through `history`, ArrowDown forward. Push each sent prompt via `pushHistory`.
  No visible chrome required beyond maybe a faint "↑ history" hint.

## Surface 10 — (covered above)

These ten ship as one pack. Build whatever subset fits cleanly first; the
backend tolerates any call order. Reuse the pack-toast idiom for confirmations.

## Out of scope

No cloud sync of snippets/commands, no per-agent budgets, no historical spend
charts, no remote file mentions (workspace only), no editing of the generated
convention preamble, no real tokenizer (estimate is a guardrail). Don't touch
the Business/Flowclaw screens.
