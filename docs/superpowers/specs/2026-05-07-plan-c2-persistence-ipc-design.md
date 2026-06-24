# Flowstate — Plan C2: Persistence + IPC Streaming Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent:** `2026-05-05-ai-agent-dashboard-design.md`
**Depends on:** Plan A (Foundation), Plan B (FileTools), Plan C1 (Backend runtime)

## 1. Concept

Plan C2 adds persistence and IPC streaming to glue the C1 runtime to the renderer. After C2, the renderer can:

- list agents (one hardcoded "Code Helper" for now)
- list/create chats per agent
- fetch persisted messages for a chat
- send a new user message and receive streamed `AgentEvent`s in real time
- abort an in-flight send

No chat UI yet — renderer interaction in C2 is verified via integration tests. UI lands in C3.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| IPC streaming pattern | `chat:send-message` invoke returns `streamId`; events on `chat:event:<streamId>`, terminator on `chat:event:<streamId>:end` | Standard Electron pattern; auto-cleans when stream ends |
| Hardcoded agent | "Code Helper" seeded by migration 002 if `agents` table empty | Plan ladder: multi-agent CRUD = Plan D |
| Schema scope | Only fields needed for C2; `agents` extras (description, tags, avatar_color) deferred to migration 003 / Plan D | YAGNI |
| Streaming throttle | None in C2 (renderer concern, lands in C3 if needed) | Plan C focus = correctness, not perf |
| Existing OllamaClient (Plan A health check) | Kept for Settings screen as-is; AgentRuntime uses OllamaProvider (C1) | Refactor to single Ollama abstraction = future cleanup, not C2 |
| Chat title | Auto-generated from first user message (first 60 chars trimmed) on first `appendMessage` | Cheap, no LLM call |
| History rebuild on send | `ChatRepository.getMessages(chatId)` → `ConversationMessage[]` passed to `AgentRuntime` constructor each send | Keeps repo authoritative; runtime is per-send |

## 3. Schema (Migration 002)

```sql
-- 002_chats.sql

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_agent ON chats(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  tool_calls_json TEXT,           -- JSON array of {id, name, args}; only for assistant role
  tool_call_id TEXT,              -- only for tool role
  tool_name TEXT,                 -- only for tool role
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
```

**Seed (also in 002_chats.sql, appended after CREATE TABLEs):**

The seed is conditional — if `agents` is empty when migration 002 runs, insert Code Helper. The seed includes a placeholder workspace path that is updated at app startup if `workspaces_dir` setting exists. Migration logic in `database.ts` handles the runtime patching after the file SQL runs.

```sql
-- conditional seed: only if no agents exist
INSERT INTO agents (id, name, system_prompt, model, workspace_path, created_at, updated_at)
SELECT
  'agent-code-helper',
  'Code Helper',
  'You are Code Helper, a focused coding assistant. You work inside a sandboxed folder using file tools. Read before writing. Confirm structure before bulk changes. Be concise.',
  'qwen2.5-coder:14b',
  '__WORKSPACE_PLACEHOLDER__',
  unixepoch() * 1000,
  unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agents);
```

After migration runs, `database.ts` post-step:

```ts
// in openDatabase, after migrations apply:
const placeholder = '__WORKSPACE_PLACEHOLDER__';
const helper = db.prepare("SELECT id, workspace_path FROM agents WHERE id = 'agent-code-helper'").get() as
  | { id: string; workspace_path: string }
  | undefined;
if (helper && helper.workspace_path === placeholder) {
  // Caller (main/index.ts) is responsible for calling setHelperWorkspace(realPath) after wiring.
}
// We expose a helper:
export function setHelperWorkspace(db, absolutePath) {
  db.prepare("UPDATE agents SET workspace_path = ?, updated_at = ? WHERE id = 'agent-code-helper' AND workspace_path = '__WORKSPACE_PLACEHOLDER__'")
    .run(absolutePath, Date.now());
}
```

`main/index.ts` calls `setHelperWorkspace(db, join(workspacesDir, 'code-helper'))` and ensures the dir exists with `mkdir { recursive: true }`.

## 4. ChatRepository API

```ts
// src/main/repos/chat-repository.ts

import type { Database } from 'better-sqlite3';
import type { ConversationMessage } from '@main/agent/types';

export interface AgentRow {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRow {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRow {
  id: string;
  chatId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
  toolCallId?: string;
  toolName?: string;
  createdAt: number;
}

export class ChatRepository {
  constructor(db: Database);

  listAgents(): AgentRow[];
  getAgent(id: string): AgentRow | null;

  listChats(agentId: string): ChatRow[];
  createChat(agentId: string, title?: string): ChatRow;
  updateChatTitle(chatId: string, title: string): void;

  getMessages(chatId: string): MessageRow[];
  appendMessage(chatId: string, msg: Omit<MessageRow, 'id' | 'chatId' | 'createdAt'>): MessageRow;

  // Convert MessageRow[] → ConversationMessage[] for AgentRuntime
  toConversation(rows: MessageRow[]): ConversationMessage[];
}
```

