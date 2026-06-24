# Flowstate — Plan D: Multi-Agent + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-agent CRUD, a Dashboard grid screen, and live streaming-status indicators so users can create/edit/delete agents and see them all at a glance.

**Architecture:** Schema migration 003 adds `description`, `specialty_tags`, `avatar_color` columns to `agents`. New IPC channels for agent CRUD + a `chat:active-streams` broadcast for live status. Renderer adds a Dashboard screen + reusable `AgentFormModal` + delete confirm modal. Default view becomes Dashboard once 2+ agents exist.

**Tech Stack:** Existing — better-sqlite3, zod, React 18, Tailwind, Framer Motion. **No new npm deps.**

**Demo target:** Create 2 new agents via UI, see them on Dashboard, chat with each in parallel, edit and delete, persist across reloads.

---

## File Structure

```
src/main/db/migrations/
└── 003_agent_metadata.sql                # NEW

src/main/db/database.ts                    # KEEP (already auto-loads new migration)

src/main/repos/
└── chat-repository.ts                    # MODIFY — createAgent/updateAgent/deleteAgent + new fields in mappers

src/main/agent/
├── agent-session-manager.ts              # MODIFY — emit active-streams broadcast events

src/main/ipc/
├── handlers/chat.ts                      # MODIFY — agent CRUD + list-models handlers
└── register.ts                           # KEEP

src/main/util/
└── agent-id.ts                           # NEW — generateAgentId(name) helper

src/shared/
├── chat-types.ts                         # MODIFY — extend AgentDto
├── ipc-channels.ts                       # MODIFY — add CHAT_CREATE_AGENT, CHAT_UPDATE_AGENT, CHAT_DELETE_AGENT, CHAT_LIST_MODELS, CHAT_ACTIVE_STREAMS_CHANNEL
└── agent-form-schema.ts                  # NEW — zod schema shared by renderer form + main handler

src/preload/index.ts                      # MODIFY — expose new chat methods + subscribeToActiveStreams

src/renderer/src/
├── lib/ipc.ts                            # MODIFY — declare new chat methods
├── App.tsx                               # MODIFY — default view, "+ Add agent" button, reload agents on CRUD
├── chat/
│   ├── useAgentLiveStatus.ts             # NEW
│   └── AgentFormModal.tsx                # NEW
├── chat/DeleteAgentModal.tsx             # NEW
├── screens/
│   └── Dashboard.tsx                     # NEW

tests/main/db/
└── migration-003.test.ts                 # NEW

tests/main/repos/
└── chat-repository.test.ts               # MODIFY — append agent CRUD tests

tests/main/util/
└── agent-id.test.ts                      # NEW

tests/main/agent/
└── agent-session-manager-broadcast.test.ts # NEW

tests/shared/
└── ipc-channels.test.ts                  # MODIFY — append new channel cases
```

---

## Conventions

- Git author flags: `git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit ...`
- Node 22 PATH on every shell command:

  ```bash
  export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH"
  ```
- TS strict, ESM, Conventional Commits.

---

## Task 1: Migration 003 + ChatRepository field mappers

**Files:**
- Create: `src/main/db/migrations/003_agent_metadata.sql`
- Modify: `src/main/db/database.ts`
- Modify: `src/main/repos/chat-repository.ts`
- Modify: `src/shared/chat-types.ts`
- Test: `tests/main/db/migration-003.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/db/migration-003.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-mig3-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 003 — agent metadata', () => {
  it('adds description/specialty_tags/avatar_color columns', () => {
    const db = openDatabase(dbPath);
    const cols = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'description',
        'specialty_tags',
        'avatar_color',
      ]),
    );
    db.close();
  });

  it('records schema_version 3', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBe(3);
    db.close();
  });

  it('backfills Code Helper description and specialty_tags', () => {
    const db = openDatabase(dbPath);
    const row = db
      .prepare(
        "SELECT description, specialty_tags, avatar_color FROM agents WHERE id = 'agent-code-helper'",
      )
      .get() as { description: string; specialty_tags: string; avatar_color: string };
    expect(row.description.length).toBeGreaterThan(0);
    expect(JSON.parse(row.specialty_tags)).toEqual(expect.arrayContaining(['coding']));
    expect(row.avatar_color).toMatch(/^#[0-9a-f]{6}$/i);
    db.close();
  });

  it('does not re-backfill on reopen', () => {
    let db = openDatabase(dbPath);
    db.prepare(
      "UPDATE agents SET description = 'custom' WHERE id = 'agent-code-helper'",
    ).run();
    db.close();
    db = openDatabase(dbPath);
    const row = db
      .prepare("SELECT description FROM agents WHERE id = 'agent-code-helper'")
      .get() as { description: string };
    expect(row.description).toBe('custom');
    db.close();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test -- tests/main/db/migration-003.test.ts
```

Expected: failures (migration 003 absent, schema_version still 2).

- [ ] **Step 3: Write `src/main/db/migrations/003_agent_metadata.sql`**

```sql
ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN specialty_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#d97757';

UPDATE agents
SET
  description = 'A focused coding assistant with file tools.',
  specialty_tags = '["coding","files"]'
WHERE id = 'agent-code-helper' AND description = '';
```

- [ ] **Step 4: Modify `src/main/db/database.ts`** — register migration 003

Read current file. Add the import and append to MIGRATIONS array:

```ts
import migration003 from './migrations/003_agent_metadata.sql?raw';

const MIGRATIONS: Migration[] = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 },
  { version: 3, sql: migration003 },
];
```

- [ ] **Step 5: Modify `src/shared/chat-types.ts`** — extend AgentDto

```ts
export interface AgentDto {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
  avatarColor: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
}
```

(Existing fields kept; three new fields added in correct order.)

- [ ] **Step 6: Modify `src/main/repos/chat-repository.ts`** — extend AgentDbRow + toAgent

