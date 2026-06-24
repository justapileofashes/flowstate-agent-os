# Flowstate — Plan E: Shell Tool + Approval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `run_shell` tool and a per-command approval gate so agents can run real commands inside their workspace, with three policies (cautious / trusting / yolo) and a UI modal that pauses execution mid-stream.

**Architecture:** Migration 004 adds `tool_perms` and `approval_policy` to agents. New `ShellTool` uses `child_process.spawn` (no `shell:true`) parsed via `shell-quote`. New `ApprovalGate` pauses tool dispatch by emitting an `AgentEvent`, awaiting an IPC response. Renderer shows an approval modal during the wait.

**Tech Stack:** Adds `shell-quote@^1.8` (single small dep). All else existing.

**Demo target:** Agent with shell enabled successfully runs `node --version` after user clicks Allow once.

---

## File Structure

```
src/main/db/migrations/
└── 004_agent_tool_perms.sql                  # NEW

src/main/db/database.ts                       # KEEP (auto-loads new migration)
src/main/repos/chat-repository.ts             # MODIFY — extend AgentDbRow + toAgent + create/update inputs

src/main/tools/
├── shell-tool.ts                             # NEW — runShell()
└── index.ts                                  # MODIFY — export runShell, helper getToolSpecsForAgent

src/main/agent/
├── approval-gate.ts                          # NEW
├── tool-specs.ts                             # MODIFY — export SHELL_TOOL_SPEC + getToolSpecsForAgent
├── tool-dispatcher.ts                        # MODIFY — accept approvalGate + run_shell case
├── agent-session.ts                          # MODIFY — pass agent into dispatcher path; pass-through 'tool-approval-required' / 'tool-approval-resolved' events to send
├── agent-session-manager.ts                  # MODIFY — resolveApproval method
└── types.ts                                  # MODIFY — add new AgentEvent variants

src/main/ipc/handlers/chat.ts                 # MODIFY — chat:approval-response handler

src/shared/
├── chat-types.ts                             # MODIFY — extend AgentDto with toolPerms + approvalPolicy
├── ipc-channels.ts                           # MODIFY — CHAT_APPROVAL_RESPONSE channel
└── agent-form-schema.ts                      # MODIFY — add toolPerms + approvalPolicy fields

src/preload/index.ts                          # MODIFY — chat.respondToApproval method
src/renderer/src/lib/ipc.ts                   # MODIFY — declare same

src/renderer/src/chat/
├── ApprovalModal.tsx                         # NEW
├── useChatStream.ts                          # MODIFY — pendingApproval state + respondApproval
└── AgentFormModal.tsx                        # MODIFY — tool perms checkboxes + policy radio + yolo confirm

src/renderer/src/screens/Chat.tsx             # MODIFY — render ApprovalModal when pending

tests/main/db/migration-004.test.ts           # NEW
tests/main/tools/shell-tool.test.ts           # NEW
tests/main/agent/approval-gate.test.ts        # NEW
tests/main/agent/tool-specs.test.ts           # MODIFY — getToolSpecsForAgent + SHELL_TOOL_SPEC
tests/main/agent/tool-dispatcher.test.ts      # MODIFY — approval-gated calls + shell case
tests/main/repos/chat-repository.test.ts      # MODIFY — toolPerms + approvalPolicy round-trip
tests/shared/ipc-channels.test.ts             # MODIFY — chat:approval-response schema cases
```

---

## Conventions

- Git author flags: `git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit ...`
- Node 22 PATH on every shell command: `export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH"`

---

## Task 1: Migration 004 + repo mapper

**Files:**
- Create: `src/main/db/migrations/004_agent_tool_perms.sql`
- Modify: `src/main/db/database.ts`
- Modify: `src/main/repos/chat-repository.ts`
- Modify: `src/shared/chat-types.ts`
- Test: `tests/main/db/migration-004.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/db/migration-004.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-mig4-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 004 — agent tool_perms / approval_policy', () => {
  it('adds the columns', () => {
    const db = openDatabase(dbPath);
    const cols = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['tool_perms', 'approval_policy']));
    db.close();
  });

  it('records schema_version 4', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBe(4);
    db.close();
  });

  it('Code Helper has shell enabled and cautious policy after backfill', () => {
    const db = openDatabase(dbPath);
    const row = db
      .prepare(
        "SELECT tool_perms, approval_policy FROM agents WHERE id = 'agent-code-helper'",
      )
      .get() as { tool_perms: string; approval_policy: string };
    const perms = JSON.parse(row.tool_perms) as { shell_enabled: boolean; delete_enabled: boolean };
    expect(perms.shell_enabled).toBe(true);
    expect(perms.delete_enabled).toBe(true);
    expect(row.approval_policy).toBe('cautious');
    db.close();
  });

  it('new agent rows default to shell disabled, delete enabled, cautious', () => {
    const db = openDatabase(dbPath);
    db.prepare(
      `INSERT INTO agents (id, name, description, specialty_tags, avatar_color, system_prompt, model, workspace_path, created_at, updated_at)
       VALUES ('test-1', 'T', '', '[]', '#ffffff', 'p', 'm', '/tmp/t', 1, 1)`,
    ).run();
    const row = db
      .prepare("SELECT tool_perms, approval_policy FROM agents WHERE id = 'test-1'")
      .get() as { tool_perms: string; approval_policy: string };
    expect(JSON.parse(row.tool_perms)).toEqual({
      shell_enabled: false,
      delete_enabled: true,
    });
    expect(row.approval_policy).toBe('cautious');
    db.close();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test -- tests/main/db/migration-004.test.ts
```

Expected: failures.

- [ ] **Step 3: Write `src/main/db/migrations/004_agent_tool_perms.sql`**

```sql
ALTER TABLE agents ADD COLUMN tool_perms TEXT NOT NULL DEFAULT '{"shell_enabled":false,"delete_enabled":true}';
ALTER TABLE agents ADD COLUMN approval_policy TEXT NOT NULL DEFAULT 'cautious';

UPDATE agents
SET
  tool_perms = '{"shell_enabled":true,"delete_enabled":true}',
  approval_policy = 'cautious'
WHERE id = 'agent-code-helper' AND tool_perms = '{"shell_enabled":false,"delete_enabled":true}';
```

- [ ] **Step 4: Modify `src/main/db/database.ts`**

