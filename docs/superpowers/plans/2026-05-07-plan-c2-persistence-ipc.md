# Flowstate — Plan C2: Persistence + IPC Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chats and messages in SQLite, stream live `AgentEvent`s from `AgentRuntime` to the renderer over IPC, and seed a single hardcoded "Code Helper" agent so the next plan (C3) can render a chat UI on top.

**Architecture:** Migration 002 adds `agents`, `chats`, `messages` tables and seeds Code Helper. `ChatRepository` wraps CRUD. Each user `chat:send-message` invocation creates a per-stream `AgentSession` that drives `AgentRuntime`, mirrors events to a per-stream IPC channel (`chat:event:<streamId>`), and persists messages atomically on `turn-done`. `AgentSessionManager` tracks active streams and supports abort.

**Tech Stack:** `better-sqlite3` (Plan A), zod, vitest. No new npm deps.

**Demo target:** `npm test` passes ~30 new tests; integration test sends a message, observes streamed events, and confirms persisted rows. UI lands in C3.

---

## File Structure

```
src/main/db/migrations/
└── 002_chats.sql                       # NEW — agents, chats, messages + Code Helper seed

src/main/db/database.ts                  # MODIFY — register migration 002, add setHelperWorkspace export

src/main/repos/
└── chat-repository.ts                   # NEW

src/main/agent/
├── agent-session.ts                     # NEW
└── agent-session-manager.ts             # NEW

src/main/ipc/handlers/
└── chat.ts                              # NEW

src/main/ipc/register.ts                 # MODIFY — call registerChatHandlers
src/shared/ipc-channels.ts               # MODIFY — add CHAT_* constants + schemas
src/shared/chat-types.ts                 # NEW — AgentDto, ChatDto, MessageDto shared with renderer
src/main/index.ts                        # MODIFY — wire repo, manager, helper workspace path

tests/main/db/
└── migration-002.test.ts                # NEW

tests/main/repos/
└── chat-repository.test.ts              # NEW

tests/main/agent/
└── agent-session.test.ts                # NEW

tests/shared/
└── ipc-channels.test.ts                 # MODIFY — append chat channel cases
```

---

## Conventions

- TS strict, ESM, Conventional Commits.
- Git author flags: `git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit ...`
- Node 22 PATH prefix on every shell command:

  ```bash
  export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH"
  ```
- Test fixture DBs use `mkdtempSync(join(tmpdir(), 'flowstate-...-'))`; cleaned in `afterEach`.

---

## Task 1: Migration 002 + setHelperWorkspace

**Files:**
- Create: `src/main/db/migrations/002_chats.sql`
- Modify: `src/main/db/database.ts`
- Test: `tests/main/db/migration-002.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/main/db/migration-002.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setHelperWorkspace } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-mig2-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 002 — schema', () => {
  it('creates agents, chats, messages tables', () => {
    const db = openDatabase(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['agents', 'chats', 'messages', 'schema_version', 'settings']));
    db.close();
  });

  it('records schema_version 2', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBe(2);
    db.close();
  });

  it('messages.role has CHECK constraint', () => {
    const db = openDatabase(dbPath);
    expect(() =>
      db
        .prepare(
          'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)',
        )
        .run('m1', 'no-such-chat', 'banana', '', Date.now()),
    ).toThrow();
    db.close();
  });

  it('cascading delete: removing an agent removes its chats and messages', () => {
    const db = openDatabase(dbPath);
    const helperId = 'agent-code-helper';
    db.prepare(
      'INSERT INTO chats (id, agent_id, title, created_at, updated_at) VALUES (?,?,?,?,?)',
    ).run('c1', helperId, 't', 1, 1);
    db.prepare(
      'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)',
    ).run('m1', 'c1', 'user', 'hi', 1);
    db.prepare('DELETE FROM agents WHERE id = ?').run(helperId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({ n: 0 });
    db.close();
  });
});

describe('migration 002 — Code Helper seed', () => {
  it('inserts Code Helper exactly once on first apply', () => {
    const db = openDatabase(dbPath);
    const rows = db.prepare('SELECT * FROM agents').all() as Array<{ id: string; name: string; workspace_path: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('agent-code-helper');
    expect(rows[0]?.name).toBe('Code Helper');
    expect(rows[0]?.workspace_path).toBe('__WORKSPACE_PLACEHOLDER__');
    db.close();
  });

  it('does not re-seed on reopen', () => {
    let db = openDatabase(dbPath);
    db.close();
    db = openDatabase(dbPath);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n;
    expect(count).toBe(1);
    db.close();
  });
});

describe('setHelperWorkspace', () => {
  it('updates the placeholder to the given absolute path', () => {
    const db = openDatabase(dbPath);
    setHelperWorkspace(db, 'C:/tmp/flowstate/code-helper');
    const row = db.prepare("SELECT workspace_path FROM agents WHERE id = 'agent-code-helper'").get() as { workspace_path: string };
    expect(row.workspace_path).toBe('C:/tmp/flowstate/code-helper');
    db.close();
  });

  it('does NOT overwrite a non-placeholder path', () => {
    const db = openDatabase(dbPath);
    setHelperWorkspace(db, 'C:/first');
    setHelperWorkspace(db, 'C:/second');
    const row = db.prepare("SELECT workspace_path FROM agents WHERE id = 'agent-code-helper'").get() as { workspace_path: string };
    expect(row.workspace_path).toBe('C:/first');
    db.close();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test -- tests/main/db/migration-002.test.ts
```

Expected: failures — module exports `setHelperWorkspace` unknown OR migration 002 not present.