Replace the `AgentDbRow` interface and `toAgent` function:

```ts
interface AgentDbRow {
  id: string;
  name: string;
  description: string;
  specialty_tags: string;
  avatar_color: string;
  system_prompt: string;
  model: string;
  workspace_path: string;
  created_at: number;
  updated_at: number;
}

function toAgent(r: AgentDbRow): AgentRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    specialtyTags: JSON.parse(r.specialty_tags) as string[],
    avatarColor: r.avatar_color,
    systemPrompt: r.system_prompt,
    model: r.model,
    workspacePath: r.workspace_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

(`AgentRow` is already aliased to `AgentDto`, so its shape inherits the new fields automatically.)

- [ ] **Step 7: Run tests, verify pass**

```bash
npm test -- tests/main/db/migration-003.test.ts
```

Expected: 4 passed.

- [ ] **Step 8: Run full suite to ensure no regressions**

```bash
npm test
```

Expected: prior 154 + 4 new = 158, all green. (The integration smoke may still pass or skip depending on Ollama availability.)

- [ ] **Step 9: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/db/migrations/003_agent_metadata.sql src/main/db/database.ts src/main/repos/chat-repository.ts src/shared/chat-types.ts tests/main/db/migration-003.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(db): migration 003 adds description/tags/avatar_color, backfills Code Helper"
```

---

## Task 2: Agent ID generator helper

**Files:**
- Create: `src/main/util/agent-id.ts`
- Test: `tests/main/util/agent-id.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/util/agent-id.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateAgentId } from '@main/util/agent-id';

describe('generateAgentId', () => {
  it('produces a slug with a uuid suffix', () => {
    const id = generateAgentId('Code Helper');
    expect(id).toMatch(/^code-helper-[0-9a-f]{8}$/);
  });

  it('lowercases and replaces non-alphanumerics with single dash', () => {
    const id = generateAgentId('Researcher: Notes & Synth!');
    expect(id).toMatch(/^researcher-notes-synth-[0-9a-f]{8}$/);
  });

  it('strips leading/trailing dashes', () => {
    const id = generateAgentId('  --  ASCII  --  ');
    expect(id).toMatch(/^ascii-[0-9a-f]{8}$/);
  });

  it('truncates the slug at 24 chars', () => {
    const id = generateAgentId('a'.repeat(60));
    const slug = id.split('-').slice(0, -1).join('-');
    expect(slug.length).toBeLessThanOrEqual(24);
  });

  it('falls back to "agent" when slug is empty', () => {
    const id = generateAgentId('!@#$%');
    expect(id).toMatch(/^agent-[0-9a-f]{8}$/);
  });

  it('returns unique ids across calls', () => {
    const a = generateAgentId('Same Name');
    const b = generateAgentId('Same Name');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/util/agent-id.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/util/agent-id.ts`**

```ts
import { randomUUID } from 'node:crypto';

export function generateAgentId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'agent';
  return `${slug}-${randomUUID().slice(0, 8)}`;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- tests/main/util/agent-id.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/util/agent-id.ts tests/main/util/agent-id.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(main): generateAgentId slug+uuid helper"
```

---

## Task 3: ChatRepository agent CRUD

**Files:**
- Modify: `src/main/repos/chat-repository.ts`
- Modify: `tests/main/repos/chat-repository.test.ts`

- [ ] **Step 1: Append failing tests** to `tests/main/repos/chat-repository.test.ts`

```ts
describe('ChatRepository — agent CRUD', () => {
  it('createAgent persists all fields and returns AgentRow', () => {
    const a = repo.createAgent({
      id: 'researcher-abc12345',
      name: 'Researcher',
      description: 'Synthesizes notes',
      specialtyTags: ['research', 'notes'],
      systemPrompt: 'You research and synthesize.',
      model: 'qwen2.5:7b',
      avatarColor: '#6dbf94',
      workspacePath: '/tmp/ws/researcher',
    });
    expect(a.id).toBe('researcher-abc12345');
    expect(a.name).toBe('Researcher');
    expect(a.description).toBe('Synthesizes notes');
    expect(a.specialtyTags).toEqual(['research', 'notes']);
    expect(a.avatarColor).toBe('#6dbf94');
    expect(a.workspacePath).toBe('/tmp/ws/researcher');
    expect(repo.listAgents()).toHaveLength(2);
  });

  it('updateAgent mutates name/description/tags/system_prompt/model/color', () => {
    repo.createAgent({
      id: 'researcher-abc12345',
      name: 'Researcher',
      description: 'old',
      specialtyTags: ['research'],
      systemPrompt: 'old prompt',
      model: 'qwen2.5:7b',
      avatarColor: '#000000',
      workspacePath: '/tmp/ws/researcher',
    });
    const updated = repo.updateAgent('researcher-abc12345', {
      name: 'Researcher 2',
      description: 'new',
      specialtyTags: ['research', 'synthesis'],
      systemPrompt: 'new prompt',
      model: 'llama3.1:8b',
      avatarColor: '#d97757',
    });
    expect(updated.name).toBe('Researcher 2');
    expect(updated.description).toBe('new');
    expect(updated.specialtyTags).toEqual(['research', 'synthesis']);
    expect(updated.systemPrompt).toBe('new prompt');
    expect(updated.model).toBe('llama3.1:8b');
    expect(updated.avatarColor).toBe('#d97757');
    // workspace_path unchanged
    expect(updated.workspacePath).toBe('/tmp/ws/researcher');
  });

  it('updateAgent throws on unknown id', () => {
    expect(() =>
      repo.updateAgent('nope', {
        name: 'x',
        description: '',
        specialtyTags: [],
        systemPrompt: 'p',
        model: 'm',
        avatarColor: '#ffffff',
      }),
    ).toThrow();
  });

  it('deleteAgent removes the row and cascades chats/messages', () => {
    const a = repo.createAgent({
      id: 'temp-12345678',
      name: 'Temp',
      description: '',
      specialtyTags: [],
      systemPrompt: 'p',
      model: 'm',
      avatarColor: '#000000',
      workspacePath: '/tmp/ws/temp',
    });
    const c = repo.createChat(a.id);
    repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    repo.deleteAgent(a.id);
    expect(repo.getAgent(a.id)).toBeNull();
    expect(repo.listChats(a.id)).toEqual([]);
    expect(repo.getMessages(c.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/main/repos/chat-repository.test.ts
```