```ts
import migration004 from './migrations/004_agent_tool_perms.sql?raw';

const MIGRATIONS: Migration[] = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 },
  { version: 3, sql: migration003 },
  { version: 4, sql: migration004 },
];
```

- [ ] **Step 5: Modify `src/shared/chat-types.ts`** — extend AgentDto

```ts
export interface ToolPerms {
  shell_enabled: boolean;
  delete_enabled: boolean;
}

export type ApprovalPolicy = 'cautious' | 'trusting' | 'yolo';

export interface AgentDto {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
  avatarColor: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
  toolPerms: ToolPerms;
  approvalPolicy: ApprovalPolicy;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 6: Modify `src/main/repos/chat-repository.ts`** — extend `AgentDbRow` + `toAgent` + `CreateAgentInput` + `UpdateAgentInput` + INSERT/UPDATE statements

Replace the `AgentDbRow` interface:

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
  tool_perms: string;
  approval_policy: string;
  created_at: number;
  updated_at: number;
}
```

Replace `toAgent`:

```ts
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
    toolPerms: JSON.parse(r.tool_perms) as { shell_enabled: boolean; delete_enabled: boolean },
    approvalPolicy: r.approval_policy as 'cautious' | 'trusting' | 'yolo',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

Update `CreateAgentInput` and `UpdateAgentInput`:

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
  toolPerms: { shell_enabled: boolean; delete_enabled: boolean };
  approvalPolicy: 'cautious' | 'trusting' | 'yolo';
}

export type UpdateAgentInput = Omit<CreateAgentInput, 'id' | 'workspacePath'>;
```

Update `createAgent`:

```ts
createAgent(input: CreateAgentInput): AgentRow {
  const now = Date.now();
  this.db
    .prepare(
      `INSERT INTO agents
        (id, name, description, specialty_tags, avatar_color, system_prompt, model, workspace_path, tool_perms, approval_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(input.toolPerms),
      input.approvalPolicy,
      now,
      now,
    );
  const row = this.getAgent(input.id);
  if (!row) throw new Error(`createAgent: failed to read back ${input.id}`);
  return row;
}
```

Update `updateAgent`:

```ts
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
             tool_perms = ?,
             approval_policy = ?,
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
      JSON.stringify(input.toolPerms),
      input.approvalPolicy,
      now,
      id,
    );
  const row = this.getAgent(id);
  if (!row) throw new Error(`updateAgent: agent ${id} disappeared`);
  return row;
}
```

- [ ] **Step 7: Update existing repo test**

In `tests/main/repos/chat-repository.test.ts`, find the `createAgent` call inside `describe('ChatRepository — agent CRUD', ...)` and pass the new fields. Replace each `createAgent({...})` call to include:

```ts
toolPerms: { shell_enabled: false, delete_enabled: true },
approvalPolicy: 'cautious',
```

And the `updateAgent` call to include the same.

Add a new test inside the agent CRUD block:

```ts
it('round-trips toolPerms and approvalPolicy through create + update', () => {
  const a = repo.createAgent({
    id: 'shell-agent-12345678',
    name: 'Shell Agent',
    description: '',
    specialtyTags: [],
    systemPrompt: 'p',
    model: 'm',
    avatarColor: '#000000',
    workspacePath: '/tmp/ws/shell',
    toolPerms: { shell_enabled: true, delete_enabled: false },
    approvalPolicy: 'trusting',
  });
  expect(a.toolPerms).toEqual({ shell_enabled: true, delete_enabled: false });
  expect(a.approvalPolicy).toBe('trusting');

  const u = repo.updateAgent(a.id, {
    name: 'Shell Agent',
    description: '',
    specialtyTags: [],
    systemPrompt: 'p',
    model: 'm',
    avatarColor: '#000000',
    toolPerms: { shell_enabled: true, delete_enabled: true },
    approvalPolicy: 'yolo',
  });
  expect(u.toolPerms).toEqual({ shell_enabled: true, delete_enabled: true });
  expect(u.approvalPolicy).toBe('yolo');
});
```

- [ ] **Step 8: Run all tests**

```bash
npm test
```

Expected: all green (170 prior + 4 mig004 + 1 round-trip = 175).

- [ ] **Step 9: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/db/migrations/004_agent_tool_perms.sql src/main/db/database.ts src/main/repos/chat-repository.ts src/shared/chat-types.ts tests/main/db/migration-004.test.ts tests/main/repos/chat-repository.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(db): migration 004 adds tool_perms + approval_policy to agents"
```

---

## Task 2: Install shell-quote

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm install shell-quote@^1.8 && npm install -D @types/shell-quote
```

- [ ] **Step 2: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add package.json package-lock.json
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "chore: install shell-quote for safe shell argv parsing"
```

---

## Task 3: ShellTool

**Files:**
- Create: `src/main/tools/shell-tool.ts`
- Test: `tests/main/tools/shell-tool.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/tools/shell-tool.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShell } from '@main/tools/shell-tool';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-shell-'));
  writeFileSync(join(workspace, 'README.md'), '# test\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('runShell', () => {
  it('runs node --version successfully', async () => {
    const r = await runShell('node --version', workspace);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^v\d+\./);
  });

  it('captures stderr', async () => {
    const r = await runShell('node -e "process.stderr.write(\\"err\\"); process.exit(2)"', workspace);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe('err');
  });

  it('returns ok=false when binary not found', async () => {
    const r = await runShell('definitelynotacommand_xyz', workspace);
    expect(r.ok).toBe(false);
  });

  it('rejects shell metacharacters (pipes/redirects)', async () => {
    const r = await runShell('echo hi | cat', workspace);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/metachar/i);
  });

  it('rejects sudo prefix', async () => {
    const r = await runShell('sudo ls', workspace);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/sudo/i);
  });

  it('rejects empty command', async () => {
    const r = await runShell('   ', workspace);
    expect(r.ok).toBe(false);
  });

  it('truncates output above 1MB', async () => {
    // Generate ~2MB of output
    const r = await runShell(
      'node -e "for(let i=0;i<200000;i++) process.stdout.write(\\"abcdefghij\\")"',
      workspace,
    );
    expect(r.truncated).toBe(true);
    expect(r.stdout.length + r.stderr.length).toBeLessThanOrEqual(1_000_200);
  });

  it('kills on timeout', async () => {
    const r = await runShell('node -e "setInterval(()=>{},1000)"', workspace, {
      timeoutMs: 500,
    });
    expect(r.exitCode).not.toBe(0);
  }, 10_000);

  it('runs in the workspace cwd', async () => {
    const r = await runShell(process.platform === 'win32' ? 'cmd /c cd' : 'pwd', workspace);
    // On Windows, "cmd /c cd" prints the dir; on POSIX, pwd does.
    // We just check the workspace prefix appears.
    expect(r.stdout).toContain(workspace.split(/[\\/]/).slice(-1)[0]!);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/main/tools/shell-tool.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/tools/shell-tool.ts`**

