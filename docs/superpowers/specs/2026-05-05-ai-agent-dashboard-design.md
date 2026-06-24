# Flowstate — Design Spec

**Date:** 2026-05-05
**Status:** Approved by user 2026-05-05
**Name:** Flowstate

## 1. Concept

Desktop application for creating and managing multiple local AI agents. Each agent runs against a local Ollama model, owns a workspace folder, and executes tasks through a chat interface. Agents read/write files, run shell commands (with user approval), and build software end-to-end. A built-in **orchestrator** routes incoming tasks to the best-suited agent based on each agent's description and specialty tags.

Mental model: a visual, multi-agent Claude Code that runs entirely on the user's machine with no API costs.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Platforms | Electron desktop only (Windows-first) | Android dropped from v1; agent runtime is the riskiest core, ship that first |
| LLM backend | **Ollama, local only** | $0 per task, fully offline, no API keys; abstracted behind `LLMProvider` interface so cloud providers can be added later |
| Default model | `qwen2.5-coder:14b` | Best 14b tool-use, fits 16GB VRAM with headroom |
| Orchestrator model | `qwen2.5:7b` | Small/fast — only classifies routing, doesn't need coder model |
| Execution model | Persistent conversation per agent | Matches "like Claude Code"; chat history preserved |
| Tool surface | File ops + sandboxed shell with per-command user approval | Agents can build + run + test code; approval gate blocks destructive surprises |
| Concurrency | Multiple agents run in parallel, each in own chat tab | Core differentiator vs. single-thread Claude Code |
| Process model | Single Electron main process, async agents | Simplest; refactor to worker pool only if perf demands |
| Persistence | SQLite (`better-sqlite3`) for chats + metadata; plain folders on disk for workspaces | Chats grow fast, SQLite handles it; user can `cd` into workspaces, open in VS Code, git init |
| Orchestrator behavior | Routes to one agent + manual override (user can bypass and chat with specific agent) | Smart by default, predictable when needed; no agent-to-agent delegation in v1 |

## 3. Architecture

### 3.1 Process layout

```
┌─────────────────────────────────────────────────┐
│ Electron Renderer (React + TS + Framer Motion)  │
│ - Dashboard, agent tabs, chat UI, file browser  │
└────────────────────┬────────────────────────────┘
                     │ IPC (typed channels, zod-validated)
┌────────────────────▼────────────────────────────┐
│ Electron Main Process                            │
│ ┌───────────────┐  ┌────────────────────────┐   │
│ │ Agent Manager │  │ Orchestrator (router)  │   │
│ │ - registry    │  │ - reads agent specs    │   │
│ │ - lifecycle   │  │ - calls Ollama         │   │
│ └───────┬───────┘  └───────────┬────────────┘   │
│         │                      │                 │
│ ┌───────▼──────────────────────▼─────────────┐  │
│ │ Agent Runtime (per-agent, async)           │  │
│ │ - Ollama HTTP client                       │  │
│ │ - tool-use loop (max 25 calls/turn)        │  │
│ │ - streaming → IPC events (50ms throttle)   │  │
│ └───────┬─────────────────────────────────────┘  │
│         │                                         │
│ ┌───────▼──────┐ ┌─────────────┐ ┌────────────┐ │
│ │ FS Tools     │ │ Shell Tool  │ │ Approval   │ │
│ │ (resolveSafe │ │ (cwd locked,│ │ Gate       │ │
│ │  sandbox)    │ │  60s timeout)│ │ → renderer│ │
│ └──────────────┘ └─────────────┘ └────────────┘ │
│                                                   │
│ ┌──────────────────┐                              │
│ │ SQLite (WAL)     │                              │
│ │ chats + metadata │                              │
│ └──────────────────┘                              │
└──────────────────────────────────────────────────┘
                     │ HTTP
                     ▼
        Ollama daemon (localhost:11434)
```

### 3.2 Tech stack

- **Shell**: Electron + Vite + TypeScript
- **UI**: React, Tailwind, shadcn/ui, Framer Motion
- **State**: Zustand (renderer), event bus (main↔renderer via IPC)
- **LLM**: `ollama` npm package
- **Storage**: `better-sqlite3` (WAL mode), JSON for SQLite blob columns
- **Validation**: Zod for IPC payloads
- **Search**: Native ripgrep binary bundled, or `@vscode/ripgrep`

### 3.3 Process security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for renderer
- All file system, shell, Ollama calls live in main process only
- IPC channels declared up-front with zod schemas; renderer cannot invoke arbitrary main-process handlers

### 3.4 LLM provider abstraction

```ts
interface LLMProvider {
  name: string;                       // "ollama"
  chatStream(opts: ChatStreamOpts): AsyncIterable<ChatDelta>;
  listModels(): Promise<Model[]>;
  pullModel(tag: string, onProgress): Promise<void>;
  isReachable(): Promise<boolean>;
}
```