Expected: methods undefined.

- [ ] **Step 3: Add CRUD methods to `src/main/repos/chat-repository.ts`**

Inside the class, add:

```ts
  createAgent(input: CreateAgentInput): AgentRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO agents
          (id, name, description, specialty_tags, avatar_color, system_prompt, model, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.description,
        JSON.stringify(input.specialtyTags),
        input.avatarColor,
        input.systemPrompt,
        input.model,
        input.workspacePath,
        now,
        now,
      );
    const row = this.getAgent(input.id);
    if (!row) throw new Error(`createAgent: failed to read back ${input.id}`);
    return row;
  }

  updateAgent(id: string, input: UpdateAgentInput): AgentRow {
    const existing = this.getAgent(id);
    if (!existing) throw new Error(`updateAgent: unknown agent ${id}`);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE agents
           SET name = ?,
               description = ?,
               specialty_tags = ?,
               avatar_color = ?,
               system_prompt = ?,
               model = ?,
               updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.description,
        JSON.stringify(input.specialtyTags),
        input.avatarColor,
        input.systemPrompt,
        input.model,
        now,
        id,
      );
    const row = this.getAgent(id);
    if (!row) throw new Error(`updateAgent: agent ${id} disappeared`);
    return row;
  }

  deleteAgent(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }
```

Add the input types near the top of the file (next to existing exports):

```ts
export interface CreateAgentInput {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
  avatarColor: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
}

export type UpdateAgentInput = Omit<CreateAgentInput, 'id' | 'workspacePath'>;
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/main/repos/chat-repository.test.ts
```

Expected: prior 18 + 4 new = 22 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/repos/chat-repository.ts tests/main/repos/chat-repository.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(repos): ChatRepository.createAgent / updateAgent / deleteAgent"
```

---

## Task 4: Shared form schema + IPC channels

**Files:**
- Create: `src/shared/agent-form-schema.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `tests/shared/ipc-channels.test.ts`

- [ ] **Step 1: Write `src/shared/agent-form-schema.ts`**

```ts
import { z } from 'zod';

export const agentFormSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200),
  specialtyTags: z.array(z.string().min(1).max(40)).max(10),
  systemPrompt: z.string().min(1).max(4000),
  model: z.string().min(1),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;

export const AVATAR_COLORS = [
  '#d97757', // orange
  '#5b8def', // blue
  '#6dbf94', // green
  '#a973d4', // purple
  '#d96e6e', // red
  '#9ca3af', // gray
] as const;
```

- [ ] **Step 2: Append failing tests to `tests/shared/ipc-channels.test.ts`**

```ts
describe('agent CRUD channels', () => {
  it('declares the new channels', () => {
    expect(CHANNELS.CHAT_CREATE_AGENT).toBe('chat:create-agent');
    expect(CHANNELS.CHAT_UPDATE_AGENT).toBe('chat:update-agent');
    expect(CHANNELS.CHAT_DELETE_AGENT).toBe('chat:delete-agent');
    expect(CHANNELS.CHAT_LIST_MODELS).toBe('chat:list-models');
    expect(CHANNELS.CHAT_ACTIVE_STREAMS).toBe('chat:active-streams');
  });

  it('chat:create-agent rejects empty name', () => {
    const r = schemas.chatCreateAgentRequest.safeParse({
      name: '',
      description: '',
      specialtyTags: [],
      systemPrompt: 'p',
      model: 'm',
      avatarColor: '#d97757',
    });
    expect(r.success).toBe(false);
  });

  it('chat:create-agent accepts a valid payload', () => {
    const r = schemas.chatCreateAgentRequest.safeParse({
      name: 'Researcher',
      description: 'Notes',
      specialtyTags: ['research'],
      systemPrompt: 'You research things.',
      model: 'qwen2.5:7b',
      avatarColor: '#6dbf94',
    });
    expect(r.success).toBe(true);
  });

  it('chat:update-agent requires id', () => {
    expect(
      schemas.chatUpdateAgentRequest.safeParse({
        name: 'x',
        description: '',
        specialtyTags: [],
        systemPrompt: 'p',
        model: 'm',
        avatarColor: '#d97757',
      }).success,
    ).toBe(false);
  });

  it('chat:delete-agent rejects empty id', () => {
    expect(schemas.chatDeleteAgentRequest.safeParse({ id: '' }).success).toBe(false);
    expect(schemas.chatDeleteAgentRequest.safeParse({ id: 'a1' }).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- tests/shared/ipc-channels.test.ts
```

Expected: failures.

- [ ] **Step 4: Modify `src/shared/ipc-channels.ts`** — add channel constants + schemas + types

Read the file. In `CHANNELS`, append:

```ts
  CHAT_CREATE_AGENT: 'chat:create-agent',
  CHAT_UPDATE_AGENT: 'chat:update-agent',
  CHAT_DELETE_AGENT: 'chat:delete-agent',
  CHAT_LIST_MODELS: 'chat:list-models',
  CHAT_ACTIVE_STREAMS: 'chat:active-streams',
```

After the existing `agentDtoSchema` constant, replace it (or update in place) with:

```ts
const agentDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  specialtyTags: z.array(z.string()),
  avatarColor: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  workspacePath: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

In the `schemas` object, add:

```ts
  chatCreateAgentRequest: z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(200),
    specialtyTags: z.array(z.string()).max(10),
    systemPrompt: z.string().min(1).max(4000),
    model: z.string().min(1),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  chatCreateAgentResponse: z.object({ agent: agentDtoSchema }),

  chatUpdateAgentRequest: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    description: z.string().max(200),
    specialtyTags: z.array(z.string()).max(10),
    systemPrompt: z.string().min(1).max(4000),
    model: z.string().min(1),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  chatUpdateAgentResponse: z.object({ agent: agentDtoSchema }),

  chatDeleteAgentRequest: z.object({ id: z.string().min(1) }),
  chatDeleteAgentResponse: z.object({ ok: z.boolean() }),

  chatListModelsRequest: z.object({}),
  chatListModelsResponse: z.object({
    models: z.array(z.object({ name: z.string(), size: z.number().optional() })),
  }),
```

After the existing inferred types, add:

```ts
export type ChatCreateAgentRequest = z.infer<typeof schemas.chatCreateAgentRequest>;
export type ChatCreateAgentResponse = z.infer<typeof schemas.chatCreateAgentResponse>;
export type ChatUpdateAgentRequest = z.infer<typeof schemas.chatUpdateAgentRequest>;
export type ChatUpdateAgentResponse = z.infer<typeof schemas.chatUpdateAgentResponse>;
export type ChatDeleteAgentRequest = z.infer<typeof schemas.chatDeleteAgentRequest>;
export type ChatDeleteAgentResponse = z.infer<typeof schemas.chatDeleteAgentResponse>;
export type ChatListModelsResponse = z.infer<typeof schemas.chatListModelsResponse>;

export interface ActiveStreamEntry {
  streamId: string;
  agentId: string;
  chatId: string;
}

export interface ActiveStreamsBroadcast {
  active: ActiveStreamEntry[];
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
npm test -- tests/shared/ipc-channels.test.ts
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/shared/agent-form-schema.ts src/shared/ipc-channels.ts tests/shared/ipc-channels.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(shared): agent CRUD channels, schemas, form schema with avatar palette"
```

---

## Task 5: AgentSessionManager broadcast

**Files:**
- Modify: `src/main/agent/agent-session-manager.ts`
- Test: `tests/main/agent/agent-session-manager-broadcast.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/agent/agent-session-manager-broadcast.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import { FileTools } from '@main/tools';
import { ToolDispatcher } from '@main/agent/tool-dispatcher';
import { FakeProvider } from '@main/agent/fake-provider';
import { AgentSessionManager } from '@main/agent/agent-session-manager';
import { CHANNELS } from '@shared/ipc-channels';

let dir: string;
let db: Database;
let repo: ChatRepository;
let chatId: string;
let events: Array<{ channel: string; payload: unknown }>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-broadcast-'));
  const ws = join(dir, 'ws');
  mkdirSync(ws, { recursive: true });
  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, ws);
  repo = new ChatRepository(db);
  const c = repo.createChat('agent-code-helper');
  chatId = c.id;
  events = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('AgentSessionManager broadcasts active streams', () => {
  it('emits chat:active-streams on start and on completion', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'hi' },
      { type: 'done' },
    ]);
    const manager = new AgentSessionManager({
      provider,
      repo,
      dispatcherFactory: (path) => new ToolDispatcher(new FileTools(path)),
      send: (channel, payload) => events.push({ channel, payload }),
    });
    const { session } = await manager.start(chatId);
    await session.run('hello');

    const broadcasts = events.filter((e) => e.channel === CHANNELS.CHAT_ACTIVE_STREAMS);
    expect(broadcasts.length).toBeGreaterThanOrEqual(2);
    const first = broadcasts[0]!.payload as { active: Array<{ agentId: string }> };
    expect(first.active).toHaveLength(1);
    expect(first.active[0]?.agentId).toBe('agent-code-helper');
    const last = broadcasts[broadcasts.length - 1]!.payload as { active: unknown[] };
    expect(last.active).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/main/agent/agent-session-manager-broadcast.test.ts
```

Expected: broadcasts not emitted.

- [ ] **Step 3: Modify `src/main/agent/agent-session-manager.ts`**

Replace contents:

```ts
import { randomUUID } from 'node:crypto';
import type { LLMProvider } from './llm-provider';
import type { ToolDispatcher } from './tool-dispatcher';
import type { ChatRepository } from '@main/repos/chat-repository';
import { AgentSession } from './agent-session';
import { FILE_TOOL_SPECS } from './tool-specs';
import { CHANNELS } from '@shared/ipc-channels';

export interface AgentSessionManagerOpts {
  provider: LLMProvider;
  repo: ChatRepository;
  dispatcherFactory: (workspacePath: string) => ToolDispatcher;
  send: (channel: string, payload: unknown) => void;
}

interface ActiveEntry {
  streamId: string;
  agentId: string;
  chatId: string;
  session: AgentSession;
}

export class AgentSessionManager {
  private readonly active = new Map<string, ActiveEntry>();

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
        this.broadcast();
      },
    });
    this.active.set(streamId, {
      streamId,
      agentId: agent.id,
      chatId: chat.id,
      session,
    });
    this.broadcast();
    return { streamId, session };
  }

  abort(streamId: string): boolean {
    const entry = this.active.get(streamId);
    if (!entry) return false;
    entry.session.abort();
    return true;
  }

  has(streamId: string): boolean {
    return this.active.has(streamId);
  }

  private broadcast(): void {
    const activeList = Array.from(this.active.values()).map((e) => ({
      streamId: e.streamId,
      agentId: e.agentId,
      chatId: e.chatId,
    }));
    this.opts.send(CHANNELS.CHAT_ACTIVE_STREAMS, { active: activeList });
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- tests/main/agent/agent-session-manager-broadcast.test.ts
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/agent-session-manager.ts tests/main/agent/agent-session-manager-broadcast.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): AgentSessionManager broadcasts active streams on start/complete"
```

---

## Task 6: IPC handlers — agent CRUD + list-models

**Files:**
- Modify: `src/main/ipc/handlers/chat.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace `src/main/ipc/handlers/chat.ts`**