```ts
import { spawn } from 'node:child_process';
import { parse as parseShell } from 'shell-quote';

export interface ShellResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

const MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const SCRUB_ENV_KEEP = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP',
  'PATHEXT', 'COMSPEC', 'WINDIR',
]);

const FORBIDDEN_PREFIXES = ['sudo', 'su', 'runas', 'doas'];

function buildEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (SCRUB_ENV_KEEP.has(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}

function fail(stderr: string, durationMs: number): ShellResult {
  return {
    ok: false,
    exitCode: null,
    stdout: '',
    stderr,
    truncated: false,
    durationMs,
  };
}

export async function runShell(
  command: string,
  cwd: string,
  opts?: { timeoutMs?: number },
): Promise<ShellResult> {
  const started = Date.now();
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return fail('empty command', 0);
  }

  const tokens = parseShell(trimmed);
  if (tokens.length === 0) {
    return fail('empty command after parse', Date.now() - started);
  }
  for (const t of tokens) {
    if (typeof t !== 'string') {
      return fail(`shell metacharacter not allowed: ${JSON.stringify(t)}`, Date.now() - started);
    }
  }
  const argv = tokens as string[];
  const head = argv[0]!.toLowerCase();
  if (FORBIDDEN_PREFIXES.includes(head)) {
    return fail(`command "${argv[0]}" is not allowed`, Date.now() - started);
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return new Promise<ShellResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;

    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env: buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
      windowsHide: true,
    });

    const onData = (kind: 'stdout' | 'stderr') => (chunk: Buffer): void => {
      const total = stdout.length + stderr.length;
      const remaining = MAX_OUTPUT_BYTES - total;
      if (remaining <= 0) {
        truncated = true;
        if (!child.killed) child.kill('SIGTERM');
        return;
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining).toString('utf8') : chunk.toString('utf8');
      if (chunk.length > remaining) truncated = true;
      if (kind === 'stdout') stdout += slice;
      else stderr += slice;
      if (truncated && !child.killed) child.kill('SIGTERM');
    };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', (err) => {
      clearTimeout(timer);
      const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? `command not found: ${argv[0]}`
        : err.message;
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || msg,
        truncated,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !truncated,
        exitCode: code,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/main/tools/shell-tool.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/tools/shell-tool.ts tests/main/tools/shell-tool.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(tools): runShell — argv-only, sandboxed, capped, timeout-killed"
```

---

## Task 4: Shared types + IPC channel for approvals

**Files:**
- Modify: `src/main/agent/types.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/agent-form-schema.ts`

- [ ] **Step 1: Modify `src/main/agent/types.ts`** — add new AgentEvent variants

Replace the `AgentEvent` union (keep existing variants, add two new):

```ts
export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | { type: 'turn-done'; reason: AgentEventTurnDoneReason; error?: string }
  | { type: 'token-usage'; promptTokens: number; completionTokens: number }
  | {
      type: 'tool-approval-required';
      toolCallId: string;
      toolName: string;
      args: unknown;
      cwd: string;
    }
  | {
      type: 'tool-approval-resolved';
      toolCallId: string;
      decision: 'allow-once' | 'allow-rest' | 'deny';
      reason?: string;
    };
```

- [ ] **Step 2: Modify `src/shared/ipc-channels.ts`** — add channel + schema

Add `CHAT_APPROVAL_RESPONSE: 'chat:approval-response'` to `CHANNELS`.

Add to `schemas`:

```ts
chatApprovalResponseRequest: z.object({
  streamId: z.string().min(1),
  toolCallId: z.string().min(1),
  decision: z.enum(['allow-once', 'allow-rest', 'deny']),
  reason: z.string().optional(),
}),
chatApprovalResponseResponse: z.object({ ok: z.boolean() }),
```

Add inferred types at bottom:

```ts
export type ChatApprovalResponseRequest = z.infer<typeof schemas.chatApprovalResponseRequest>;
export type ChatApprovalResponseResponse = z.infer<typeof schemas.chatApprovalResponseResponse>;
```

Update agent CRUD schemas (create + update) to include `toolPerms` + `approvalPolicy`:

```ts
const toolPermsSchema = z.object({
  shell_enabled: z.boolean(),
  delete_enabled: z.boolean(),
});
const approvalPolicySchema = z.enum(['cautious', 'trusting', 'yolo']);
```

In `chatCreateAgentRequest` and `chatUpdateAgentRequest`, append:

```ts
toolPerms: toolPermsSchema,
approvalPolicy: approvalPolicySchema,
```

Update `agentDtoSchema` similarly.

- [ ] **Step 3: Modify `src/shared/agent-form-schema.ts`**

```ts
import { z } from 'zod';

export const agentFormSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200),
  specialtyTags: z.array(z.string().min(1).max(40)).max(10),
  systemPrompt: z.string().min(1).max(4000),
  model: z.string().min(1),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  toolPerms: z.object({
    shell_enabled: z.boolean(),
    delete_enabled: z.boolean(),
  }),
  approvalPolicy: z.enum(['cautious', 'trusting', 'yolo']),
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;

export const AVATAR_COLORS = [
  '#d97757',
  '#5b8def',
  '#6dbf94',
  '#a973d4',
  '#d96e6e',
  '#9ca3af',
] as const;
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: many errors at handler call sites — fixed in Task 5+.

- [ ] **Step 5: Commit (incomplete state — typecheck WILL fail until Task 6)**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/types.ts src/shared/ipc-channels.ts src/shared/agent-form-schema.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(shared): approval channel + AgentEvent variants + form schema fields

WIP — handler call sites updated in Task 6."
```

---

## Task 5: ApprovalGate