v1 ships `OllamaProvider` only. Anthropic/OpenRouter/etc. slot in later without touching agent runtime.

## 4. Data Model

### 4.1 SQLite schema

```sql
agents (
  id TEXT PRIMARY KEY,           -- uuid
  name TEXT NOT NULL,
  description TEXT,              -- used by orchestrator routing
  specialty_tags TEXT,           -- JSON array, e.g. ["frontend","react"]
  system_prompt TEXT,
  model TEXT NOT NULL,           -- Ollama model tag, e.g. qwen2.5-coder:14b
  workspace_path TEXT NOT NULL,  -- absolute path
  tool_perms TEXT,               -- JSON: {shell_enabled:bool, delete_enabled:bool}
  approval_policy TEXT,          -- "cautious" | "trusting" | "yolo" (yolo gated by warning)
  avatar_color TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

chats (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT,                    -- auto-summarized
  created_at INTEGER
);

messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT,                     -- user | assistant | tool_result | system
  content_json TEXT,             -- content blocks: text, tool_use, tool_result
  token_usage_json TEXT,         -- {prompt, completion, total} from Ollama eval counts
  created_at INTEGER
);

approvals (
  id TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  tool_name TEXT,                -- shell | write_file | delete_file
  tool_input_json TEXT,
  decision TEXT,                 -- pending | allowed | denied
  remember_for_session INTEGER,  -- bool 0/1
  created_at INTEGER
);

settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 4.2 Workspace folder layout

User-visible on disk (default location configurable):

```
~/AgentDashboard/
  workspaces/
    code-helper-a8f3/        ← agent's sandbox root
      .gitignore             ← auto-created
      (whatever agent creates)
    research-bot-7c2d/
      ...
```

### 4.3 Tool surface

| Tool | Approval | Notes |
|---|---|---|
| `read_file(path)` | none | path resolved relative to workspace |
| `list_dir(path)` | none | |
| `search_files(pattern, path)` | none | ripgrep-style |
| `write_file(path, content)` | depends on agent's `approval_policy` (see below) | always allowed if path doesn't exist; overwrite of existing file gated by policy |
| `delete_file(path)` | always (unless `tool_perms.delete_enabled=false`, then tool not exposed) | |
| `run_shell(command)` | always (unless `tool_perms.shell_enabled=false`, then tool not exposed) | cwd locked to workspace; 60s default timeout (overridable per command via approval modal); output capped at 1MB |

**Approval policy presets** (per agent):

- **cautious**: every write to existing file, every delete, every shell command prompts user
- **trusting**: file writes/overwrites auto-allowed; deletes and shell still prompt
- **yolo**: all auto-allowed; selecting it shows a one-time scary confirmation; never default

### 4.4 Path safety

Single `resolveSafe(workspaceRoot, relPath): string` function. All tools route through it. Rejects:
- Absolute paths (any input starting with drive letter, `/`, or `\\`)
- Path components equal to `..`
- Symlinks (resolved real path must remain inside workspace root)

Unit tested against attack vector list (`../../etc`, `..\\..\\Windows`, symlink-to-root, NUL bytes, UNC paths).

## 5. Screens & Flows

### 5.1 Screens

1. **First-run setup** — checks Ollama installed + reachable; if missing, shows install link; offers to pull default model `qwen2.5-coder:14b` with progress bar; sets default workspaces directory.
2. **Dashboard** — global "Ask anything" input at top routes through orchestrator; agent grid below (name, color, tags, status badge: idle/working/awaiting-approval, last-activity time, "Stop" button if running); "+ New Agent" card; sidebar with settings.
3. **Agent detail / chat** — left rail: chat list for this agent; center: streaming message thread, tool calls collapsible, tool results inline; right rail (collapsible): file browser of agent's workspace; bottom composer with model selector and context-usage bar.
4. **New / edit agent** — name, description, specialty tags, system prompt (textarea + preset library), model picker (lists locally pulled Ollama models), workspace folder (auto-created or pick existing), tool permissions, approval policy (trusting/cautious/yolo).
5. **File browser** (right rail or modal) — tree of workspace; click file → preview/edit/delete; "Open in Explorer" / "Open in VS Code" buttons.
6. **Approval prompt** (slide-in sheet) — tool name, full input/command shown bold, cwd, options: Allow once / Allow rest of chat / Deny. For shell, command displayed in monospace with copy button.
7. **Settings** — default model, default approval policy, theme, animation intensity, default workspaces directory, Ollama host (defaults `http://localhost:11434`).

### 5.2 Primary flow (open → result)