`appendMessage` side-effect: bumps the parent chat's `updated_at`. If chat title is empty AND new message is the first user message, auto-set title to `content.slice(0, 60).trim()`.

## 5. IPC Channels

Added to `src/shared/ipc-channels.ts`:

```ts
CHANNELS = {
  // ... existing settings/ollama
  CHAT_LIST_AGENTS: 'chat:list-agents',
  CHAT_LIST_CHATS: 'chat:list-chats',
  CHAT_CREATE_CHAT: 'chat:create-chat',
  CHAT_GET_MESSAGES: 'chat:get-messages',
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_ABORT: 'chat:abort',
  // event channel pattern: chat:event:<streamId>
  // terminator pattern:    chat:event:<streamId>:end
};
```

Zod request/response schemas:

| Channel | Request | Response |
|---|---|---|
| `chat:list-agents` | `{}` | `{ agents: AgentDto[] }` |
| `chat:list-chats` | `{ agentId: string }` | `{ chats: ChatDto[] }` |
| `chat:create-chat` | `{ agentId: string, title?: string }` | `{ chat: ChatDto }` |
| `chat:get-messages` | `{ chatId: string }` | `{ messages: MessageDto[] }` |
| `chat:send-message` | `{ chatId: string, text: string }` | `{ streamId: string }` |
| `chat:abort` | `{ streamId: string }` | `{ ok: boolean }` |

`*Dto` types match repo row shapes minus internal-only fields. Defined in `src/shared/chat-types.ts` so renderer + main both import them.

Event payload sent on `chat:event:<streamId>` is the `AgentEvent` from C1 directly. End channel sends `{ reason }` derived from final `turn-done`.

## 6. AgentSession + Manager

```ts
// src/main/agent/agent-session.ts

export interface AgentSessionOpts {
  streamId: string;
  agent: AgentRow;
  chat: ChatRow;
  history: ConversationMessage[];
  provider: LLMProvider;
  dispatcher: ToolDispatcher;
  repo: ChatRepository;
  send: (channel: string, payload: unknown) => void;  // bridge to BrowserWindow.webContents.send
}

export class AgentSession {
  constructor(opts: AgentSessionOpts);
  async run(userText: string): Promise<void>;  // resolves when stream + persistence done
  abort(): void;
}
```

`run(userText)`:
1. Persist user message via `repo.appendMessage(chatId, {role: 'user', content: userText})`.
2. Construct `AgentRuntime` with provided history + system prompt + tools + dispatcher.
3. Subscribe to `runtime.send(userText, abortController.signal)` events.
4. For each event:
   - emit IPC: `send('chat:event:'+streamId, event)`
   - on `text-delta`: accumulate `pendingAssistantText`
   - on `tool-call`: persist nothing yet (we wait until paired tool-result arrives, then persist as a single assistant turn snapshot — simpler: persist assistant message with toolCalls when first tool-call arrives, then persist tool messages as they finalize)

   **Simpler scheme — persist on `turn-done`:**
   - keep buffer of: `assistantMessages: { content: string; toolCalls?: ToolCall[] }[]`, `toolMessages: { toolCallId, toolName, content }[]`
   - on `text-delta` accumulate into current assistant draft
   - on `tool-call` flush current assistant draft (push to buffer with toolCalls), reset
   - on `tool-result` push to toolMessages buffer
   - on `turn-done`: write all buffered messages to DB in a single transaction. Send `chat:event:<streamId>:end`.