**Files:**
- Create: `src/main/agent/approval-gate.ts`
- Test: `tests/main/agent/approval-gate.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/agent/approval-gate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalGate } from '@main/agent/approval-gate';

const fakeAgent = {
  id: 'a1',
  approvalPolicy: 'cautious' as const,
  toolPerms: { shell_enabled: true, delete_enabled: true },
} as Parameters<ApprovalGate['require']>[0]['agent'];

function newGate(): { gate: ApprovalGate; events: Array<{ channel: string; payload: unknown }> } {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const gate = new ApprovalGate(
    (channel, payload) => events.push({ channel, payload }),
    50, // short auto-deny timeout for tests
  );
  return { gate, events };
}

describe('ApprovalGate.shouldPrompt — cautious', () => {
  it('prompts shell + delete + write_file overwrite, not reads', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(
      gate.shouldPrompt('cautious', 'run_shell', { command: 'ls' }, false),
    ).toBe(true);
    expect(gate.shouldPrompt('cautious', 'delete_file', { path: 'a' }, false)).toBe(true);
    expect(gate.shouldPrompt('cautious', 'write_file', { path: 'new' }, false)).toBe(false);
    expect(gate.shouldPrompt('cautious', 'write_file', { path: 'old' }, true)).toBe(true);
    expect(gate.shouldPrompt('cautious', 'read_file', { path: 'a' }, false)).toBe(false);
  });
});

describe('ApprovalGate.shouldPrompt — trusting', () => {
  it('prompts shell + delete only', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('trusting', 'run_shell', {}, false)).toBe(true);
    expect(gate.shouldPrompt('trusting', 'delete_file', {}, false)).toBe(true);
    expect(gate.shouldPrompt('trusting', 'write_file', {}, true)).toBe(false);
  });
});

describe('ApprovalGate.shouldPrompt — yolo', () => {
  it('never prompts', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('yolo', 'run_shell', {}, false)).toBe(false);
    expect(gate.shouldPrompt('yolo', 'delete_file', {}, false)).toBe(false);
  });
});

describe('ApprovalGate.require — interactive', () => {
  it('emits tool-approval-required and resolves on allow-once', async () => {
    const { gate, events } = newGate();
    const p = gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: { command: 'ls' },
      cwd: '/tmp/ws',
      isOverwrite: false,
    });
    // gate emits required event before awaiting
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => (e.payload as { type?: string }).type === 'tool-approval-required')).toBe(true);
    gate.resolve('s1', 't1', 'allow-once');
    const result = await p;
    expect(result).toBe('allow');
  });

  it('resolves to deny', async () => {
    const { gate } = newGate();
    const p = gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: {},
      cwd: '/tmp',
      isOverwrite: false,
    });
    gate.resolve('s1', 't1', 'deny', 'no');
    const result = await p;
    expect(result).toBe('deny');
  });

  it('allow-rest is sticky for same chat+tool', async () => {
    const { gate, events } = newGate();
    const p1 = gate.require({
      streamId: 's1', chatId: 'c1', agent: fakeAgent,
      toolCallId: 't1', toolName: 'run_shell', args: {}, cwd: '/tmp', isOverwrite: false,
    });
    gate.resolve('s1', 't1', 'allow-rest');
    expect(await p1).toBe('allow');
    const beforeCount = events.filter((e) => (e.payload as { type?: string }).type === 'tool-approval-required').length;
    // Second call same tool same chat: should NOT prompt
    const p2 = gate.require({
      streamId: 's1', chatId: 'c1', agent: fakeAgent,
      toolCallId: 't2', toolName: 'run_shell', args: {}, cwd: '/tmp', isOverwrite: false,
    });
    expect(await p2).toBe('allow');
    const afterCount = events.filter((e) => (e.payload as { type?: string }).type === 'tool-approval-required').length;
    expect(afterCount).toBe(beforeCount); // no new prompt
  });

  it('auto-denies after timeout', async () => {
    const { gate } = newGate();
    const result = await gate.require({
      streamId: 's1', chatId: 'c1', agent: fakeAgent,
      toolCallId: 't1', toolName: 'run_shell', args: {}, cwd: '/tmp', isOverwrite: false,
    });
    expect(result).toBe('deny');
  });
});

describe('ApprovalGate.require — short-circuit by policy', () => {
  it('yolo never emits a prompt event', async () => {
    const { gate, events } = newGate();
    const yoloAgent = { ...fakeAgent, approvalPolicy: 'yolo' as const };
    const r = await gate.require({
      streamId: 's1', chatId: 'c1', agent: yoloAgent,
      toolCallId: 't1', toolName: 'run_shell', args: {}, cwd: '/tmp', isOverwrite: false,
    });
    expect(r).toBe('allow');
    expect(events.some((e) => (e.payload as { type?: string }).type === 'tool-approval-required')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- tests/main/agent/approval-gate.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/agent/approval-gate.ts`**

