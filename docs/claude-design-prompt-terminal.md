# Flowstate — Claude Design prompt: Terminal panel

Read `claude-design-prompt-app-overview.md` first. Same monochrome luxury system,
JetBrains Mono for the terminal region, idioms of the existing chat side-panels
(`ViewPanel`, `FileBrowser`).

## What this is

An **interactive terminal** side-panel in the chat view. Opened by a **Terminal
button in the chat header, immediately to the right of the "View" button**
(`ViewsButton`). A working production version exists at
`src/renderer/src/chat/TerminalPanel.tsx` — this prompt is for **visual
refinement only**. Do not change the IPC calls or the session lifecycle.

It runs a real OS shell (PowerShell on Windows) in the agent's workspace via the
main process. It is a piped shell, not a full PTY — no full-screen/curses apps,
so design for line-oriented output, not a cursor-addressable grid.

## Layout (current)

A column appended to the chat panel row (alongside Conversation / Views /
Files), `min-w 320 / max-w 680`, left border `--border`. Three stacked regions:

1. **Header bar** — terminal glyph + "Terminal", an "exited N" pill (`.bad`) when
   the session ends, and a Close button (right).
2. **Output** — scrolling `<pre>`-style region, JetBrains Mono 12px, `--ink` on
   `--bg`, `white-space: pre-wrap`, auto-scrolls to bottom. Echoes typed commands
   as `> cmd`. ANSI escape codes are already stripped upstream.
3. **Input row** — a `$` prompt glyph + a full-width mono input. Enter runs the
   command; ArrowUp/Down walk history; Ctrl+C sends an interrupt. Disabled with a
   "Session ended — close and reopen" placeholder once the shell exits.

## Backend is done — call these (typed in `src/renderer/src/lib/ipc.ts`)

`ipc.terminal.*`:
- `start(id, cwd)` — begin a session (id is `term-<chatId>`, cwd is the agent
  workspace)
- `input(id, data)` — write raw bytes to stdin (caller appends `\r\n` / `\x03`)
- `kill(id)` — end the session (called on panel close)
- `onData(cb)` → `{id, chunk}` stream; filter by id
- `onExit(cb)` → `{id, code}`

## The button (chat header)

Sits right after `<ViewsButton>` in `Chat.tsx`. `btn btn-sm`, ghost when closed /
solid when open, terminal glyph + "Terminal" label. Only meaningful with an
active chat (needs a workspace + chat id).

## Hard rules

- Monochrome only; the "exited" pill is the one accent (`--bad` clay), no real red.
- JetBrains Mono throughout the output + input.
- Dark only; honor `prefers-reduced-motion`; visible `:focus-visible` on the input.
- It is the user's own shell (like VS Code's) — no approval gate, but never imply
  remote/cloud execution. Everything runs locally.

## Refinement ideas (optional)

- Tabs / multiple concurrent sessions per chat.
- A clear-output control and a copy-all affordance.
- Subtle "running" affordance while a command streams.
- Make it openable from the Dashboard, not only inside a chat.