1. Open app → Dashboard.
2. User types task in global box: *"build me a tic-tac-toe React app"*.
3. Orchestrator runs (single Ollama call to `qwen2.5:7b` with system prompt enumerating each agent's name/description/tags + the user task; expects JSON `{chosen_agent_id, reasoning}`).
4. UI shows brief "Routing to **Code Helper** — frontend specialty match" toast, opens Code Helper's chat tab, posts task as first user message.
5. Agent runtime begins tool-use loop. Streams text → write_file → run_shell. Each shell call triggers approval modal until user clicks "Allow rest of chat".
6. Tokens stream to UI throttled at 50ms / 500-char batches.
7. Loop ends when model emits no tool calls. Final assistant message displayed.
8. User can keep chatting in same thread, click files in right rail, or return to dashboard and start a new task.

### 5.3 Manual override flow

User clicks an agent card on dashboard → opens chat directly → bypasses orchestrator entirely. New messages go straight to that agent.

## 6. v1 Scope

**Must-have:**
1. First-run Ollama check + model puller with progress
2. CRUD agents (name, description, tags, system prompt, model, workspace, tool perms)
3. Persistent per-agent chats with token streaming
4. File tools (read, write, list, delete, search) sandboxed via `resolveSafe`
5. Shell tool with per-command approval modal, 60s timeout, 1MB output cap
6. Orchestrator routing + manual override
7. Dashboard with live agent status (idle / working / awaiting-approval)
8. Right-rail file browser per agent
9. Multiple agents running in parallel, each in own tab
10. Settings (default model, approval policy, theme, Ollama host)
11. Stop-agent button (kills in-flight tool-use loop, marks turn aborted)
12. Auto-created `.gitignore` in new workspaces

**Nice-to-have:**
- Token/time usage display per chat
- Auto-summarized chat titles (small Ollama call after first turn)
- System-prompt preset library (frontend dev, researcher, writer, ops)
- Dark/light theme + Framer Motion polish
- Export chat as markdown
- "Open workspace in VS Code / Explorer" buttons
- Empty-state onboarding wizard with 3 preset agents pre-filled

**Deferred (v2+):**
- Agent-to-agent delegation
- Multi-provider backends (Anthropic, OpenRouter, OpenAI)
- Cloud sync / multi-device
- Android companion app
- Image / PDF / binary file handling
- Web search tool, browser automation tool
- Per-agent providers / API keys
- Voice input
- Plugin / MCP server support

## 7. Risk Register

Highest-risk items first. Each must be addressed during implementation.

1. **Local-model tool-use reliability** — open-weight models hallucinate tool calls and emit malformed JSON. Mitigations: strict zod validation of tool args, auto-retry once with corrective error message back to model, max 25 tool calls per turn, hard stop with user notice, kill switch in UI.
2. **Path sandbox correctness** — bug = agent writes outside workspace. Mitigations: single `resolveSafe()` function gated by every tool, exhaustive unit tests including symlinks/UNC/`..`/null bytes, deny-by-default on any error.
3. **Shell command misuse** — fatigue-clicked approval. Mitigations: command shown in bold monospace with cwd, timeout enforced, output size cap, no admin/sudo passthrough, env scrubbed of secrets, rate-limit approvals (max 1 modal per second).
4. **Streaming + IPC backpressure** — multiple agents saturate IPC. Mitigations: throttle/batch deltas at 50ms or 500 chars per agent, drop intermediate text deltas if queue depth grows.
5. **Long chat context overflow** — 14b ctx fills fast. Mitigations: rolling-summary compaction at 80% of context window, visible context bar in composer.
6. **SQLite contention** — better-sqlite3 is sync. Mitigations: WAL mode, batched writes per chat, single writer queue.
7. **Ollama model downloads** — multi-GB pulls fail. Mitigations: stream Ollama pull progress events, resume on retry, clear error UI.
8. **Crash mid-turn** — orphaned in-flight messages. Mitigations: on app start, mark any `assistant` message without `stop_reason` as `aborted`, do not replay tool calls.

## 8. Decision-Impact Map

| Decision | Affects |
|---|---|
| Ollama local-only | No API key UI, no cost displays, no auth; first-run gains Ollama install check |
| Persistent chat per agent | Need rolling-summary at context limit |
| Sandboxed shell + approval | Approval modal UX is core, not optional polish |
| Parallel agents | Need per-agent stop button + dashboard live status |
| SQLite + plain workspace folders | Workspaces are normal directories — user can git init, open in VS Code |
| Orchestrator + manual override | Agents must have description + specialty tags; orchestrator needs its own Ollama model |

## 9. Out of Scope

- Web/cloud deployment of any kind
- Multi-user accounts, auth, billing
- Mobile (Android explicitly deferred)
- Anthropic / OpenAI / cloud LLM providers in v1
- Agent memory beyond chat history (no long-term vector store in v1)
- MCP server hosting

## 10. Resolved Decisions (was Open Questions)

- **App name:** Flowstate.
- **Ollama install:** user-installed daemon required. First-run check pings `localhost:11434`; if unreachable, shows install link to ollama.com plus instructions; no auto-install or bundling.
- **`run_shell` interactivity:** non-interactive only. Agent must pass full args (e.g. `npm init -y`). Documented limitation.