```ts
import { chatEventChannel } from '@shared/ipc-channels';
import type { ApprovalPolicy, ToolPerms } from '@shared/chat-types';

interface AgentLike {
  id: string;
  approvalPolicy: ApprovalPolicy;
  toolPerms: ToolPerms;
}

export interface ApprovalRequireOpts {
  streamId: string;
  chatId: string;
  agent: AgentLike;
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
  isOverwrite: boolean;
}

type Decision = 'allow-once' | 'allow-rest' | 'deny';

interface PendingApproval {
  resolve: (result: 'allow' | 'deny') => void;
  timer: NodeJS.Timeout;
}

export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>(); // key: streamId:toolCallId
  private readonly allowRestMemo = new Map<string, Set<string>>(); // chatId -> Set<toolName>

  constructor(
    private readonly send: (channel: string, payload: unknown) => void,
    private readonly autoDenyMs: number = 5 * 60 * 1000,
  ) {}

  shouldPrompt(
    policy: ApprovalPolicy,
    toolName: string,
    _args: unknown,
    isOverwrite: boolean,
  ): boolean {
    if (policy === 'yolo') return false;
    if (toolName === 'run_shell') return true;
    if (toolName === 'delete_file') return true;
    if (toolName === 'write_file') {
      if (policy === 'cautious') return isOverwrite;
      return false; // trusting
    }
    return false;
  }

  async require(opts: ApprovalRequireOpts): Promise<'allow' | 'deny'> {
    if (!this.shouldPrompt(opts.agent.approvalPolicy, opts.toolName, opts.args, opts.isOverwrite)) {
      return 'allow';
    }
    const memo = this.allowRestMemo.get(opts.chatId);
    if (memo?.has(opts.toolName)) return 'allow';

    const key = `${opts.streamId}:${opts.toolCallId}`;
    return new Promise<'allow' | 'deny'>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        resolve('deny');
      }, this.autoDenyMs);
      this.pending.set(key, { resolve, timer });
      this.send(chatEventChannel(opts.streamId), {
        type: 'tool-approval-required',
        toolCallId: opts.toolCallId,
        toolName: opts.toolName,
        args: opts.args,
        cwd: opts.cwd,
      });
    });
  }

  resolve(streamId: string, toolCallId: string, decision: Decision, _reason?: string, chatId?: string, toolName?: string): boolean {
    const key = `${streamId}:${toolCallId}`;
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    if (decision === 'allow-rest' && chatId && toolName) {
      let set = this.allowRestMemo.get(chatId);
      if (!set) {
        set = new Set();
        this.allowRestMemo.set(chatId, set);
      }
      set.add(toolName);
    }
    entry.resolve(decision === 'deny' ? 'deny' : 'allow');
    // Echo a resolved event for renderer transparency
    this.send(chatEventChannel(streamId), {
      type: 'tool-approval-resolved',
      toolCallId,
      decision,
    });
    return true;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/main/agent/approval-gate.test.ts
```

Expected: 8 passed (some tests may need a couple ms tweaks; if so, bump the auto-deny timeout in `newGate()` for the resolve tests but keep it 50ms for the auto-deny test).

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/approval-gate.ts tests/main/agent/approval-gate.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): ApprovalGate gates tool calls per policy with chat-scoped allow-rest"
```

---

## Task 6: Wire ApprovalGate + ShellTool into ToolDispatcher + AgentSession

**Files:**
- Modify: `src/main/agent/tool-dispatcher.ts`
- Modify: `src/main/agent/tool-specs.ts`
- Modify: `src/main/agent/agent-session.ts`
- Modify: `src/main/agent/agent-session-manager.ts`
- Modify: `src/main/ipc/handlers/chat.ts`

- [ ] **Step 1: Modify `src/main/agent/tool-specs.ts`**

Append SHELL_TOOL_SPEC:

```ts
export const SHELL_TOOL_SPEC: ToolSpec = {
  name: 'run_shell',
  description:
    'Run a non-interactive shell command in the workspace directory. No pipes, redirects, or interactive prompts. Always requires user approval (per agent policy).',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Full command with args, e.g. "npm install react".',
      },
    },
    required: ['command'],
  },
};

export interface ToolPermsLike {
  shell_enabled: boolean;
  delete_enabled: boolean;
}

export function getToolSpecsForAgent(perms: ToolPermsLike): ToolSpec[] {
  const result: ToolSpec[] = [];
  for (const spec of FILE_TOOL_SPECS) {
    if (spec.name === 'delete_file' && !perms.delete_enabled) continue;
    result.push(spec);
  }
  if (perms.shell_enabled) result.push(SHELL_TOOL_SPEC);
  return result;
}
```

- [ ] **Step 2: Modify `src/main/agent/tool-dispatcher.ts`**

Replace the file contents with the new approval-aware version (key changes: optional gate, workspaceRoot field for shell, run_shell case, write_file overwrite detection):

```ts
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { FileTools } from '@main/tools';
import { runShell } from '@main/tools/shell-tool';
import type { ToolResult } from './types';
import type { ApprovalGate } from './approval-gate';
import type { AgentRow, ChatRow } from '@main/repos/chat-repository';
import { resolveSafe } from '@main/tools/path-sandbox';

export const MAX_TOOL_OUTPUT_BYTES = 100_000;

const argsSchemas = {
  read_file: z.object({ path: z.string() }),
  list_dir: z.object({ path: z.string() }),
  write_file: z.object({ path: z.string(), content: z.string() }),
  delete_file: z.object({ path: z.string() }),
  search_files: z.object({
    pattern: z.string(),
    kind: z.enum(['name', 'content']),
  }),
  run_shell: z.object({ command: z.string() }),
} as const;

type ToolName = keyof typeof argsSchemas;

function isKnownTool(name: string): name is ToolName {
  return name in argsSchemas;
}

function ok(id: string, name: string, content: string): ToolResult {
  return { toolCallId: id, toolName: name, ok: true, content: cap(content) };
}

function failure(id: string, name: string, msg: string): ToolResult {
  return { toolCallId: id, toolName: name, ok: false, content: cap(msg) };
}

function cap(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT_BYTES) return s;
  return (
    s.slice(0, MAX_TOOL_OUTPUT_BYTES) +
    `\n\n[truncated: ${s.length - MAX_TOOL_OUTPUT_BYTES} more bytes]`
  );
}

export interface ToolDispatcherDeps {
  fileTools: FileTools;
  workspaceRoot: string;
  // Optional — when present, gates write_file overwrite, delete_file, run_shell
  approvalGate?: ApprovalGate;
  agent?: AgentRow;
  chat?: ChatRow;
  streamId?: string;
}

export class ToolDispatcher {
  constructor(private readonly deps: ToolDispatcherDeps) {}