```ts
import { ipcMain } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';
import type { LLMProvider } from '@main/agent/llm-provider';
import { generateAgentId } from '@main/util/agent-id';

export interface ChatHandlerDeps {
  repo: ChatRepository;
  manager: AgentSessionManager;
  provider: LLMProvider;
  workspacesDir: string;
}

export function registerChatHandlers(deps: ChatHandlerDeps): void {
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

  ipcMain.handle(CHANNELS.CHAT_LIST_MODELS, async () => {
    try {
      const models = await deps.provider.listModels();
      return { models: models.map((m) => ({ name: m.name, size: m.size })) };
    } catch {
      return { models: [] };
    }
  });

  ipcMain.handle(CHANNELS.CHAT_CREATE_AGENT, async (_e, raw) => {
    const input = schemas.chatCreateAgentRequest.parse(raw);
    const id = generateAgentId(input.name);
    const workspacePath = join(deps.workspacesDir, id);
    await mkdir(workspacePath, { recursive: true });
    const agent = deps.repo.createAgent({
      id,
      name: input.name.trim(),
      description: input.description,
      specialtyTags: input.specialtyTags,
      systemPrompt: input.systemPrompt,
      model: input.model,
      avatarColor: input.avatarColor,
      workspacePath,
    });
    return { agent };
  });

  ipcMain.handle(CHANNELS.CHAT_UPDATE_AGENT, (_e, raw) => {
    const input = schemas.chatUpdateAgentRequest.parse(raw);
    const agent = deps.repo.updateAgent(input.id, {
      name: input.name.trim(),
      description: input.description,
      specialtyTags: input.specialtyTags,
      systemPrompt: input.systemPrompt,
      model: input.model,
      avatarColor: input.avatarColor,
    });
    return { agent };
  });

  ipcMain.handle(CHANNELS.CHAT_DELETE_AGENT, (_e, raw) => {
    const { id } = schemas.chatDeleteAgentRequest.parse(raw);
    deps.repo.deleteAgent(id);
    return { ok: true };
  });
}
```

- [ ] **Step 2: Modify `src/main/index.ts`** — pass new deps

Find the `registerChatHandlers({ repo, manager })` call. Replace with:

```ts
registerChatHandlers({ repo, manager, provider, workspacesDir });
```

The variables already exist locally. Update `register.ts` to forward them:

In `src/main/ipc/register.ts`:

```ts
import type { SettingsService } from '@main/services/settings-service';
import type { OllamaClient } from '@main/services/ollama-client';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';
import type { LLMProvider } from '@main/agent/llm-provider';
import { registerSettingsHandlers } from './handlers/settings';
import { registerOllamaHandlers } from './handlers/ollama';
import { registerChatHandlers } from './handlers/chat';

export function registerIpcHandlers(deps: {
  settings: SettingsService;
  ollama: OllamaClient;
  repo: ChatRepository;
  manager: AgentSessionManager;
  provider: LLMProvider;
  workspacesDir: string;
}): void {
  registerSettingsHandlers(deps.settings);
  registerOllamaHandlers(deps.ollama);
  registerChatHandlers({
    repo: deps.repo,
    manager: deps.manager,
    provider: deps.provider,
    workspacesDir: deps.workspacesDir,
  });
}
```

In `src/main/index.ts`, find the `registerIpcHandlers` call and update to pass the new fields:

```ts
registerIpcHandlers({
  settings,
  ollama: ollamaClient,
  repo,
  manager,
  provider,
  workspacesDir,
});
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p tsconfig.node.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all green (no broken tests; new handlers not yet covered by integration test — that's the manual smoke).

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/ipc/handlers/chat.ts src/main/ipc/register.ts src/main/index.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(main): IPC handlers for agent CRUD + list-models"
```

---