- [ ] **Step 3: Write `src/main/db/migrations/002_chats.sql`**

```sql
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
  tool_calls_json TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

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

- [ ] **Step 4: Modify `src/main/db/database.ts`** — register migration 002 and add `setHelperWorkspace`

Read current contents, then replace the file with:

```ts
import Database, { type Database as DB } from 'better-sqlite3';
import migration001 from './migrations/001_init.sql?raw';
import migration002 from './migrations/002_chats.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 },
];

const HELPER_PLACEHOLDER = '__WORKSPACE_PLACEHOLDER__';

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentRow = db
    .prepare('SELECT MAX(version) AS v FROM schema_version')
    .get() as { v: number | null };
  const current = currentRow.v ?? 0;

  const insertVersion = db.prepare(
    'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
  );

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      insertVersion.run(m.version, Date.now());
    })();
  }

  return db;
}

export function setHelperWorkspace(db: DB, absolutePath: string): void {
  db.prepare(
    "UPDATE agents SET workspace_path = ?, updated_at = ? WHERE id = 'agent-code-helper' AND workspace_path = ?",
  ).run(absolutePath, Date.now(), HELPER_PLACEHOLDER);
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
npm test -- tests/main/db/migration-002.test.ts
```

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/db/migrations/002_chats.sql src/main/db/database.ts tests/main/db/migration-002.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(db): migration 002 adds agents/chats/messages and seeds Code Helper"
```

---

## Task 2: Shared chat DTOs + IPC channel constants/schemas

**Files:**
- Create: `src/shared/chat-types.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `tests/shared/ipc-channels.test.ts` (append cases)

- [ ] **Step 1: Append failing tests to `tests/shared/ipc-channels.test.ts`**

Read the current file, then APPEND these tests at the bottom (do NOT modify existing tests):

```ts
import {
  // existing imports may already pull these — add what's missing
} from '@shared/ipc-channels';

describe('chat channels', () => {
  it('declares chat channels with stable names', () => {
    expect(CHANNELS.CHAT_LIST_AGENTS).toBe('chat:list-agents');
    expect(CHANNELS.CHAT_LIST_CHATS).toBe('chat:list-chats');
    expect(CHANNELS.CHAT_CREATE_CHAT).toBe('chat:create-chat');
    expect(CHANNELS.CHAT_GET_MESSAGES).toBe('chat:get-messages');
    expect(CHANNELS.CHAT_SEND_MESSAGE).toBe('chat:send-message');
    expect(CHANNELS.CHAT_ABORT).toBe('chat:abort');
  });

  it('chat:send-message request rejects empty text', () => {
    const r = schemas.chatSendMessageRequest.safeParse({ chatId: 'c1', text: '' });
    expect(r.success).toBe(false);
  });

  it('chat:send-message request accepts valid payload', () => {
    const r = schemas.chatSendMessageRequest.safeParse({ chatId: 'c1', text: 'hi' });
    expect(r.success).toBe(true);
  });

  it('chat:create-chat request allows optional title', () => {
    expect(schemas.chatCreateChatRequest.safeParse({ agentId: 'a1' }).success).toBe(true);
    expect(schemas.chatCreateChatRequest.safeParse({ agentId: 'a1', title: 't' }).success).toBe(true);
  });

  it('chat:abort request requires streamId', () => {
    expect(schemas.chatAbortRequest.safeParse({}).success).toBe(false);
    expect(schemas.chatAbortRequest.safeParse({ streamId: 's1' }).success).toBe(true);
  });

  it('chat:event channel name builder produces stable string', () => {
    expect(chatEventChannel('abc-123')).toBe('chat:event:abc-123');
    expect(chatEventEndChannel('abc-123')).toBe('chat:event:abc-123:end');
  });
});
```

(Note: the existing file already imports `CHANNELS` and `schemas`; the new test references `chatEventChannel` / `chatEventEndChannel` — add those imports at the top of the file.)

- [ ] **Step 2: Run tests, verify failures**

```bash
npm test -- tests/shared/ipc-channels.test.ts
```

Expected: import errors for new symbols.

- [ ] **Step 3: Write `src/shared/chat-types.ts`**

```ts
export interface AgentDto {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDto {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageDto {
  id: string;
  chatId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
  toolCallId?: string;
  toolName?: string;
  createdAt: number;
}
```

- [ ] **Step 4: Modify `src/shared/ipc-channels.ts`**

Read the current file. Add the new channel constants, the new zod schemas, the channel-name builder helpers, and inferred types. Keep ALL existing entries.

After editing, the file should look like (only new/changed lines noted in comments):

```ts
import { z } from 'zod';

export const CHANNELS = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_LIST: 'settings:list',
  OLLAMA_HEALTH: 'ollama:health',
  // NEW chat channels:
  CHAT_LIST_AGENTS: 'chat:list-agents',
  CHAT_LIST_CHATS: 'chat:list-chats',
  CHAT_CREATE_CHAT: 'chat:create-chat',
  CHAT_GET_MESSAGES: 'chat:get-messages',
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_ABORT: 'chat:abort',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

// NEW: per-stream event channel name builders
export function chatEventChannel(streamId: string): string {
  return `chat:event:${streamId}`;
}
export function chatEventEndChannel(streamId: string): string {
  return `chat:event:${streamId}:end`;
}

const messageDtoSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z
    .array(z.object({ id: z.string(), name: z.string(), args: z.unknown() }))
    .optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  createdAt: z.number(),
});

const agentDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  workspacePath: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const chatDtoSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const schemas = {
  // existing...
  settingsGetRequest: z.object({ key: z.string().min(1) }),
  settingsGetResponse: z.object({ value: z.string().nullable() }),
  settingsSetRequest: z.object({ key: z.string().min(1), value: z.string() }),
  settingsSetResponse: z.object({ ok: z.literal(true) }),
  settingsListRequest: z.object({}),
  settingsListResponse: z.object({
    items: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  ollamaHealthRequest: z.object({}),
  ollamaHealthResponse: z.object({
    reachable: z.boolean(),
    version: z.string().optional(),
    host: z.string(),
    errorMessage: z.string().optional(),
  }),

  // NEW chat schemas:
  chatListAgentsRequest: z.object({}),
  chatListAgentsResponse: z.object({ agents: z.array(agentDtoSchema) }),

  chatListChatsRequest: z.object({ agentId: z.string().min(1) }),
  chatListChatsResponse: z.object({ chats: z.array(chatDtoSchema) }),

  chatCreateChatRequest: z.object({
    agentId: z.string().min(1),
    title: z.string().optional(),
  }),
  chatCreateChatResponse: z.object({ chat: chatDtoSchema }),

  chatGetMessagesRequest: z.object({ chatId: z.string().min(1) }),
  chatGetMessagesResponse: z.object({ messages: z.array(messageDtoSchema) }),

  chatSendMessageRequest: z.object({
    chatId: z.string().min(1),
    text: z.string().min(1),
  }),
  chatSendMessageResponse: z.object({ streamId: z.string() }),

  chatAbortRequest: z.object({ streamId: z.string().min(1) }),
  chatAbortResponse: z.object({ ok: z.boolean() }),
};

// existing inferred types stay; new ones below
export type SettingsGetRequest = z.infer<typeof schemas.settingsGetRequest>;
export type SettingsGetResponse = z.infer<typeof schemas.settingsGetResponse>;
export type SettingsSetRequest = z.infer<typeof schemas.settingsSetRequest>;
export type SettingsSetResponse = z.infer<typeof schemas.settingsSetResponse>;
export type SettingsListResponse = z.infer<typeof schemas.settingsListResponse>;
export type OllamaHealthResponse = z.infer<typeof schemas.ollamaHealthResponse>;

export type ChatListAgentsResponse = z.infer<typeof schemas.chatListAgentsResponse>;
export type ChatListChatsRequest = z.infer<typeof schemas.chatListChatsRequest>;
export type ChatListChatsResponse = z.infer<typeof schemas.chatListChatsResponse>;
export type ChatCreateChatRequest = z.infer<typeof schemas.chatCreateChatRequest>;
export type ChatCreateChatResponse = z.infer<typeof schemas.chatCreateChatResponse>;
export type ChatGetMessagesRequest = z.infer<typeof schemas.chatGetMessagesRequest>;
export type ChatGetMessagesResponse = z.infer<typeof schemas.chatGetMessagesResponse>;
export type ChatSendMessageRequest = z.infer<typeof schemas.chatSendMessageRequest>;
export type ChatSendMessageResponse = z.infer<typeof schemas.chatSendMessageResponse>;
export type ChatAbortRequest = z.infer<typeof schemas.chatAbortRequest>;
export type ChatAbortResponse = z.infer<typeof schemas.chatAbortResponse>;
```

(Replace the entire file with the above structure — preserving the existing schema entries verbatim, adding the new ones.)

- [ ] **Step 5: Run all shared tests**

```bash
npm test -- tests/shared/ipc-channels.test.ts
```

Expected: existing 6 + new 6 = 12 passed (or whatever the existing count was, plus the 6 new ones).

- [ ] **Step 6: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/shared/chat-types.ts src/shared/ipc-channels.ts tests/shared/ipc-channels.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(shared): add chat IPC channels, schemas, and DTOs"
```

---

## Task 3: ChatRepository

**Files:**
- Create: `src/main/repos/chat-repository.ts`
- Test: `tests/main/repos/chat-repository.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/main/repos/chat-repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import type { Database } from 'better-sqlite3';

let dir: string;
let db: Database;
let repo: ChatRepository;
const HELPER = 'agent-code-helper';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-repo-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, '/tmp/ws/helper');
  repo = new ChatRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ChatRepository — agents', () => {
  it('listAgents returns the seeded helper', () => {
    const agents = repo.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: HELPER, name: 'Code Helper' });
  });

  it('getAgent returns null for unknown id', () => {
    expect(repo.getAgent('nope')).toBeNull();
  });

  it('getAgent returns the helper', () => {
    const a = repo.getAgent(HELPER);
    expect(a?.workspacePath).toBe('/tmp/ws/helper');
  });
});

describe('ChatRepository — chats', () => {
  it('createChat assigns id, sets timestamps, defaults empty title', () => {
    const c = repo.createChat(HELPER);
    expect(c.id).toMatch(/.+/);
    expect(c.agentId).toBe(HELPER);
    expect(c.title).toBe('');
    expect(c.createdAt).toBeGreaterThan(0);
    expect(c.updatedAt).toBe(c.createdAt);
  });

  it('createChat respects provided title', () => {
    const c = repo.createChat(HELPER, 'Hello');
    expect(c.title).toBe('Hello');
  });

  it('listChats orders by updated_at DESC', () => {
    const a = repo.createChat(HELPER, 'A');
    const b = repo.createChat(HELPER, 'B');
    // touch A so it becomes more recent
    repo.appendMessage(a.id, { role: 'user', content: 'hi' });
    const list = repo.listChats(HELPER);
    expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it('getChat returns null for unknown id', () => {
    expect(repo.getChat('nope')).toBeNull();
  });

  it('getChat returns the chat by id', () => {
    const c = repo.createChat(HELPER, 'X');
    expect(repo.getChat(c.id)?.title).toBe('X');
  });

  it('updateChatTitle updates title and bumps updated_at', () => {
    const c = repo.createChat(HELPER);
    const before = c.updatedAt;
    // ensure clock progress
    const wait = new Promise<void>((r) => setTimeout(r, 5));
    return wait.then(() => {
      repo.updateChatTitle(c.id, 'New');
      const after = repo.listChats(HELPER)[0]!;
      expect(after.title).toBe('New');
      expect(after.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('ChatRepository — messages', () => {
  it('appendMessage assigns id, sets created_at', () => {
    const c = repo.createChat(HELPER);
    const m = repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    expect(m.id).toMatch(/.+/);
    expect(m.chatId).toBe(c.id);
    expect(m.role).toBe('user');
    expect(m.createdAt).toBeGreaterThan(0);
  });

  it('appendMessage auto-sets chat title from first user message (60-char trim)', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'user', content: 'a'.repeat(80) });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('a'.repeat(60));
  });

  it('appendMessage does NOT change a non-empty title', () => {
    const c = repo.createChat(HELPER, 'preset');
    repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('preset');
  });

  it('appendMessage does NOT auto-title from non-user roles', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'assistant', content: 'hello' });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('');
  });

  it('getMessages returns rows in created_at order', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'user', content: 'a' });
    repo.appendMessage(c.id, { role: 'assistant', content: 'b' });
    const ms = repo.getMessages(c.id);
    expect(ms.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('round-trips toolCalls JSON for assistant role', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, {
      role: 'assistant',
      content: 'I will read',
      toolCalls: [{ id: 'tc1', name: 'read_file', args: { path: 'a.txt' } }],
    });
    const ms = repo.getMessages(c.id);
    expect(ms[0]?.toolCalls).toEqual([
      { id: 'tc1', name: 'read_file', args: { path: 'a.txt' } },
    ]);
  });

  it('round-trips toolCallId/toolName for tool role', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, {
      role: 'tool',
      content: 'hello',
      toolCallId: 'tc1',
      toolName: 'read_file',
    });
    const ms = repo.getMessages(c.id);
    expect(ms[0]?.toolCallId).toBe('tc1');
    expect(ms[0]?.toolName).toBe('read_file');
  });

  it('appendMessage bumps parent chat updated_at', async () => {
    const c = repo.createChat(HELPER);
    const before = c.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    repo.appendMessage(c.id, { role: 'user', content: 'x' });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.updatedAt).toBeGreaterThan(before);
  });
});

describe('ChatRepository.toConversation', () => {
  it('maps MessageRow[] → ConversationMessage[]', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    repo.appendMessage(c.id, {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 't1', name: 'list_dir', args: { path: '.' } }],
    });
    repo.appendMessage(c.id, {
      role: 'tool',
      content: '[]',
      toolCallId: 't1',
      toolName: 'list_dir',
    });
    const conv = repo.toConversation(repo.getMessages(c.id));
    expect(conv).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'list_dir', args: { path: '.' } }],
      },
      {
        role: 'tool',
        content: '[]',
        toolCallId: 't1',
        toolName: 'list_dir',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/repos/chat-repository.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/repos/chat-repository.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type {
  AgentDto,
  ChatDto,
  MessageDto,
} from '@shared/chat-types';
import type { ConversationMessage } from '@main/agent/types';

export type AgentRow = AgentDto;
export type ChatRow = ChatDto;
export type MessageRow = MessageDto;

interface AgentDbRow {
  id: string;
  name: string;
  system_prompt: string;
  model: string;
  workspace_path: string;
  created_at: number;
  updated_at: number;
}

interface ChatDbRow {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface MessageDbRow {
  id: string;
  chat_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  created_at: number;
}

function toAgent(r: AgentDbRow): AgentRow {
  return {
    id: r.id,
    name: r.name,
    systemPrompt: r.system_prompt,
    model: r.model,
    workspacePath: r.workspace_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toChat(r: ChatDbRow): ChatRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(r: MessageDbRow): MessageRow {
  const out: MessageRow = {
    id: r.id,
    chatId: r.chat_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  };
  if (r.tool_calls_json) {
    out.toolCalls = JSON.parse(r.tool_calls_json) as MessageRow['toolCalls'];
  }
  if (r.tool_call_id) out.toolCallId = r.tool_call_id;
  if (r.tool_name) out.toolName = r.tool_name;
  return out;
}

export class ChatRepository {
  private listAgentsStmt;
  private getAgentStmt;
  private listChatsStmt;
  private insertChatStmt;
  private updateChatTitleStmt;
  private bumpChatStmt;
  private getChatStmt;
  private getMessagesStmt;
  private insertMessageStmt;

  constructor(private readonly db: Database) {
    this.listAgentsStmt = db.prepare<[], AgentDbRow>(
      'SELECT * FROM agents ORDER BY name',
    );
    this.getAgentStmt = db.prepare<[string], AgentDbRow>(
      'SELECT * FROM agents WHERE id = ?',
    );
    this.listChatsStmt = db.prepare<[string], ChatDbRow>(
      'SELECT * FROM chats WHERE agent_id = ? ORDER BY updated_at DESC',
    );
    this.insertChatStmt = db.prepare(
      'INSERT INTO chats (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.updateChatTitleStmt = db.prepare(
      'UPDATE chats SET title = ?, updated_at = ? WHERE id = ?',
    );
    this.bumpChatStmt = db.prepare(
      'UPDATE chats SET updated_at = ? WHERE id = ?',
    );
    this.getChatStmt = db.prepare<[string], ChatDbRow>(
      'SELECT * FROM chats WHERE id = ?',
    );
    this.getMessagesStmt = db.prepare<[string], MessageDbRow>(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at',
    );
    this.insertMessageStmt = db.prepare(
      `INSERT INTO messages
        (id, chat_id, role, content, tool_calls_json, tool_call_id, tool_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  listAgents(): AgentRow[] {
    return this.listAgentsStmt.all().map(toAgent);
  }

  getAgent(id: string): AgentRow | null {
    const row = this.getAgentStmt.get(id);
    return row ? toAgent(row) : null;
  }

  listChats(agentId: string): ChatRow[] {
    return this.listChatsStmt.all(agentId).map(toChat);
  }

  getChat(chatId: string): ChatRow | null {
    const row = this.getChatStmt.get(chatId);
    return row ? toChat(row) : null;
  }

  createChat(agentId: string, title?: string): ChatRow {
    const id = randomUUID();
    const now = Date.now();
    this.insertChatStmt.run(id, agentId, title ?? '', now, now);
    return { id, agentId, title: title ?? '', createdAt: now, updatedAt: now };
  }

  updateChatTitle(chatId: string, title: string): void {
    this.updateChatTitleStmt.run(title, Date.now(), chatId);
  }

  getMessages(chatId: string): MessageRow[] {
    return this.getMessagesStmt.all(chatId).map(toMessage);
  }

  appendMessage(
    chatId: string,
    msg: Omit<MessageRow, 'id' | 'chatId' | 'createdAt'>,
  ): MessageRow {
    const id = randomUUID();
    const now = Date.now();

    const tx = this.db.transaction(() => {
      this.insertMessageStmt.run(
        id,
        chatId,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId ?? null,
        msg.toolName ?? null,
        now,
      );

      // Auto-title from first user message if title is currently empty.
      if (msg.role === 'user') {
        const chat = this.getChatStmt.get(chatId);
        if (chat && chat.title === '') {
          const title = msg.content.slice(0, 60).trim();
          if (title.length > 0) {
            this.updateChatTitleStmt.run(title, now, chatId);
            return;
          }
        }
      }

      // Always bump updated_at if no title-update happened.
      this.bumpChatStmt.run(now, chatId);
    });
    tx();

    const out: MessageRow = {
      id,
      chatId,
      role: msg.role,
      content: msg.content,
      createdAt: now,
    };
    if (msg.toolCalls) out.toolCalls = msg.toolCalls;
    if (msg.toolCallId) out.toolCallId = msg.toolCallId;
    if (msg.toolName) out.toolName = msg.toolName;
    return out;
  }

  toConversation(rows: MessageRow[]): ConversationMessage[] {
    return rows.map((r) => {
      const m: ConversationMessage = { role: r.role, content: r.content };
      if (r.toolCalls) m.toolCalls = r.toolCalls;
      if (r.toolCallId) m.toolCallId = r.toolCallId;
      if (r.toolName) m.toolName = r.toolName;
      return m;
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/main/repos/chat-repository.test.ts
```

Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/repos/chat-repository.ts tests/main/repos/chat-repository.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(repos): ChatRepository CRUD with auto-title from first user message"
```

---

## Task 4: AgentSession + AgentSessionManager

**Files:**
- Create: `src/main/agent/agent-session.ts`
- Create: `src/main/agent/agent-session-manager.ts`
- Test: `tests/main/agent/agent-session.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/main/agent/agent-session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import { FileTools } from '@main/tools';
import { ToolDispatcher } from '@main/agent/tool-dispatcher';
import { FakeProvider } from '@main/agent/fake-provider';
import { AgentSessionManager } from '@main/agent/agent-session-manager';
import type { ProviderDelta } from '@main/agent/llm-provider';
import { chatEventChannel, chatEventEndChannel } from '@shared/ipc-channels';

let dir: string;
let workspace: string;
let db: Database;
let repo: ChatRepository;
let chatId: string;
let events: Array<{ channel: string; payload: unknown }>;
let send: (channel: string, payload: unknown) => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-session-'));
  workspace = join(dir, 'ws');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');

  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, workspace);
  repo = new ChatRepository(db);
  const chat = repo.createChat('agent-code-helper');
  chatId = chat.id;

  events = [];
  send = (channel, payload) => {
    events.push({ channel, payload });
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function buildManager(provider: FakeProvider): AgentSessionManager {
  const dispatcherFactory = (path: string) => new ToolDispatcher(new FileTools(path));
  return new AgentSessionManager({
    provider,
    repo,
    dispatcherFactory,
    send,
  });
}

describe('AgentSession — single text turn', () => {
  it('persists user + final assistant, emits text-delta + turn-done', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'Hi' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    await session.run('hello');

    const ms = repo.getMessages(chatId);
    expect(ms.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(ms[1]?.content).toBe('Hi');

    const channels = events.map((e) => e.channel);
    expect(channels).toContain(chatEventChannel(streamId));
    expect(channels[channels.length - 1]).toBe(chatEventEndChannel(streamId));
  });
});

describe('AgentSession — one tool call success', () => {
  it('persists user, assistant(toolCalls), tool, assistant(final)', async () => {
    const provider = new FakeProvider([
      { type: 'tool-call', name: 'read_file', args: { path: 'a.txt' }, id: 'c1' },
      { type: 'done' },
      { type: 'text', text: 'File says hello' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { session } = await manager.start(chatId);
    await session.run('read it');

    const roles = repo.getMessages(chatId).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });
});

describe('AgentSession — abort', () => {
  it('persists only user message and emits aborted end', async () => {
    class SlowProvider extends FakeProvider {
      async *chatStream(opts: {
        signal?: AbortSignal;
      }): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'a' };
        await new Promise<void>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new Error('AbortError')),
          );
        });
      }
    }
    const provider = new SlowProvider([]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    const runPromise = session.run('please abort');
    // Wait briefly for first delta to flow, then abort.
    await new Promise((r) => setTimeout(r, 20));
    manager.abort(streamId);
    await runPromise;

    const roles = repo.getMessages(chatId).map((m) => m.role);
    expect(roles).toEqual(['user']);

    const endEvent = events.find((e) => e.channel === chatEventEndChannel(streamId));
    expect(endEvent).toBeDefined();
    expect(endEvent?.payload).toMatchObject({ reason: 'aborted' });
  });
});

describe('AgentSession — error', () => {
  it('persists only user message and emits error end', async () => {
    class ThrowingProvider extends FakeProvider {
      async *chatStream(): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'partial' };
        throw new Error('connection reset');
      }
    }
    const provider = new ThrowingProvider([]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    await session.run('hi');

    const roles = repo.getMessages(chatId).map((m) => m.role);
    expect(roles).toEqual(['user']);

    const endEvent = events.find((e) => e.channel === chatEventEndChannel(streamId));
    expect(endEvent?.payload).toMatchObject({ reason: 'error' });
  });
});

describe('AgentSession — history rebuild', () => {
  it('passes prior persisted messages to the provider', async () => {
    repo.appendMessage(chatId, { role: 'user', content: 'earlier' });
    repo.appendMessage(chatId, { role: 'assistant', content: 'earlier reply' });

    const seenMessageCounts: number[] = [];
    class CountingProvider extends FakeProvider {
      async *chatStream(opts: {
        messages: { role: string }[];
      }): AsyncGenerator<ProviderDelta> {
        seenMessageCounts.push(opts.messages.length);
        yield { type: 'text', text: 'k' };
        yield { type: 'done' };
      }
    }

    const provider = new CountingProvider([]);
    const manager = buildManager(provider);
    const { session } = await manager.start(chatId);
    await session.run('next');

    // system + earlier user + earlier assistant + current user = 4
    expect(seenMessageCounts[0]).toBe(4);
  });
});

describe('AgentSessionManager', () => {
  it('tracks active streams and supports abort/has', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'a' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { streamId } = await manager.start(chatId);
    expect(manager.has(streamId)).toBe(true);
    expect(manager.abort('not-a-real-id')).toBe(false);
  });

  it('deregisters session after run completes', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'a' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    await session.run('hi');
    expect(manager.has(streamId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/agent/agent-session.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/agent/agent-session.ts`**

```ts
import type { LLMProvider } from './llm-provider';
import type { ToolDispatcher } from './tool-dispatcher';
import type { AgentEvent, ConversationMessage } from './types';
import { AgentRuntime } from './agent-runtime';
import type {
  AgentRow,
  ChatRow,
  ChatRepository,
  MessageRow,
} from '@main/repos/chat-repository';
import { chatEventChannel, chatEventEndChannel } from '@shared/ipc-channels';

export interface AgentSessionOpts {
  streamId: string;
  agent: AgentRow;
  chat: ChatRow;
  history: ConversationMessage[];
  provider: LLMProvider;
  dispatcher: ToolDispatcher;
  repo: ChatRepository;
  send: (channel: string, payload: unknown) => void;
  onComplete?: () => void;
  toolSpecs: import('./types').ToolSpec[];
}

export class AgentSession {
  private readonly streamId: string;
  private readonly agent: AgentRow;
  private readonly chat: ChatRow;
  private readonly history: ConversationMessage[];
  private readonly provider: LLMProvider;
  private readonly dispatcher: ToolDispatcher;
  private readonly repo: ChatRepository;
  private readonly send: (channel: string, payload: unknown) => void;
  private readonly toolSpecs: import('./types').ToolSpec[];
  private readonly onComplete?: () => void;
  private readonly abortController = new AbortController();

  constructor(opts: AgentSessionOpts) {
    this.streamId = opts.streamId;
    this.agent = opts.agent;
    this.chat = opts.chat;
    this.history = opts.history;
    this.provider = opts.provider;
    this.dispatcher = opts.dispatcher;
    this.repo = opts.repo;
    this.send = opts.send;
    this.toolSpecs = opts.toolSpecs;
    if (opts.onComplete) this.onComplete = opts.onComplete;
  }

  abort(): void {
    this.abortController.abort();
  }

  async run(userText: string): Promise<void> {
    // Persist user message immediately.
    this.repo.appendMessage(this.chat.id, { role: 'user', content: userText });

    // Build runtime with full history including the new user message? No — runtime
    // owns its own history copy. We pass prior messages as `history` and the new
    // user text via `runtime.send(userText)`.
    const runtime = new AgentRuntime({
      provider: this.provider,
      model: this.agent.model,
      systemPrompt: this.agent.systemPrompt,
      tools: this.toolSpecs,
      dispatcher: this.dispatcher,
      history: this.history,
    });

    // Buffer state — clean state machine:
    // currentAssistant accumulates text-deltas + tool-call events for the
    // active assistant turn. The first tool-result event flushes the
    // current assistant entry (with its toolCalls) and starts emitting
    // tool entries. A new text-delta after a tool-result starts a fresh
    // assistant entry.
    interface PendingAssistant {
      kind: 'assistant';
      content: string;
      toolCalls: import('./types').ToolCall[];
    }
    interface PendingTool {
      kind: 'tool';
      content: string;
      toolCallId: string;
      toolName: string;
    }
    type Pending = PendingAssistant | PendingTool;

    const persisted: Pending[] = [];
    let currentAssistant: PendingAssistant | null = null;
    let lastReason: string = 'end';

    const closeAssistant = (): void => {
      if (currentAssistant !== null) {
        persisted.push(currentAssistant);
        currentAssistant = null;
      }
    };

    try {
      for await (const event of runtime.send(userText, this.abortController.signal) as AsyncIterable<AgentEvent>) {
        this.send(chatEventChannel(this.streamId), event);

        switch (event.type) {
          case 'text-delta':
            if (currentAssistant === null) {
              currentAssistant = { kind: 'assistant', content: '', toolCalls: [] };
            }
            currentAssistant.content += event.text;
            break;
          case 'tool-call':
            if (currentAssistant === null) {
              currentAssistant = { kind: 'assistant', content: '', toolCalls: [] };
            }
            currentAssistant.toolCalls.push(event.call);
            break;
          case 'tool-result':
            // First tool-result for this batch flushes the assistant entry
            // (it owns the matching toolCalls).
            closeAssistant();
            persisted.push({
              kind: 'tool',
              content: event.result.content,
              toolCallId: event.result.toolCallId,
              toolName: event.result.toolName,
            });
            break;
          case 'turn-done':
            lastReason = event.reason;
            if (event.reason === 'end' || event.reason === 'max-tools') {
              closeAssistant();
            }
            break;
          case 'token-usage':
          default:
            break;
        }
      }

      if (lastReason === 'end' || lastReason === 'max-tools') {
        for (const p of persisted) {
          if (p.kind === 'assistant') {
            this.repo.appendMessage(this.chat.id, {
              role: 'assistant',
              content: p.content,
              ...(p.toolCalls.length > 0 ? { toolCalls: p.toolCalls } : {}),
            });
          } else {
            this.repo.appendMessage(this.chat.id, {
              role: 'tool',
              content: p.content,
              toolCallId: p.toolCallId,
              toolName: p.toolName,
            });
          }
        }
      }
      this.send(chatEventEndChannel(this.streamId), { reason: lastReason });
    } finally {
      this.onComplete?.();
    }
  }
}
```

- [ ] **Step 4: Write `src/main/agent/agent-session-manager.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { LLMProvider } from './llm-provider';
import type { ToolDispatcher } from './tool-dispatcher';
import type { ChatRepository } from '@main/repos/chat-repository';
import { AgentSession } from './agent-session';
import { FILE_TOOL_SPECS } from './tool-specs';

export interface AgentSessionManagerOpts {
  provider: LLMProvider;
  repo: ChatRepository;
  dispatcherFactory: (workspacePath: string) => ToolDispatcher;
  send: (channel: string, payload: unknown) => void;
}

export class AgentSessionManager {
  private readonly active = new Map<string, AgentSession>();

  constructor(private readonly opts: AgentSessionManagerOpts) {}

  async start(chatId: string): Promise<{ streamId: string; session: AgentSession }> {
    const chat = this.opts.repo.getChat(chatId);
    if (!chat) throw new Error(`unknown chat: ${chatId}`);
    const agent = this.opts.repo.getAgent(chat.agentId);
    if (!agent) throw new Error(`unknown agent: ${chat.agentId}`);

    const history = this.opts.repo.toConversation(this.opts.repo.getMessages(chatId));

    const dispatcher = this.opts.dispatcherFactory(agent.workspacePath);
    const streamId = randomUUID();

    const session = new AgentSession({
      streamId,
      agent,
      chat,
      history,
      provider: this.opts.provider,
      dispatcher,
      repo: this.opts.repo,
      send: this.opts.send,
      toolSpecs: FILE_TOOL_SPECS,
      onComplete: () => {
        this.active.delete(streamId);
      },
    });
    this.active.set(streamId, session);
    return { streamId, session };
  }

  abort(streamId: string): boolean {
    const session = this.active.get(streamId);
    if (!session) return false;
    session.abort();
    return true;
  }

  has(streamId: string): boolean {
    return this.active.has(streamId);
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
npm test -- tests/main/agent/agent-session.test.ts
```

Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/agent-session.ts src/main/agent/agent-session-manager.ts tests/main/agent/agent-session.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): AgentSession + Manager — runtime to IPC + persistence bridge"
```

---

## Task 5: Chat IPC handlers

**Files:**
- Create: `src/main/ipc/handlers/chat.ts`
- Modify: `src/main/ipc/register.ts`

No new test file — handler glue is exercised by Plan C3 manual smoke and by integration tests in Task 4. We keep this task small.

- [ ] **Step 1: Write `src/main/ipc/handlers/chat.ts`**

```ts
import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';

export function registerChatHandlers(deps: {
  repo: ChatRepository;
  manager: AgentSessionManager;
}): void {
  ipcMain.handle(CHANNELS.CHAT_LIST_AGENTS, () => ({
    agents: deps.repo.listAgents(),
  }));

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
    void session.run(text);
    return { streamId };
  });

  ipcMain.handle(CHANNELS.CHAT_ABORT, (_e, raw) => {
    const { streamId } = schemas.chatAbortRequest.parse(raw);
    return { ok: deps.manager.abort(streamId) };
  });
}
```

- [ ] **Step 2: Modify `src/main/ipc/register.ts`** — accept new deps and register chat handlers

Replace contents with:

```ts
import type { SettingsService } from '@main/services/settings-service';
import type { OllamaClient } from '@main/services/ollama-client';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';
import { registerSettingsHandlers } from './handlers/settings';
import { registerOllamaHandlers } from './handlers/ollama';
import { registerChatHandlers } from './handlers/chat';

export function registerIpcHandlers(deps: {
  settings: SettingsService;
  ollama: OllamaClient;
  repo: ChatRepository;
  manager: AgentSessionManager;
}): void {
  registerSettingsHandlers(deps.settings);
  registerOllamaHandlers(deps.ollama);
  registerChatHandlers({ repo: deps.repo, manager: deps.manager });
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p tsconfig.node.json --noEmit
```

Expected: errors, because `main/index.ts` doesn't yet pass `repo` and `manager` to `registerIpcHandlers`. Task 6 fixes that. We commit anyway because typecheck only fails at the call site, which is updated in the next task.

Actually — to avoid committing a broken main, do Task 5 + 6 in a SINGLE commit. Skip Step 3's typecheck failure, proceed to Task 6, then commit both at the end of Task 6.

- [ ] **Step 4: Stage but don't commit yet**

```bash
git add src/main/ipc/handlers/chat.ts src/main/ipc/register.ts
# do NOT commit — Task 6 finishes the wiring then commits as a unit
```

---

## Task 6: main/index.ts wiring (combined commit with Task 5)

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace `src/main/index.ts`** — wire repo, manager, helper workspace path

```ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { Database as DB } from 'better-sqlite3';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, setHelperWorkspace } from './db/database';
import { databasePath, defaultWorkspacesDir } from './paths';
import { SettingsService } from './services/settings-service';
import { OllamaClient } from './services/ollama-client';
import { OllamaProvider } from './agent/ollama-provider';
import { ChatRepository } from './repos/chat-repository';
import { AgentSessionManager } from './agent/agent-session-manager';
import { ToolDispatcher } from './agent/tool-dispatcher';
import { FileTools } from './tools';
import { registerIpcHandlers } from './ipc/register';

const here = fileURLToPath(new URL('.', import.meta.url));

let db: DB | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1f1e1d',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(here, '../renderer/index.html'));
  }
  return win;
}

function showFatalDialog(title: string, message: string): void {
  dialog.showErrorBox(title, message);
}

app.whenReady().then(async () => {
  try {
    db = openDatabase(databasePath());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showFatalDialog(
      'Flowstate failed to open its database',
      `${msg}\n\nDatabase path: ${databasePath()}\n\n` +
        'You can try deleting the file to reset Flowstate, or check folder permissions.',
    );
    app.quit();
    return;
  }

  const settings = new SettingsService(db);

  if (settings.get('workspaces_dir') === null) {
    settings.set('workspaces_dir', defaultWorkspacesDir());
  }

  const workspacesDir = settings.get('workspaces_dir')!;
  const helperPath = join(workspacesDir, 'code-helper');
  try {
    await mkdir(helperPath, { recursive: true });
  } catch {
    // best-effort; the agent will fail later with a clear error if the dir is unusable
  }
  setHelperWorkspace(db, helperPath);

  const ollamaHost = settings.get('ollama_host') ?? 'http://localhost:11434';
  const ollamaClient = new OllamaClient(ollamaHost);
  const provider = new OllamaProvider(ollamaHost);

  const repo = new ChatRepository(db);

  const dispatcherFactory = (workspacePath: string) => {
    return new ToolDispatcher(new FileTools(workspacePath));
  };

  const send = (channel: string, payload: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send(channel, payload);
  };

  const manager = new AgentSessionManager({
    provider,
    repo,
    dispatcherFactory,
    send,
  });

  registerIpcHandlers({ settings, ollama: ollamaClient, repo, manager });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ipcMain.removeAllListeners();
  if (db) {
    try {
      db.close();
    } catch {
      // best-effort
    }
    db = null;
  }
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.node.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: ~145 tests, all green.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit Tasks 5 + 6 together**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/index.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(main): wire ChatRepository, OllamaProvider, AgentSessionManager, chat IPC"
```

(`src/main/ipc/handlers/chat.ts` and `src/main/ipc/register.ts` were staged in Task 5 Step 4. The commit covers all three files.)

---

## Task 7: Full suite + tag plan-c2-persistence-ipc

**Files:** `README.md` only

- [ ] **Step 1: Run all tests + typecheck**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test && npm run typecheck && npm run build
```

Expected: ~145 tests green, typecheck clean, build clean.

- [ ] **Step 2: Update README status**

In `README.md`, replace the line `⏳ Plan C2 — Persistence + IPC streaming` with:

```markdown
- ✅ Plan C2 — Persistence + IPC streaming (ChatRepository, AgentSession, chat IPC channels)
```

- [ ] **Step 3: Commit + tag**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add README.md
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "docs: mark Plan C2 complete in README"
git tag plan-c2-persistence-ipc
```

---

## Done Criteria

- 4 new test files green: `migration-002`, `chat-repository`, `agent-session`, plus appended `ipc-channels` cases.
- `npm test` reports ~145 tests total.
- `npm run typecheck` clean.
- `npm run build` succeeds.
- `git tag plan-c2-persistence-ipc` exists.
- One Code Helper agent in DB at app start, workspace path set to `<workspaces_dir>/code-helper`.

---

## Out of Scope (Plan C3)

- Renderer chat UI — C3.
- Real Ollama smoke test (manual) — C3.
- Streaming throttle / batching — C3 (renderer-side).
- Multi-agent CRUD (Plan D), shell tool (Plan E), orchestrator (Plan F), polish (Plan G).
- Refactor merging `OllamaClient` (health) and `OllamaProvider` (chat) into one — future cleanup.