  async call(toolCallId: string, name: string, rawArgs: unknown): Promise<ToolResult> {
    if (!isKnownTool(name)) {
      return failure(toolCallId, name, `unknown tool: ${name}`);
    }
    const schema = argsSchemas[name];
    const parsed = schema.safeParse(rawArgs);
    if (!parsed.success) {
      const detail = parsed.error.errors
        .map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
        .join('; ');
      return failure(toolCallId, name, `invalid args: ${detail}`);
    }

    // Approval gate
    const gate = this.deps.approvalGate;
    if (gate && this.deps.agent && this.deps.chat && this.deps.streamId) {
      const isOverwrite =
        name === 'write_file' &&
        existsSync(safeJoin(this.deps.workspaceRoot, (parsed.data as { path: string }).path));
      const decision = await gate.require({
        streamId: this.deps.streamId,
        chatId: this.deps.chat.id,
        agent: this.deps.agent,
        toolCallId,
        toolName: name,
        args: parsed.data,
        cwd: this.deps.workspaceRoot,
        isOverwrite,
      });
      // Tell gate to remember on allow-rest happens inside resolve()
      if (decision === 'deny') {
        return failure(toolCallId, name, 'User denied this tool call.');
      }
    }

    try {
      switch (name) {
        case 'read_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.read_file>;
          const content = await this.deps.fileTools.readFile(a.path);
          return ok(toolCallId, name, content);
        }
        case 'list_dir': {
          const a = parsed.data as z.infer<typeof argsSchemas.list_dir>;
          const entries = await this.deps.fileTools.listDir(a.path);
          return ok(toolCallId, name, JSON.stringify(entries));
        }
        case 'write_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.write_file>;
          const result = await this.deps.fileTools.writeFile(a.path, a.content);
          return ok(toolCallId, name, JSON.stringify(result));
        }
        case 'delete_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.delete_file>;
          await this.deps.fileTools.deleteFile(a.path);
          return ok(toolCallId, name, 'ok');
        }
        case 'search_files': {
          const a = parsed.data as z.infer<typeof argsSchemas.search_files>;
          const hits = await this.deps.fileTools.searchFiles({
            pattern: a.pattern,
            kind: a.kind,
          });
          return ok(toolCallId, name, JSON.stringify(hits));
        }
        case 'run_shell': {
          const a = parsed.data as z.infer<typeof argsSchemas.run_shell>;
          const result = await runShell(a.command, this.deps.workspaceRoot);
          return ok(
            toolCallId,
            name,
            JSON.stringify({
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              truncated: result.truncated,
              durationMs: result.durationMs,
            }),
          );
        }
      }
    } catch (err) {
      return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
    }
  }
}

function safeJoin(root: string, rel: string): string {
  try {
    return resolveSafe(root, rel);
  } catch {
    return root; // never matches existsSync — but caller will reject in tool exec
  }
}
```

- [ ] **Step 3: Modify `src/main/agent/agent-session.ts`** — pass agent, chat, streamId to AgentRuntime via dispatcher already wired through opts. Tool specs come from `getToolSpecsForAgent`.

In `agent-session-manager.ts`, replace the dispatcherFactory invocation. Updated `agent-session-manager.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { LLMProvider } from './llm-provider';
import type { ChatRepository } from '@main/repos/chat-repository';
import { AgentSession } from './agent-session';
import { getToolSpecsForAgent } from './tool-specs';
import { CHANNELS } from '@shared/ipc-channels';
import { ToolDispatcher } from './tool-dispatcher';
import { FileTools } from '@main/tools';
import type { ApprovalGate } from './approval-gate';

export interface AgentSessionManagerOpts {
  provider: LLMProvider;
  repo: ChatRepository;
  approvalGate: ApprovalGate;
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
    const streamId = randomUUID();
    const dispatcher = new ToolDispatcher({
      fileTools: new FileTools(agent.workspacePath),
      workspaceRoot: agent.workspacePath,
      approvalGate: this.opts.approvalGate,
      agent,
      chat,
      streamId,
    });
    const toolSpecs = getToolSpecsForAgent(agent.toolPerms);