## Task 7: Preload + renderer ipc.ts — chat methods

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/lib/ipc.ts`

- [ ] **Step 1: Replace `src/preload/index.ts`** — add new methods

Find the `chat:` block and append:

```ts
    listModels: (): Promise<ChatListModelsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_MODELS, {}),
    createAgent: (input: ChatCreateAgentRequest): Promise<ChatCreateAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_CREATE_AGENT, input),
    updateAgent: (input: ChatUpdateAgentRequest): Promise<ChatUpdateAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_UPDATE_AGENT, input),
    deleteAgent: (id: string): Promise<ChatDeleteAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_DELETE_AGENT, { id }),
    subscribeToActiveStreams: (
      onUpdate: (payload: ActiveStreamsBroadcast) => void,
    ): (() => void) => {
      const channel = CHANNELS.CHAT_ACTIVE_STREAMS;
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: ActiveStreamsBroadcast,
      ) => onUpdate(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
```

Add the new types to the existing import:

```ts
import type {
  // existing imports...
  ChatListModelsResponse,
  ChatCreateAgentRequest,
  ChatCreateAgentResponse,
  ChatUpdateAgentRequest,
  ChatUpdateAgentResponse,
  ChatDeleteAgentResponse,
  ActiveStreamsBroadcast,
} from '@shared/ipc-channels';
```

- [ ] **Step 2: Modify `src/renderer/src/lib/ipc.ts`** — declare same shape

Replace the `chat:` block of the FlowstateApi interface:

```ts
chat: {
  listAgents: () => Promise<ChatListAgentsResponse>;
  listChats: (agentId: string) => Promise<ChatListChatsResponse>;
  createChat: (agentId: string, title?: string) => Promise<ChatCreateChatResponse>;
  getMessages: (chatId: string) => Promise<ChatGetMessagesResponse>;
  sendMessage: (chatId: string, text: string) => Promise<ChatSendMessageResponse>;
  abort: (streamId: string) => Promise<ChatAbortResponse>;
  subscribeToStream: (
    streamId: string,
    onEvent: (event: unknown) => void,
    onEnd: (payload: { reason: string }) => void,
  ) => () => void;
  listModels: () => Promise<ChatListModelsResponse>;
  createAgent: (input: ChatCreateAgentRequest) => Promise<ChatCreateAgentResponse>;
  updateAgent: (input: ChatUpdateAgentRequest) => Promise<ChatUpdateAgentResponse>;
  deleteAgent: (id: string) => Promise<ChatDeleteAgentResponse>;
  subscribeToActiveStreams: (
    onUpdate: (payload: ActiveStreamsBroadcast) => void,
  ) => () => void;
};
```

Add the new imports:

```ts
import type {
  // existing imports...
  ChatListModelsResponse,
  ChatCreateAgentRequest,
  ChatCreateAgentResponse,
  ChatUpdateAgentRequest,
  ChatUpdateAgentResponse,
  ChatDeleteAgentResponse,
  ActiveStreamsBroadcast,
} from '@shared/ipc-channels';
```

- [ ] **Step 3: Typecheck both projects**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/preload/index.ts src/renderer/src/lib/ipc.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(preload+renderer): expose agent CRUD methods + active-streams subscription"
```

---

## Task 8: useAgentLiveStatus hook

**Files:**
- Create: `src/renderer/src/chat/useAgentLiveStatus.ts`

- [ ] **Step 1: Write `src/renderer/src/chat/useAgentLiveStatus.ts`**

```ts
import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { ActiveStreamsBroadcast } from '@shared/ipc-channels';

export type AgentLiveStatus = 'idle' | 'streaming';

export function useAgentLiveStatus(): Map<string, AgentLiveStatus> {
  const [active, setActive] = useState<ActiveStreamsBroadcast['active']>([]);

  useEffect(() => {
    const unsub = ipc.chat.subscribeToActiveStreams((payload) => {
      setActive(payload.active);
    });
    return unsub;
  }, []);

  const map = new Map<string, AgentLiveStatus>();
  for (const entry of active) {
    map.set(entry.agentId, 'streaming');
  }
  return map;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/chat/useAgentLiveStatus.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): useAgentLiveStatus hook subscribes to active-streams broadcast"
```

---

## Task 9: AgentFormModal + DeleteAgentModal

**Files:**
- Create: `src/renderer/src/chat/AgentFormModal.tsx`
- Create: `src/renderer/src/chat/DeleteAgentModal.tsx`

- [ ] **Step 1: Write `src/renderer/src/chat/AgentFormModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import { agentFormSchema, AVATAR_COLORS, type AgentFormValues } from '@shared/agent-form-schema';
import type { AgentDto } from '@shared/chat-types';

interface Props {
  mode: 'create' | 'edit';
  initial?: AgentDto;
  onClose: () => void;
  onSaved: (agent: AgentDto) => void;
}

const EMPTY: AgentFormValues = {
  name: '',
  description: '',
  specialtyTags: [],
  systemPrompt: 'You are a helpful AI agent. Use the available tools to read, write, and search files inside your workspace.',
  model: '',
  avatarColor: AVATAR_COLORS[0],
};

export function AgentFormModal({ mode, initial, onClose, onSaved }: Props): JSX.Element {
  const [values, setValues] = useState<AgentFormValues>(() =>
    initial
      ? {
          name: initial.name,
          description: initial.description,
          specialtyTags: initial.specialtyTags,
          systemPrompt: initial.systemPrompt,
          model: initial.model,
          avatarColor: initial.avatarColor,
        }
      : EMPTY,
  );
  const [tagsInput, setTagsInput] = useState<string>(values.specialtyTags.join(', '));
  const [models, setModels] = useState<Array<{ name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void ipc.chat.listModels().then((res) => {
      setModels(res.models);
      if (!values.model && res.models.length > 0) {
        setValues((v) => ({ ...v, model: res.models[0]!.name }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof AgentFormValues>(key: K, val: AgentFormValues[K]): void {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function submit(): Promise<void> {
    setError(null);
    const parsed = agentFormSchema.safeParse({
      ...values,
      specialtyTags: tagsInput
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    });
    if (!parsed.success) {
      setError(parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') {
        const { agent } = await ipc.chat.createAgent(parsed.data);
        onSaved(agent);
      } else if (initial) {
        const { agent } = await ipc.chat.updateAgent({ id: initial.id, ...parsed.data });
        onSaved(agent);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[640px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6 space-y-4">
        <h2 className="text-lg font-semibold">{mode === 'create' ? 'New agent' : 'Edit agent'}</h2>

        <Field label="Name">
          <input
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            maxLength={60}
          />
        </Field>

        <Field label="Description">
          <input
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            maxLength={200}
          />
        </Field>

        <Field label="Specialty tags (comma-separated)">
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="frontend, react, typescript"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </Field>

        <Field label="System prompt">
          <textarea
            value={values.systemPrompt}
            onChange={(e) => set('systemPrompt', e.target.value)}
            rows={6}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono"
            maxLength={4000}
          />
        </Field>

        <Field label="Model">
          <select
            value={values.model}
            onChange={(e) => set('model', e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {models.length === 0 ? (
              <option value="">No models pulled</option>
            ) : null}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Avatar color">
          <div className="flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('avatarColor', c)}
                className={`w-7 h-7 rounded-md border-2 transition ${
                  values.avatarColor === c ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Pick ${c}`}
              />
            ))}
          </div>
        </Field>

        {error ? (
          <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-[var(--ink-faint)]">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Write `src/renderer/src/chat/DeleteAgentModal.tsx`**

```tsx
import { useState } from 'react';
import { ipc } from '../lib/ipc';
import type { AgentDto } from '@shared/chat-types';

interface Props {
  agent: AgentDto;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteAgentModal({ agent, onClose, onDeleted }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await ipc.chat.deleteAgent(agent.id);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--bad)]">Delete agent?</h2>
        <p className="text-sm">
          Delete <strong>{agent.name}</strong>? This removes all its chats and messages.
        </p>
        <p className="text-xs text-[var(--ink-faint)]">
          The workspace folder at <code className="kbd">{agent.workspacePath}</code> is preserved.
        </p>
        {error ? (
          <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary bg-[var(--bad)] border-[var(--bad)]"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/chat/AgentFormModal.tsx src/renderer/src/chat/DeleteAgentModal.tsx
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): AgentFormModal + DeleteAgentModal for CRUD"
```

---

## Task 10: Dashboard screen

**Files:**
- Create: `src/renderer/src/screens/Dashboard.tsx`

- [ ] **Step 1: Write `src/renderer/src/screens/Dashboard.tsx`**

```tsx
import { useState } from 'react';
import type { AgentDto } from '@shared/chat-types';
import { AgentFormModal } from '../chat/AgentFormModal';
import { DeleteAgentModal } from '../chat/DeleteAgentModal';
import { useAgentLiveStatus } from '../chat/useAgentLiveStatus';

interface Props {
  agents: AgentDto[];
  onOpenChat: (agent: AgentDto) => void;
  onAgentsChanged: () => void;
}

export function Dashboard({ agents, onOpenChat, onAgentsChanged }: Props): JSX.Element {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AgentDto | null>(null);
  const [deleting, setDeleting] = useState<AgentDto | null>(null);
  const liveStatus = useAgentLiveStatus();
  const activeCount = Array.from(liveStatus.values()).filter((s) => s === 'streaming').length;

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <header className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New agent
        </button>
      </header>
      <p className="text-sm text-[var(--ink-muted)] mb-6">
        {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
        {activeCount > 0 ? ` · ${activeCount} active` : ''}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            streaming={liveStatus.get(a.id) === 'streaming'}
            onOpen={() => onOpenChat(a)}
            onEdit={() => setEditing(a)}
            onDelete={() => setDeleting(a)}
          />
        ))}
      </div>

      {showCreate ? (
        <AgentFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            onAgentsChanged();
            setShowCreate(false);
          }}
        />
      ) : null}
      {editing ? (
        <AgentFormModal
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            onAgentsChanged();
            setEditing(null);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteAgentModal
          agent={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            onAgentsChanged();
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface CardProps {
  agent: AgentDto;
  streaming: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function AgentCard({ agent, streaming, onOpen, onEdit, onDelete }: CardProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="card relative">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#1f1e1d] font-semibold"
          style={{ backgroundColor: agent.avatarColor }}
        >
          {agent.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold truncate">{agent.name}</h3>
          <p className="text-xs text-[var(--ink-muted)] line-clamp-2">
            {agent.description || 'No description'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setMenuOpen((v) => !v)}
          className="btn px-2 text-xs"
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="absolute right-3 top-12 z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-white/5"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              Edit agent
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-[var(--bad)] hover:bg-white/5"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              Delete agent
            </button>
          </div>
        ) : null}
      </div>

      <div className="card-row text-xs flex flex-wrap items-center gap-2">
        <span className="kbd">{agent.model}</span>
        {agent.specialtyTags.slice(0, 3).map((t) => (
          <span key={t} className="text-[var(--ink-faint)]">#{t}</span>
        ))}
      </div>
      <div className="card-row flex items-center justify-between text-xs">
        <span className={streaming ? 'pill pill-good' : 'text-[var(--ink-faint)]'}>
          {streaming ? (
            <>
              <span className="dot dot-good dot-pulse" /> Streaming…
            </>
          ) : (
            'Idle'
          )}
        </span>
        <button type="button" className="btn" onClick={onOpen}>
          Open chat
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/screens/Dashboard.tsx
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): Dashboard screen with agent grid + CRUD modals"
```

---

## Task 11: App.tsx — sidebar add-agent + dashboard view + reload-on-CRUD

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace `src/renderer/src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ipc } from './lib/ipc';
import type { AgentDto } from '@shared/chat-types';
import { Settings } from './screens/Settings';
import { Chat } from './screens/Chat';
import { Dashboard } from './screens/Dashboard';
import { AgentFormModal } from './chat/AgentFormModal';

type View =
  | { kind: 'settings' }
  | { kind: 'dashboard' }
  | { kind: 'chat'; agent: AgentDto };

export function App(): JSX.Element {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [view, setView] = useState<View>({ kind: 'settings' });
  const [showCreate, setShowCreate] = useState(false);

  const refreshAgents = useCallback(async () => {
    const { agents } = await ipc.chat.listAgents();
    setAgents(agents);
    return agents;
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await refreshAgents();
      // Default view: Dashboard if 2+ agents, otherwise the only agent's chat
      if (list.length >= 2) {
        setView({ kind: 'dashboard' });
      } else if (list.length === 1) {
        setView({ kind: 'chat', agent: list[0]! });
      } else {
        setView({ kind: 'settings' });
      }
    })();
  }, [refreshAgents]);

  return (
    <div className="flex h-full">
      <aside className="w-[256px] border-r border-[var(--border)] flex flex-col">
        <header className="px-4 py-4 flex items-center gap-3 border-b border-[var(--border)]">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center text-[#1f1e1d] font-semibold text-sm">
            F
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">Flowstate</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-1">Local AI agents</div>
          </div>
        </header>

        <button
          type="button"
          onClick={() => setView({ kind: 'dashboard' })}
          className={`flex items-center px-4 py-2 text-left text-sm border-l-2 transition ${
            view.kind === 'dashboard'
              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
              : 'border-transparent hover:bg-white/5'
          }`}
        >
          ◇ Dashboard
        </button>

        <div className="px-4 pt-3 pb-2 text-xs uppercase tracking-wider text-[var(--ink-faint)]">
          Agents
        </div>
        <nav className="flex-1 overflow-y-auto">
          {agents.map((a) => {
            const active = view.kind === 'chat' && view.agent.id === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setView({ kind: 'chat', agent: a })}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm border-l-2 transition ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-transparent hover:bg-white/5'
                }`}
              >
                <div
                  className="w-6 h-6 rounded flex items-center justify-center text-xs font-semibold text-[#1f1e1d]"
                  style={{ backgroundColor: a.avatarColor }}
                >
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="truncate">{a.name}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex w-full items-center px-4 py-2 text-left text-sm text-[var(--ink-faint)] hover:bg-white/5"
          >
            + Add agent
          </button>
        </nav>

        <div className="border-t border-[var(--border)] py-2">
          <button
            type="button"
            onClick={() => setView({ kind: 'settings' })}
            className={`flex w-full items-center px-4 py-2 text-left text-sm border-l-2 transition ${
              view.kind === 'settings'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-transparent hover:bg-white/5'
            }`}
          >
            Settings
          </button>
          <div className="px-4 pt-2 pb-1 text-[11px] text-[var(--ink-faint)]">
            v0.0.1 · foundation
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {view.kind === 'settings' ? (
          <div className="h-full overflow-y-auto px-8 py-8">
            <div className="max-w-2xl mb-8">
              <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
              <p className="text-sm text-[var(--ink-muted)] mt-1">
                Verify your local environment is ready before chatting.
              </p>
            </div>
            <div className="max-w-2xl">
              <Settings />
            </div>
          </div>
        ) : view.kind === 'dashboard' ? (
          <Dashboard
            agents={agents}
            onOpenChat={(agent) => setView({ kind: 'chat', agent })}
            onAgentsChanged={() => void refreshAgents()}
          />
        ) : (
          <Chat agent={view.agent} />
        )}
      </main>

      {showCreate ? (
        <AgentFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={async (agent) => {
            await refreshAgents();
            setShowCreate(false);
            setView({ kind: 'chat', agent });
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck both projects**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build to verify renderer bundles**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/App.tsx
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): App shell adds Dashboard view and Add-agent modal trigger"
```

---

## Task 12: Manual smoke test (USER-DRIVEN)

**Files:** none modified.

- [ ] **Step 1: Run dev**

```bash
npm run dev
```

In PowerShell with Node 22 active.

- [ ] **Step 2: Verify migration 003 applied**

Open DevTools (Ctrl+Shift+I) → Console → run:

```js
await window.flowstate.chat.listAgents()
```

Expected: returns the Code Helper agent with `description`, `specialtyTags`, `avatarColor` fields populated.

- [ ] **Step 3: Manual checks** (have user perform):

1. Sidebar shows Code Helper with its avatar color (orange).
2. Click "+ Add agent" in sidebar → modal opens.
3. Fill: Name "Researcher", Description "Synthesizes notes", tags "research, notes", system prompt "You research and synthesize.", model `qwen2.5-coder:7b` (or whatever's installed), color green.
4. Click Create. Modal closes. App switches to Researcher chat. Sidebar lists 2 agents.
5. Click Dashboard in sidebar. Both agents visible as cards with correct colors.
6. Open Researcher → chat. Send "List the workspace files."
7. While streaming, switch to Dashboard. Researcher card shows "Streaming…" pill. Code Helper shows "Idle".
8. Click Code Helper card → opens its chat. Send a different message. Both stream concurrently.
9. Back to Dashboard → both pills show "Streaming…".
10. After streams end, both pills back to "Idle".
11. Click ⋯ on Researcher card → Edit agent. Change description. Save. Card description updates.
12. Click ⋯ → Delete agent. Confirm modal shows correct path. Confirm delete. Card disappears.
13. Reload (Ctrl+R). State persists. Researcher gone, Code Helper remains.

- [ ] **Step 4: Report**

Reply: `smoke ok` / `smoke broke: <specific failure>` / screenshot.

- [ ] **Step 5: No commit for this task.**

---

## Task 13: Tag plan-d-multi-agent

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all tests + typecheck + build**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test && npm run typecheck && npm run build
```

Expected: all green. Test count ≈ 165 (155 prior + 4 mig003 + 6 agent-id + 4 chat-repo + 1 broadcast).

- [ ] **Step 2: Update README status**

Replace `⏳ Plan D — Multi-agent + dashboard` with:

```markdown
- ✅ Plan D — Multi-agent + dashboard (agent CRUD, dashboard grid, live status)
```

- [ ] **Step 3: Commit + tag**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add README.md
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "docs: mark Plan D complete in README"
git tag plan-d-multi-agent
```

---

## Done Criteria

- All new files exist per file structure.
- `npm run typecheck` clean.
- `npm run build` succeeds.
- `npm test` reports ~165 tests green.
- Manual smoke test passes: create / edit / delete agents; dashboard grid; concurrent streams; live status pills.
- `git tag plan-d-multi-agent` exists.

---

## Out of Scope (Plans E / F / G)

- Tool permissions per agent + approval policy preset (cautious/trusting/yolo) — Plan E.
- Shell tool + approval modal — Plan E.
- Orchestrator routing ("Ask anything" global input) — Plan F.
- Workspace folder rebind, "Open in VS Code" — Plan G.
- Renderer unit tests — Plan G.
- Agent presets library / import-export — Plan G.