5. If `turn-done.reason === 'aborted'` or `'error'`: do NOT persist partial assistant/tool messages (matches runtime's history rollback). Send end event with reason.
6. Resolve.

```ts
// src/main/agent/agent-session-manager.ts

export class AgentSessionManager {
  constructor(deps: { provider: LLMProvider; repo: ChatRepository; dispatcherFactory: (workspacePath: string) => ToolDispatcher; send: (channel: string, payload: unknown) => void });

  start(chatId: string): Promise<{ streamId: string; session: AgentSession }>;  // creates streamId, builds history, returns session for caller to run
  abort(streamId: string): boolean;
  has(streamId: string): boolean;
}
```

Manager keeps a `Map<streamId, AgentSession>`. Sessions auto-deregister on completion/abort.

`dispatcherFactory(workspacePath)` builds a fresh `FileTools` + `ToolDispatcher` per session — keeps sandbox per-agent-workspace.

The `send` callback is provided by `main/index.ts` and calls `BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)`. If no window exists, payloads drop silently — acceptable since IPC is meaningless without a renderer.

## 7. IPC Handlers

```ts
// src/main/ipc/handlers/chat.ts

export function registerChatHandlers(deps: {
  repo: ChatRepository;
  manager: AgentSessionManager;
}): void {
  ipcMain.handle(CHANNELS.CHAT_LIST_AGENTS, () => ({ agents: deps.repo.listAgents() }));
  ipcMain.handle(CHANNELS.CHAT_LIST_CHATS, (_e, raw) => {
    const { agentId } = schemas.chatListChatsRequest.parse(raw);
    return { chats: deps.repo.listChats(agentId) };
  });
  ipcMain.handle(CHANNELS.CHAT_CREATE_CHAT, (_e, raw) => {
    const { agentId, title } = schemas.chatCreateChatRequest.parse(raw);
    return { chat: deps.repo.createChat(agentId, title) };
  });
  ipcMain.handle(CHANNELS.CHAT_GET_MESSAGES, (_e, raw) => {
    const { chatId } = schemas.chatGetMessagesRequest.parse(raw);
    return { messages: deps.repo.getMessages(chatId) };
  });
  ipcMain.handle(CHANNELS.CHAT_SEND_MESSAGE, async (_e, raw) => {
    const { chatId, text } = schemas.chatSendMessageRequest.parse(raw);
    const { streamId, session } = await deps.manager.start(chatId);
    // Run in background — don't await; renderer reads events via channel.
    void session.run(text);
    return { streamId };
  });
  ipcMain.handle(CHANNELS.CHAT_ABORT, (_e, raw) => {
    const { streamId } = schemas.chatAbortRequest.parse(raw);
    return { ok: deps.manager.abort(streamId) };
  });
}
```

## 8. main/index.ts updates

```ts
// after settings + ollamaClient setup:

const provider = new OllamaProvider(ollamaHost);

const repo = new ChatRepository(db);

const workspacesDir = settings.get('workspaces_dir')!;
const helperPath = join(workspacesDir, 'code-helper');
await mkdir(helperPath, { recursive: true });
setHelperWorkspace(db, helperPath);

const dispatcherFactory = (workspacePath: string) => {
  const tools = new FileTools(workspacePath);
  return new ToolDispatcher(tools);
};

const send = (channel: string, payload: unknown) => {
  const win = BrowserWindow.getAllWindows()[0];
  win?.webContents.send(channel, payload);
};

const sessionManager = new AgentSessionManager({
  provider,
  repo,
  dispatcherFactory,
  send,
});

registerIpcHandlers({ settings, ollama: ollamaClient });
registerChatHandlers({ repo, manager: sessionManager });
```

Existing `OllamaClient` (Plan A health check) is renamed in passing comments to clarify it's the health-only ping; kept untouched.

## 9. Test Strategy

**migration-002.test.ts:**
- Open fresh DB → migration 002 applies → `agents`, `chats`, `messages` tables exist
- `agents` table contains exactly one row: `agent-code-helper` with placeholder workspace
- Reopen DB → migration NOT re-applied (idempotent)
- After `setHelperWorkspace(db, '/tmp/foo')` → workspace_path updated
- Re-call `setHelperWorkspace` with different path → no-op (placeholder gone)

**chat-repository.test.ts** (~12 tests):
- listAgents / getAgent
- createChat sets timestamps, defaults empty title
- listChats orders by updated_at DESC
- getMessages returns rows in created_at order
- appendMessage assigns id, sets timestamps, bumps chat updated_at
- appendMessage auto-sets chat title from first user message (60-char trim)
- appendMessage with empty title and second user message does NOT change title
- toolCalls JSON round-trip (assistant message with toolCalls field)
- toConversation maps rows correctly

**agent-session.test.ts** (~8 tests, real SQLite + FakeProvider + real ToolDispatcher + real FileTools):
- Single-text turn: persists user message, persists assistant message on turn-done end, emits IPC events to fake send-fn
- One tool call success: persists user, assistant(toolCalls), tool, assistant(final) — exact 4 messages added
- Aborted run: persists ONLY user message (rollback semantics), end event includes reason aborted
- Errored run: same as aborted
- Multiple tool calls in one turn: persists all in single transaction
- Manager.start/has/abort lifecycle

Tests use a tmpdir workspace per session, build agent + chat fixtures via repo, and capture IPC events into an array.

## 10. Out of Scope (Plan C3)

- Renderer chat UI (composer, message list, tool-call cards) — C3.
- Streaming throttle / batching — C3 (renderer-side).
- Real Ollama smoke (manual test) — C3.
- Chat title regeneration via LLM — Plan G.
- Multi-window broadcast — single-window for v1.
- Multi-agent CRUD — Plan D.
- Workspace existence verification on session start (we just `mkdir -p` once at startup) — fine for v1.

## 11. Resolved Decisions

- Streaming pattern: **per-stream channel** `chat:event:<streamId>`, terminator `chat:event:<streamId>:end`.
- Where to persist assistant messages: **on turn-done**, in a single transaction, only if reason is `end` or `max-tools`.
- Hardcoded agent: **seeded by migration 002**, workspace path patched at app start.
- Chat title: **auto-trimmed first user message**, no LLM.
- Existing OllamaClient (Plan A): **kept** for Settings screen, separate from OllamaProvider used by runtime.