    const session = new AgentSession({
      streamId,
      agent,
      chat,
      history,
      provider: this.opts.provider,
      dispatcher,
      repo: this.opts.repo,
      send: this.opts.send,
      toolSpecs,
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

  // For the IPC approval-response handler
  resolveApproval(streamId: string, toolCallId: string, decision: 'allow-once' | 'allow-rest' | 'deny', reason?: string): boolean {
    const entry = this.active.get(streamId);
    const chatId = entry?.chatId;
    const toolName = ''; // ApprovalGate handles allow-rest memory keyed by chatId+toolName; we look up via gate's pending entries — but resolve doesn't know toolName. Pass through; gate stores it via the original require() call via closure.
    return this.opts.approvalGate.resolve(streamId, toolCallId, decision, reason, chatId, toolName);
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

To make `allow-rest` work for the gate without the manager knowing the toolName, refactor `ApprovalGate` to track `chatId` + `toolName` keyed by the pending entry's key. Update `approval-gate.ts`:

Inside `require()`:

```ts
this.pending.set(key, { resolve, timer, chatId: opts.chatId, toolName: opts.toolName });
```

`PendingApproval` interface becomes:

```ts
interface PendingApproval {
  resolve: (result: 'allow' | 'deny') => void;
  timer: NodeJS.Timeout;
  chatId: string;
  toolName: string;
}
```

`resolve()` becomes:

```ts
resolve(streamId: string, toolCallId: string, decision: Decision, _reason?: string): boolean {
  const key = `${streamId}:${toolCallId}`;
  const entry = this.pending.get(key);
  if (!entry) return false;
  clearTimeout(entry.timer);
  this.pending.delete(key);
  if (decision === 'allow-rest') {
    let set = this.allowRestMemo.get(entry.chatId);
    if (!set) {
      set = new Set();
      this.allowRestMemo.set(entry.chatId, set);
    }
    set.add(entry.toolName);
  }
  entry.resolve(decision === 'deny' ? 'deny' : 'allow');
  this.send(chatEventChannel(streamId), {
    type: 'tool-approval-resolved',
    toolCallId,
    decision,
  });
  return true;
}
```

(`AgentSessionManager.resolveApproval` is then simply `this.opts.approvalGate.resolve(streamId, toolCallId, decision, reason)`. Update test for `resolve` signature accordingly — tests in Task 5 already match this newer shape if we drop the trailing chatId/toolName args. Adjust now: `gate.resolve('s1', 't1', 'allow-rest')` should still work because gate stores chatId/toolName from `require()` time.)

- [ ] **Step 4: Modify `src/main/ipc/handlers/chat.ts`** — add approval response handler

Inside `registerChatHandlers`, append:

```ts
ipcMain.handle(CHANNELS.CHAT_APPROVAL_RESPONSE, (_e, raw) => {
  const { streamId, toolCallId, decision, reason } = schemas.chatApprovalResponseRequest.parse(raw);
  return { ok: deps.manager.resolveApproval(streamId, toolCallId, decision, reason) };
});
```

- [ ] **Step 5: Modify `src/main/index.ts`** — construct ApprovalGate, pass to manager + remove dispatcherFactory

In `src/main/index.ts`, find the manager construction. Replace:

```ts
const dispatcherFactory = (workspacePath: string) => {
  return new ToolDispatcher(new FileTools(workspacePath));
};

// ...

const manager = new AgentSessionManager({
  provider,
  repo,
  dispatcherFactory,
  send,
});
```

with:

```ts
const { ApprovalGate } = await import('./agent/approval-gate');
const approvalGate = new ApprovalGate(send);

const manager = new AgentSessionManager({
  provider,
  repo,
  approvalGate,
  send,
});
```

Remove the `dispatcherFactory` and the `ToolDispatcher` + `FileTools` imports if no longer used (they're now used inside the manager).

- [ ] **Step 6: Update `src/main/agent/types.ts` import note**

The `agent-session.ts` `Pending` types include `tool-approval-required` and `tool-approval-resolved` events that get forwarded as IPC. Since the AgentSession's switch on `event.type` only handles known persistence-relevant variants, the new event types must be sent to renderer but NOT mutate persistence buffer. In `agent-session.ts`'s switch, add:

```ts
case 'tool-approval-required':
case 'tool-approval-resolved':
  // forwarded to renderer above; no persistence side effect
  break;
```

Actually the gate emits events directly via `send()`, NOT through AgentRuntime's iterator. So they bypass AgentSession entirely. AgentSession doesn't see them. **No change needed in agent-session.ts.** (Document this comment in the file at the top of `run()`.)

- [ ] **Step 7: Update tool-dispatcher tests**

Existing tests in `tests/main/agent/tool-dispatcher.test.ts` construct `new ToolDispatcher(tools)`. With the new signature, change every `new ToolDispatcher(tools)` to `new ToolDispatcher({ fileTools: tools, workspaceRoot: workspace })`.

The existing tests don't pass an approvalGate, so all calls execute without gating — preserving prior behavior.

- [ ] **Step 8: Update agent-session test fixtures**

Same change: any `new ToolDispatcher(...)` constructor calls switch to the deps-object form.

Update `tests/main/agent/agent-session.test.ts` `buildManager` factory:

```ts
function buildManager(provider: FakeProvider): AgentSessionManager {
  const approvalGate = new ApprovalGate(send, 50);
  return new AgentSessionManager({
    provider,
    repo,
    approvalGate,
    send,
  });
}
```

Add `import { ApprovalGate } from '@main/agent/approval-gate';` at top.

Same for `tests/main/agent/agent-session-manager-broadcast.test.ts`.

- [ ] **Step 9: Run all tests**

```bash
npm test
```

Expected: green (175 prior + ~9 shell + ~8 approval-gate = ~192).

- [ ] **Step 10: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent src/main/ipc src/main/index.ts tests/main
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): wire ApprovalGate + ShellTool through ToolDispatcher + Manager"
```

---

## Task 7: Renderer — preload + ipc.ts + ApprovalModal + useChatStream + AgentFormModal

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/lib/ipc.ts`
- Modify: `src/renderer/src/chat/useChatStream.ts`
- Modify: `src/renderer/src/screens/Chat.tsx`
- Modify: `src/renderer/src/chat/AgentFormModal.tsx`
- Create: `src/renderer/src/chat/ApprovalModal.tsx`

- [ ] **Step 1: Preload — add `respondToApproval`**

In `src/preload/index.ts` chat block:

```ts
respondToApproval: (req: { streamId: string; toolCallId: string; decision: 'allow-once' | 'allow-rest' | 'deny'; reason?: string }): Promise<{ ok: boolean }> =>
  ipcRenderer.invoke(CHANNELS.CHAT_APPROVAL_RESPONSE, req),
```

- [ ] **Step 2: Renderer ipc.ts — declare it**

```ts
respondToApproval: (req: {
  streamId: string;
  toolCallId: string;
  decision: 'allow-once' | 'allow-rest' | 'deny';
  reason?: string;
}) => Promise<{ ok: boolean }>;
```

- [ ] **Step 3: useChatStream — track pending approvals**

Inside `useChatStream.ts`:

Add state:

```ts
interface PendingApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
}

const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
```

In the event handler (where pendingDeltas accumulates), also intercept `tool-approval-required` and `tool-approval-resolved` synchronously:

```ts
ipc.chat.subscribeToStream(
  streamId,
  (event) => {
    const e = event as AgentEventLike & { type?: string };
    if (e.type === 'tool-approval-required') {
      const t = event as { toolCallId: string; toolName: string; args: unknown; cwd: string };
      setPendingApproval({ toolCallId: t.toolCallId, toolName: t.toolName, args: t.args, cwd: t.cwd });
      return;
    }
    if (e.type === 'tool-approval-resolved') {
      setPendingApproval(null);
      return;
    }
    pendingRef.current.push(event as AgentEventLike);
  },
  // ...
);
```

Add `respondApproval` exposed by hook:

```ts
const respondApproval = useCallback(
  async (decision: 'allow-once' | 'allow-rest' | 'deny', reason?: string) => {
    if (!pendingApproval) return;
    const streamId = streamIdRef.current;
    if (!streamId) return;
    await ipc.chat.respondToApproval({
      streamId,
      toolCallId: pendingApproval.toolCallId,
      decision,
      reason,
    });
    // pending will clear on tool-approval-resolved event
  },
  [pendingApproval],
);
```

Add to return object: `pendingApproval, respondApproval`.

Extend `UseChatStreamResult` interface accordingly.

- [ ] **Step 4: ApprovalModal**

`src/renderer/src/chat/ApprovalModal.tsx`:

```tsx
import { useState } from 'react';

interface PendingApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
}

interface Props {
  pending: PendingApproval;
  onRespond: (decision: 'allow-once' | 'allow-rest' | 'deny', reason?: string) => void;
}

export function ApprovalModal({ pending, onRespond }: Props): JSX.Element {
  const [reason, setReason] = useState('');
  const isShell = pending.toolName === 'run_shell';
  const command = isShell ? (pending.args as { command?: string }).command ?? '' : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 pb-8">
      <div className="w-[640px] max-w-[90vw] rounded-lg border border-[var(--accent)]/40 bg-[var(--bg)] p-5 space-y-3 shadow-xl">
        <header className="flex items-center gap-2">
          <span className="text-[var(--accent)]">⚠</span>
          <h3 className="text-base font-semibold">Approval needed</h3>
        </header>
        <div className="text-sm space-y-1">
          <div>
            <span className="text-[var(--ink-faint)]">Tool:</span>{' '}
            <span className="kbd">{pending.toolName}</span>
          </div>
          <div className="text-xs text-[var(--ink-faint)]">
            cwd: <code className="kbd">{pending.cwd}</code>
          </div>
        </div>
        {isShell ? (
          <pre className="kbd p-3 whitespace-pre-wrap break-all text-sm">{command}</pre>
        ) : (
          <pre className="kbd p-3 whitespace-pre-wrap break-all text-xs max-h-48 overflow-auto">
            {JSON.stringify(pending.args, null, 2)}
          </pre>
        )}
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional reason if denying"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => onRespond('deny', reason || undefined)}
          >
            Deny
          </button>
          <button type="button" className="btn" onClick={() => onRespond('allow-once')}>
            Allow once
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onRespond('allow-rest')}>
            Allow rest of chat
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Chat.tsx — render ApprovalModal**

Add at the bottom of the rendered chat layout (before closing `</div>`):

```tsx
{stream.pendingApproval ? (
  <ApprovalModal
    pending={stream.pendingApproval}
    onRespond={(decision, reason) => stream.respondApproval(decision, reason)}
  />
) : null}
```

Add the import: `import { ApprovalModal } from '../chat/ApprovalModal';`

Update status pill to show "Awaiting approval" when pendingApproval is set:

```tsx
<span className="pill text-xs">
  {stream.pendingApproval
    ? 'Awaiting approval…'
    : stream.status === 'idle'
      ? 'Idle'
      : stream.status === 'streaming'
        ? 'Streaming…'
        : stream.status}
</span>
```

- [ ] **Step 6: AgentFormModal — tool perms + approval policy**

Replace `EMPTY` and add field UI. Update default values:

```ts
const EMPTY: AgentFormValues = {
  name: '',
  description: '',
  specialtyTags: [],
  systemPrompt:
    'You are a helpful AI agent. Use the available tools to read, write, and search files inside your workspace.',
  model: '',
  avatarColor: AVATAR_COLORS[0],
  toolPerms: { shell_enabled: false, delete_enabled: true },
  approvalPolicy: 'cautious',
};
```

When initial provided:

```ts
toolPerms: initial.toolPerms,
approvalPolicy: initial.approvalPolicy,
```

Inside the form fields, before the "Avatar color" Field:

```tsx
<Field label="Tools enabled">
  <div className="flex flex-col gap-2 text-sm">
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={values.toolPerms.shell_enabled}
        onChange={(e) =>
          set('toolPerms', { ...values.toolPerms, shell_enabled: e.target.checked })
        }
      />
      Enable shell (run_shell). Always requires approval per policy.
    </label>
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={values.toolPerms.delete_enabled}
        onChange={(e) =>
          set('toolPerms', { ...values.toolPerms, delete_enabled: e.target.checked })
        }
      />
      Enable file deletion (delete_file).
    </label>
  </div>
</Field>

<Field label="Approval policy">
  <div className="flex gap-3 text-sm">
    {(['cautious', 'trusting', 'yolo'] as const).map((p) => (
      <label key={p} className="flex items-center gap-1">
        <input
          type="radio"
          name="approvalPolicy"
          checked={values.approvalPolicy === p}
          onChange={() => {
            if (p === 'yolo') {
              const ok = window.confirm(
                'YOLO mode: ALL tool calls (including shell + delete) will run WITHOUT approval. This includes destructive commands. Continue?',
              );
              if (!ok) return;
            }
            set('approvalPolicy', p);
          }}
        />
        {p}
      </label>
    ))}
  </div>
</Field>
```

Update submit's `parsed.data` to include the new fields (zod schema already requires them).

- [ ] **Step 7: Typecheck + tests + build**

```bash
npm run typecheck && npm test && npm run build
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/preload src/renderer
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): ApprovalModal + useChatStream pendingApproval + AgentFormModal perms/policy"
```

---

## Task 8: Manual smoke test

**Files:** none.

- [ ] **Step 1: Restart dev**

```bash
npm run dev
```

- [ ] **Step 2: Verify migration 004**

DevTools console:

```js
await window.flowstate.chat.listAgents()
```

Expected: Code Helper has `toolPerms.shell_enabled === true`, `approvalPolicy === 'cautious'`.

- [ ] **Step 3: Manual checks**

1. Open Code Helper chat. Send "Run node --version".
2. Approval modal slides up showing `run_shell("node --version")` + cwd. Click **Allow once**. Modal closes. Tool result lands. Final assistant text quotes the version.
3. Send "Run npm config get registry". Approval modal again (allow-once is per-call). **Allow rest of chat**. Subsequent shell commands skip the modal.
4. Send "Delete a.txt" (after creating one). Approval modal pops for delete. Click **Deny "test"**. Tool result includes denial message; model recovers.
5. Edit Code Helper → set policy `yolo`. Confirm scary prompt. Send shell command → no modal.
6. Create new agent with shell DISABLED. Try to ask it to run shell — model emits text but can't actually use the tool (spec not exposed).
7. Reload app. Open existing chat with `allow-rest` from earlier — modal returns (memory cleared).
8. Test timeout: ask agent to run a long-running command. After 60s, stderr/exitCode reflects timeout.

- [ ] **Step 4: Reply with screenshot or `smoke ok` / `smoke broke: <error>`**

- [ ] **Step 5: No commit.**

---

## Task 9: Tag plan-e-shell

**Files:** `README.md`

- [ ] **Step 1: Update README**

Replace `⏳ Plan E — Shell tool + approval gate` with:

```markdown
- ✅ Plan E — Shell tool + approval gate (run_shell, ApprovalGate, three policies)
```

- [ ] **Step 2: Commit + tag**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add README.md
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "docs: mark Plan E complete in README"
git tag plan-e-shell-approval
```

---

## Done Criteria

- ~190+ tests green.
- `npm run typecheck` clean.
- `npm run build` succeeds.
- Manual smoke test passes.
- `git tag plan-e-shell-approval` exists.

---

## Out of Scope (Plans F / G)

- Orchestrator routing (global "ask anything") — Plan F.
- Per-command timeout override slider in approval modal — Plan G.
- Streaming shell output to UI — Plan G.
- Container isolation for shell — future.
- Renderer unit tests — Plan G.
