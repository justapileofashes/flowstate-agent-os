# Flowstate — Plan C1: Backend Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend agent runtime — `LLMProvider` interface, `OllamaProvider`, `ToolDispatcher`, and `AgentRuntime` with a tested tool-use loop — so a single hardcoded agent can be driven against a fake (in-tests) or real (in C3 smoke) LLM.

**Architecture:** Pure backend module under `src/main/agent/`. `AgentRuntime` runs a deterministic loop: provider stream → text deltas + tool calls → dispatcher executes tools → loops until model emits no more tool calls or caps trigger. `FakeProvider` lets the runtime be tested without Ollama. No UI, no DB, no IPC in this plan.

**Tech Stack:** Node 22's native `fetch`, `node:fs/promises`, vitest, zod, the `ollama` npm package's HTTP shape (we don't use the high-level client — we hit `/api/chat` directly so we control streaming + abort).

**Demo target:** `npm test` reports ~50 new tests green under `tests/main/agent/`. No app behavior change yet — wiring lands in C2.

---

## File Structure

```
src/main/agent/
├── types.ts              # ConversationMessage, ToolCall, ToolResult, ToolSpec, AgentEvent
├── llm-provider.ts       # LLMProvider interface, ProviderDelta, ChatStreamOpts, LLMProviderModel
├── ollama-provider.ts    # OllamaProvider class (real)
├── fake-provider.ts      # FakeProvider class (test fixture)
├── tool-specs.ts         # FILE_TOOL_SPECS: ToolSpec[]
├── tool-dispatcher.ts    # ToolDispatcher class — zod validation + output cap
└── agent-runtime.ts      # AgentRuntime class — the loop

tests/main/agent/
├── tool-specs.test.ts
├── tool-dispatcher.test.ts
├── fake-provider.test.ts
├── ollama-provider.test.ts
└── agent-runtime.test.ts
```

**Boundaries:**
- `types.ts` — pure types, no runtime code, no imports outside Node built-ins.
- `llm-provider.ts` — interface and provider-level types only.
- `*-provider.ts` — implementation per backend; each is independently testable.
- `tool-specs.ts` — pure data; sent to model as Ollama's `tools` array.
- `tool-dispatcher.ts` — runtime side; calls `FileTools` (Plan B) and serializes results.
- `agent-runtime.ts` — orchestration only; depends on `LLMProvider` interface, not on a specific provider.

---

## Conventions

- TS strict, ESM, Conventional Commits.
- Git author: `git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit ...`
- Node 22 PATH prefix for every shell:

  ```bash
  export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH"
  ```
- Test fixture workspaces use `mkdtempSync(join(tmpdir(), 'flowstate-...-'))`, removed in `afterEach`.

---

## Task 1: Public Types

**Files:**
- Create: `src/main/agent/types.ts`

This task adds pure type declarations. No tests needed — TypeScript checks them when downstream code uses them.

- [ ] **Step 1: Write `src/main/agent/types.ts`**

```ts
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];   // assistant only
  toolCallId?: string;      // tool only
  toolName?: string;        // tool only
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object; // raw JSON Schema (Ollama's format)
}

export type AgentEventTurnDoneReason = 'end' | 'max-tools' | 'aborted' | 'error';

export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | { type: 'turn-done'; reason: AgentEventTurnDoneReason; error?: string }
  | { type: 'token-usage'; promptTokens: number; completionTokens: number };
```

- [ ] **Step 2: Typecheck**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npx tsc -p tsconfig.node.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/types.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): add public types for runtime, providers, events"
```

---

## Task 2: LLMProvider interface

**Files:**
- Create: `src/main/agent/llm-provider.ts`

- [ ] **Step 1: Write `src/main/agent/llm-provider.ts`**

```ts
import type { ConversationMessage, ToolSpec } from './types';

export interface LLMProviderModel {
  name: string;
  size?: number;
}

export type ProviderDelta =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name: string; args: unknown; id?: string }
  | { type: 'done'; promptTokens?: number; completionTokens?: number };

export interface ChatStreamOpts {
  model: string;
  messages: ConversationMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export interface LLMProvider {
  chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta>;
  listModels(): Promise<LLMProviderModel[]>;
  isReachable(): Promise<boolean>;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.node.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/llm-provider.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): add LLMProvider interface and ProviderDelta types"
```

---

## Task 3: FILE_TOOL_SPECS

**Files:**
- Create: `src/main/agent/tool-specs.ts`
- Test: `tests/main/agent/tool-specs.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/agent/tool-specs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FILE_TOOL_SPECS } from '@main/agent/tool-specs';

describe('FILE_TOOL_SPECS', () => {
  it('exports an array of 5 tools', () => {
    expect(FILE_TOOL_SPECS).toHaveLength(5);
  });

  it('includes all expected tool names', () => {
    const names = FILE_TOOL_SPECS.map((t) => t.name).sort();
    expect(names).toEqual(['delete_file', 'list_dir', 'read_file', 'search_files', 'write_file']);
  });

  it('every tool has a non-empty description', () => {
    for (const spec of FILE_TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it('every tool has a JSON Schema object parameters field', () => {
    for (const spec of FILE_TOOL_SPECS) {
      expect(spec.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('write_file requires path and content', () => {
    const spec = FILE_TOOL_SPECS.find((t) => t.name === 'write_file');
    expect(spec).toBeDefined();
    const params = spec!.parameters as { required?: string[] };
    expect(params.required).toEqual(expect.arrayContaining(['path', 'content']));
  });

  it('search_files restricts kind to enum', () => {
    const spec = FILE_TOOL_SPECS.find((t) => t.name === 'search_files');
    const params = spec!.parameters as { properties: Record<string, { enum?: string[] }> };
    expect(params.properties.kind?.enum).toEqual(['name', 'content']);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- tests/main/agent/tool-specs.test.ts
```

Expected: `Cannot find module '@main/agent/tool-specs'`.

- [ ] **Step 3: Write `src/main/agent/tool-specs.ts`**

```ts
import type { ToolSpec } from './types';

export const FILE_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file inside the agent workspace. Returns file contents (capped at 100 KB).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path. No leading slash, no ".." traversal.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries in a workspace directory. Returns JSON array of {name, kind}.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "Workspace-relative path. Use '.' for root." },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a UTF-8 file. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file (not a directory). Irreversible.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Search the workspace. kind="name" matches file paths against a glob (e.g. "*.ts" finds files at any depth). kind="content" greps file contents with a regex. Returns up to 200 hits.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        kind: { type: 'string', enum: ['name', 'content'] },
      },
      required: ['pattern', 'kind'],
    },
  },
];
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- tests/main/agent/tool-specs.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/tool-specs.ts tests/main/agent/tool-specs.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): add FILE_TOOL_SPECS with JSON Schema for 5 file tools"
```

---

## Task 4: ToolDispatcher

**Files:**
- Create: `src/main/agent/tool-dispatcher.ts`
- Test: `tests/main/agent/tool-dispatcher.test.ts`

- [ ] **Step 1: Write failing test**

`tests/main/agent/tool-dispatcher.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools';
import { ToolDispatcher, MAX_TOOL_OUTPUT_BYTES } from '@main/agent/tool-dispatcher';

let workspace: string;
let tools: FileTools;
let dispatcher: ToolDispatcher;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-disp-'));
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'world');
  tools = new FileTools(workspace);
  dispatcher = new ToolDispatcher(tools);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('ToolDispatcher.call — happy paths', () => {
  it('read_file returns content', async () => {
    const r = await dispatcher.call('id1', 'read_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('hello');
    expect(r.toolCallId).toBe('id1');
    expect(r.toolName).toBe('read_file');
  });

  it('list_dir returns JSON array of entries', async () => {
    const r = await dispatcher.call('id2', 'list_dir', { path: '.' });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(r.content) as Array<{ name: string; kind: string }>;
    const names = parsed.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'sub']);
  });

  it('write_file creates a file', async () => {
    const r = await dispatcher.call('id3', 'write_file', {
      path: 'new.txt',
      content: 'hi',
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toEqual({ created: true });
  });

  it('delete_file removes a file', async () => {
    const r = await dispatcher.call('id4', 'delete_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('ok');
  });

  it('search_files name mode returns hits as JSON', async () => {
    const r = await dispatcher.call('id5', 'search_files', {
      pattern: '*.txt',
      kind: 'name',
    });
    expect(r.ok).toBe(true);
    const hits = JSON.parse(r.content) as Array<{ path: string }>;
    expect(hits.map((h) => h.path).sort()).toEqual(['a.txt', 'sub/b.txt']);
  });
});

describe('ToolDispatcher.call — failures (returned, not thrown)', () => {
  it('unknown tool returns ok=false', async () => {
    const r = await dispatcher.call('x', 'nope_tool', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/unknown tool/);
  });

  it('missing required arg returns ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('wrong arg type returns ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: 42 });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('invalid enum value for search_files.kind returns ok=false', async () => {
    const r = await dispatcher.call('x', 'search_files', {
      pattern: '*',
      kind: 'bogus',
    });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('FileTools error (e.g. ENOENT) returned as ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: 'missing.txt' });
    expect(r.ok).toBe(false);
    expect(r.content.length).toBeGreaterThan(0);
  });

  it('sandbox violation returned as ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: '../escape' });
    expect(r.ok).toBe(false);
  });
});

describe('ToolDispatcher.call — output cap', () => {
  it('truncates read_file output above MAX_TOOL_OUTPUT_BYTES', async () => {
    const big = 'a'.repeat(MAX_TOOL_OUTPUT_BYTES + 50_000);
    writeFileSync(join(workspace, 'big.txt'), big);
    const r = await dispatcher.call('x', 'read_file', { path: 'big.txt' });
    expect(r.ok).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES + 200);
    expect(r.content).toMatch(/truncated/);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/agent/tool-dispatcher.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/agent/tool-dispatcher.ts`**

```ts
import { z } from 'zod';
import type { FileTools } from '@main/tools';
import type { ToolResult } from './types';

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

export class ToolDispatcher {
  constructor(private readonly fileTools: FileTools) {}

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

    try {
      switch (name) {
        case 'read_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.read_file>;
          const content = await this.fileTools.readFile(a.path);
          return ok(toolCallId, name, content);
        }
        case 'list_dir': {
          const a = parsed.data as z.infer<typeof argsSchemas.list_dir>;
          const entries = await this.fileTools.listDir(a.path);
          return ok(toolCallId, name, JSON.stringify(entries));
        }
        case 'write_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.write_file>;
          const result = await this.fileTools.writeFile(a.path, a.content);
          return ok(toolCallId, name, JSON.stringify(result));
        }
        case 'delete_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.delete_file>;
          await this.fileTools.deleteFile(a.path);
          return ok(toolCallId, name, 'ok');
        }
        case 'search_files': {
          const a = parsed.data as z.infer<typeof argsSchemas.search_files>;
          const hits = await this.fileTools.searchFiles({
            pattern: a.pattern,
            kind: a.kind,
          });
          return ok(toolCallId, name, JSON.stringify(hits));
        }
      }
    } catch (err) {
      return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
    }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/main/agent/tool-dispatcher.test.ts
```

Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/tool-dispatcher.ts tests/main/agent/tool-dispatcher.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): ToolDispatcher with zod validation and 100KB output cap"
```

---

## Task 5: FakeProvider

**Files:**
- Create: `src/main/agent/fake-provider.ts`
- Test: `tests/main/agent/fake-provider.test.ts`

`FakeProvider` is a test fixture that emits a scripted sequence of `ProviderDelta`s. Each `chatStream()` call advances through the script until a `done` is emitted, then returns. Subsequent calls continue from the next item.

- [ ] **Step 1: Write failing test**

`tests/main/agent/fake-provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeProvider } from '@main/agent/fake-provider';
import type { ProviderDelta } from '@main/agent/llm-provider';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

const opts = { model: 'fake', messages: [], tools: [] };

describe('FakeProvider', () => {
  it('yields a text + done sequence on first call', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'hi' },
      { type: 'done', promptTokens: 1, completionTokens: 2 },
    ]);
    const events = await collect(p.chatStream(opts));
    expect(events).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'done', promptTokens: 1, completionTokens: 2 },
    ]);
  });

  it('advances to next done across multiple calls', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'turn1' },
      { type: 'done' },
      { type: 'text', text: 'turn2' },
      { type: 'done' },
    ]);
    const turn1 = await collect(p.chatStream(opts));
    const turn2 = await collect(p.chatStream(opts));
    expect(turn1.map((e) => e.type)).toEqual(['text', 'done']);
    expect(turn2.map((e) => e.type)).toEqual(['text', 'done']);
    if (turn2[0]?.type === 'text') expect(turn2[0].text).toBe('turn2');
  });

  it('throws if script runs out', async () => {
    const p = new FakeProvider([{ type: 'done' }]);
    await collect(p.chatStream(opts));
    await expect(collect(p.chatStream(opts))).rejects.toThrow(/script exhausted/);
  });

  it('listModels returns the provided fake models', async () => {
    const p = new FakeProvider([], { models: [{ name: 'fake-coder:1b' }] });
    expect(await p.listModels()).toEqual([{ name: 'fake-coder:1b' }]);
  });

  it('isReachable defaults to true', async () => {
    const p = new FakeProvider([]);
    expect(await p.isReachable()).toBe(true);
  });

  it('emits tool-call deltas verbatim', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'reading' },
      { type: 'tool-call', name: 'read_file', args: { path: 'x' }, id: 'c1' },
      { type: 'done' },
    ]);
    const events = await collect(p.chatStream(opts));
    const calls = events.filter((e: ProviderDelta) => e.type === 'tool-call');
    expect(calls).toHaveLength(1);
  });

  it('respects abort signal', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'done' },
    ]);
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(p.chatStream({ ...opts, signal: ctrl.signal }));
    // when aborted before first iteration, FakeProvider returns no events
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/agent/fake-provider.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/agent/fake-provider.ts`**

```ts
import type {
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
} from './llm-provider';

export interface FakeProviderOptions {
  models?: LLMProviderModel[];
  reachable?: boolean;
}

export class FakeProvider implements LLMProvider {
  private cursor = 0;
  private readonly models: LLMProviderModel[];
  private readonly reachable: boolean;

  constructor(
    private readonly script: ProviderDelta[],
    opts: FakeProviderOptions = {},
  ) {
    this.models = opts.models ?? [{ name: 'fake-model:1b' }];
    this.reachable = opts.reachable ?? true;
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    if (opts.signal?.aborted) return;

    if (this.cursor >= this.script.length) {
      throw new Error('FakeProvider script exhausted');
    }

    while (this.cursor < this.script.length) {
      if (opts.signal?.aborted) return;
      const item = this.script[this.cursor]!;
      this.cursor += 1;
      yield item;
      if (item.type === 'done') return;
    }
  }

  async listModels(): Promise<LLMProviderModel[]> {
    return this.models;
  }

  async isReachable(): Promise<boolean> {
    return this.reachable;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/main/agent/fake-provider.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/fake-provider.ts tests/main/agent/fake-provider.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): FakeProvider for deterministic runtime tests"
```

---

## Task 6: OllamaProvider (real, against mocked fetch)

**Files:**
- Create: `src/main/agent/ollama-provider.ts`
- Test: `tests/main/agent/ollama-provider.test.ts`

`OllamaProvider` hits Ollama's HTTP API directly: `POST /api/chat` with `stream: true` returns ND-JSON, `GET /api/tags` lists pulled models. We don't use the `ollama` npm package's high-level client because we want explicit control over abort + streaming.

Ollama's chat ND-JSON shape per chunk:

```json
{"model":"qwen2.5-coder:14b","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"...","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"read_file","arguments":{"path":"a.txt"}}}]},"done":false}
{"model":"...","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":42,"eval_count":15}
```

- [ ] **Step 1: Write failing test**

`tests/main/agent/ollama-provider.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '@main/agent/ollama-provider';
import type { ProviderDelta } from '@main/agent/llm-provider';

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(enc.encode(line + '\n'));
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

const baseOpts = {
  model: 'qwen2.5-coder:14b',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
};

describe('OllamaProvider.chatStream', () => {
  it('parses text deltas across chunks and emits done', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        ndjsonStream([
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: 'Hello' },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: ' world' },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: '' },
            done: true,
            prompt_eval_count: 5,
            eval_count: 2,
          }),
        ]),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const events = await collect(p.chatStream(baseOpts));
    expect(events).toEqual<ProviderDelta[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', promptTokens: 5, completionTokens: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('extracts tool_calls from a message chunk', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        ndjsonStream([
          JSON.stringify({
            model: 'm',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                { function: { name: 'read_file', arguments: { path: 'a.txt' } } },
              ],
            },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: '' },
            done: true,
          }),
        ]),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const events = await collect(p.chatStream(baseOpts));
    const calls = events.filter((e) => e.type === 'tool-call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: 'tool-call',
      name: 'read_file',
      args: { path: 'a.txt' },
    });
    if (calls[0]?.type === 'tool-call') {
      expect(typeof calls[0].id).toBe('string');
      expect(calls[0].id?.length).toBeGreaterThan(0);
    }
  });

  it('throws on HTTP non-200', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/500/);
  });

  it('throws if response body is missing', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/body/);
  });

  it('ignores malformed JSON lines and continues parsing', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        ndjsonStream([
          '{not valid json',
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: 'ok' },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: '' },
            done: true,
          }),
        ]),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const events = await collect(p.chatStream(baseOpts));
    expect(events.find((e) => e.type === 'text' && e.text === 'ok')).toBeDefined();
  });

  it('passes signal to fetch', async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          ndjsonStream([
            JSON.stringify({
              model: 'm',
              message: { role: 'assistant', content: '' },
              done: true,
            }),
          ]),
          { status: 200 },
        ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const ctrl = new AbortController();
    await collect(p.chatStream({ ...baseOpts, signal: ctrl.signal }));
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(ctrl.signal);
  });
});

describe('OllamaProvider.listModels and isReachable', () => {
  it('listModels parses /api/tags', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: 'qwen2.5-coder:14b', size: 9_000_000_000 },
            { name: 'llama3.1:8b', size: 5_000_000_000 },
          ],
        }),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const ms = await p.listModels();
    expect(ms.map((m) => m.name)).toEqual(['qwen2.5-coder:14b', 'llama3.1:8b']);
  });

  it('isReachable returns true on /api/version 200', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 }),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    expect(await p.isReachable()).toBe(true);
  });

  it('isReachable returns false on fetch throw', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    expect(await p.isReachable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/agent/ollama-provider.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/agent/ollama-provider.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type {
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
} from './llm-provider';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface OllamaToolCallChunk {
  function?: { name?: string; arguments?: unknown };
}

interface OllamaChatChunk {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCallChunk[];
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; size?: number }>;
}

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly host: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    const body = {
      model: opts.model,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.args },
              })),
            }
          : {}),
        ...(m.toolName ? { tool_name: m.toolName } : {}),
      })),
      stream: true,
      tools: opts.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    };

    const res = await this.fetchFn(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama chat HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error('Ollama chat response had no body');
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;

          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(line) as OllamaChatChunk;
          } catch {
            continue; // ignore malformed line, keep streaming
          }

          const text = chunk.message?.content ?? '';
          if (text.length > 0) {
            yield { type: 'text', text };
          }
          const tools = chunk.message?.tool_calls;
          if (tools && tools.length > 0) {
            for (const tc of tools) {
              const name = tc.function?.name;
              if (!name) continue;
              const args = tc.function?.arguments;
              yield { type: 'tool-call', name, args, id: randomUUID() };
            }
          }
          if (chunk.done) {
            yield {
              type: 'done',
              ...(chunk.prompt_eval_count !== undefined
                ? { promptTokens: chunk.prompt_eval_count }
                : {}),
              ...(chunk.eval_count !== undefined
                ? { completionTokens: chunk.eval_count }
                : {}),
            };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<LLMProviderModel[]> {
    const res = await this.fetchFn(`${this.host}/api/tags`, { method: 'GET' });
    if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
    const body = (await res.json()) as OllamaTagsResponse;
    return (body.models ?? []).map((m) => ({ name: m.name, size: m.size }));
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.host}/api/version`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- tests/main/agent/ollama-provider.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/ollama-provider.ts tests/main/agent/ollama-provider.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): OllamaProvider streams /api/chat ND-JSON, parses tool_calls"
```

---

## Task 7: AgentRuntime — the loop

**Files:**
- Create: `src/main/agent/agent-runtime.ts`
- Test: `tests/main/agent/agent-runtime.test.ts`

This is the biggest file. The loop, error handling, history rollback, max-tools cap.

- [ ] **Step 1: Write failing test**

`tests/main/agent/agent-runtime.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools';
import { AgentRuntime } from '@main/agent/agent-runtime';
import { ToolDispatcher } from '@main/agent/tool-dispatcher';
import { FakeProvider } from '@main/agent/fake-provider';
import { FILE_TOOL_SPECS } from '@main/agent/tool-specs';
import type { AgentEvent } from '@main/agent/types';
import type { ProviderDelta } from '@main/agent/llm-provider';

let workspace: string;
let tools: FileTools;
let dispatcher: ToolDispatcher;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-runtime-'));
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  tools = new FileTools(workspace);
  dispatcher = new ToolDispatcher(tools);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

function build(script: ProviderDelta[]): AgentRuntime {
  return new AgentRuntime({
    provider: new FakeProvider(script),
    model: 'fake',
    systemPrompt: 'you are a helpful test agent',
    tools: FILE_TOOL_SPECS,
    dispatcher,
  });
}

describe('AgentRuntime — single text turn', () => {
  it('emits text-delta events and a turn-done end', async () => {
    const rt = build([
      { type: 'text', text: 'Hi ' },
      { type: 'text', text: 'there' },
      { type: 'done' },
    ]);
    const events = await collect(rt.send('hello'));
    expect(events.map((e) => e.type)).toEqual(['text-delta', 'text-delta', 'turn-done']);
    expect(events[2]).toMatchObject({ type: 'turn-done', reason: 'end' });
    const history = rt.getHistory();
    // system, user, assistant
    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(history[2]?.content).toBe('Hi there');
  });
});

describe('AgentRuntime — one tool call success', () => {
  it('runs read_file then continues to a final assistant message', async () => {
    const rt = build([
      // turn 1: emit tool call
      { type: 'tool-call', name: 'read_file', args: { path: 'a.txt' }, id: 'c1' },
      { type: 'done' },
      // turn 2: model has tool result, emits final text
      { type: 'text', text: 'File says hello' },
      { type: 'done' },
    ]);
    const events = await collect(rt.send('read it'));
    const types = events.map((e: AgentEvent) => e.type);
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types[types.length - 1]).toBe('turn-done');
    const tr = events.find((e) => e.type === 'tool-result');
    if (tr?.type === 'tool-result') {
      expect(tr.result.ok).toBe(true);
      expect(tr.result.content).toBe('hello');
    }
    const finalText = events.filter((e) => e.type === 'text-delta');
    expect(finalText).toHaveLength(1);
    const history = rt.getHistory();
    // system, user, assistant(toolCalls), tool, assistant
    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
  });
});

describe('AgentRuntime — malformed tool args, model recovers', () => {
  it('feeds failure back, model retries, succeeds', async () => {
    const rt = build([
      // bad args
      { type: 'tool-call', name: 'read_file', args: { wrongKey: 'a.txt' }, id: 'c1' },
      { type: 'done' },
      // retry with correct args
      { type: 'tool-call', name: 'read_file', args: { path: 'a.txt' }, id: 'c2' },
      { type: 'done' },
      // final
      { type: 'text', text: 'done' },
      { type: 'done' },
    ]);
    const events = await collect(rt.send('please retry'));
    const failures = events.filter(
      (e) => e.type === 'tool-result' && !e.result.ok,
    );
    const successes = events.filter(
      (e) => e.type === 'tool-result' && e.result.ok,
    );
    expect(failures).toHaveLength(1);
    expect(successes).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ type: 'turn-done', reason: 'end' });
  });
});

describe('AgentRuntime — max tool calls', () => {
  it('stops at the cap with reason max-tools', async () => {
    const script: ProviderDelta[] = [];
    for (let i = 0; i < 30; i++) {
      script.push({ type: 'tool-call', name: 'list_dir', args: { path: '.' }, id: `c${i}` });
      script.push({ type: 'done' });
    }
    const rt = new AgentRuntime({
      provider: new FakeProvider(script),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
      maxToolCallsPerTurn: 5,
    });
    const events = await collect(rt.send('loop please'));
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'turn-done', reason: 'max-tools' });
    const calls = events.filter((e) => e.type === 'tool-call');
    expect(calls.length).toBe(5);
  });
});

describe('AgentRuntime — provider mid-stream throw', () => {
  it('emits turn-done error and rolls back history', async () => {
    class ThrowingProvider extends FakeProvider {
      async *chatStream(): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'partial' };
        throw new Error('connection reset');
      }
    }
    const rt = new AgentRuntime({
      provider: new ThrowingProvider([]),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
    });
    const before = rt.getHistory().length;
    const events = await collect(rt.send('hi'));
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'turn-done', reason: 'error' });
    if (last?.type === 'turn-done') {
      expect(last.error).toMatch(/connection reset/);
    }
    expect(rt.getHistory().length).toBe(before);
  });
});

describe('AgentRuntime — abort during streaming', () => {
  it('emits turn-done aborted and rolls back history', async () => {
    class SlowProvider extends FakeProvider {
      async *chatStream(opts: {
        signal?: AbortSignal;
      }): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'a' };
        // Simulate awaiting more deltas; abort fires while we wait.
        await new Promise<void>((resolve, reject) => {
          if (opts.signal?.aborted) reject(new Error('AbortError'));
          opts.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        });
      }
    }
    const rt = new AgentRuntime({
      provider: new SlowProvider([]),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
    });
    const ctrl = new AbortController();
    const before = rt.getHistory().length;
    const stream = rt.send('please abort me', ctrl.signal);
    const events: AgentEvent[] = [];
    const reader = (async () => {
      for await (const e of stream) {
        events.push(e);
        if (e.type === 'text-delta') ctrl.abort();
      }
    })();
    await reader;
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'turn-done', reason: 'aborted' });
    expect(rt.getHistory().length).toBe(before);
  });
});

describe('AgentRuntime — empty user message', () => {
  it('rejects synchronously', () => {
    const rt = build([{ type: 'done' }]);
    expect(() => rt.send('')).toThrow(/empty/i);
  });
  it('rejects whitespace-only', () => {
    const rt = build([{ type: 'done' }]);
    expect(() => rt.send('   \n  ')).toThrow(/empty/i);
  });
});

describe('AgentRuntime — history resumption', () => {
  it('starts with provided history visible to provider', async () => {
    const seenMessagesPerTurn: number[] = [];
    class CountingProvider extends FakeProvider {
      async *chatStream(opts: {
        messages: { role: string }[];
      }): AsyncGenerator<ProviderDelta> {
        seenMessagesPerTurn.push(opts.messages.length);
        yield { type: 'text', text: 'k' };
        yield { type: 'done' };
      }
    }
    const rt = new AgentRuntime({
      provider: new CountingProvider([]),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
      history: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'earlier reply' },
      ],
    });
    await collect(rt.send('next'));
    expect(seenMessagesPerTurn[0]).toBe(4); // system, user, assistant, user
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- tests/main/agent/agent-runtime.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `src/main/agent/agent-runtime.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { LLMProvider, ProviderDelta } from './llm-provider';
import type { ToolDispatcher } from './tool-dispatcher';
import type {
  AgentEvent,
  ConversationMessage,
  ToolCall,
  ToolSpec,
} from './types';

export interface AgentRuntimeOpts {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools: ToolSpec[];
  dispatcher: ToolDispatcher;
  maxToolCallsPerTurn?: number;
  history?: ConversationMessage[];
}

const DEFAULT_MAX_TOOL_CALLS = 25;

export class AgentRuntime {
  private history: ConversationMessage[];
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly tools: ToolSpec[];
  private readonly dispatcher: ToolDispatcher;
  private readonly maxToolCallsPerTurn: number;

  constructor(opts: AgentRuntimeOpts) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.tools = opts.tools;
    this.dispatcher = opts.dispatcher;
    this.maxToolCallsPerTurn = opts.maxToolCallsPerTurn ?? DEFAULT_MAX_TOOL_CALLS;
    if (opts.history && opts.history.length > 0) {
      this.history = [...opts.history];
      if (!this.history.some((m) => m.role === 'system')) {
        this.history.unshift({ role: 'system', content: opts.systemPrompt });
      }
    } else {
      this.history = [{ role: 'system', content: opts.systemPrompt }];
    }
  }

  getHistory(): ConversationMessage[] {
    return [...this.history];
  }

  send(userMessage: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (userMessage.trim().length === 0) {
      throw new Error('empty user message');
    }

    const snapshot = [...this.history];
    this.history.push({ role: 'user', content: userMessage });

    return this.runLoop(snapshot, signal);
  }

  private async *runLoop(
    snapshot: ConversationMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    let toolCallsThisTurn = 0;

    try {
      for (;;) {
        if (signal?.aborted) {
          this.history = snapshot;
          yield { type: 'turn-done', reason: 'aborted' };
          return;
        }

        let assistantText = '';
        const pendingCalls: ToolCall[] = [];
        let tokenUsage: { promptTokens?: number; completionTokens?: number } = {};

        const stream = this.provider.chatStream({
          model: this.model,
          messages: this.history,
          tools: this.tools,
          ...(signal ? { signal } : {}),
        });

        for await (const delta of stream as AsyncIterable<ProviderDelta>) {
          if (signal?.aborted) {
            this.history = snapshot;
            yield { type: 'turn-done', reason: 'aborted' };
            return;
          }
          if (delta.type === 'text') {
            assistantText += delta.text;
            yield { type: 'text-delta', text: delta.text };
          } else if (delta.type === 'tool-call') {
            pendingCalls.push({
              id: delta.id ?? randomUUID(),
              name: delta.name,
              args: delta.args,
            });
          } else if (delta.type === 'done') {
            tokenUsage = {
              ...(delta.promptTokens !== undefined ? { promptTokens: delta.promptTokens } : {}),
              ...(delta.completionTokens !== undefined
                ? { completionTokens: delta.completionTokens }
                : {}),
            };
          }
        }

        if (tokenUsage.promptTokens !== undefined || tokenUsage.completionTokens !== undefined) {
          yield {
            type: 'token-usage',
            promptTokens: tokenUsage.promptTokens ?? 0,
            completionTokens: tokenUsage.completionTokens ?? 0,
          };
        }

        if (pendingCalls.length === 0) {
          this.history.push({ role: 'assistant', content: assistantText });
          yield { type: 'turn-done', reason: 'end' };
          return;
        }

        // Push the assistant message that emitted the tool calls.
        this.history.push({
          role: 'assistant',
          content: assistantText,
          toolCalls: pendingCalls,
        });

        for (const call of pendingCalls) {
          if (signal?.aborted) {
            this.history = snapshot;
            yield { type: 'turn-done', reason: 'aborted' };
            return;
          }
          toolCallsThisTurn += 1;
          if (toolCallsThisTurn > this.maxToolCallsPerTurn) {
            yield { type: 'turn-done', reason: 'max-tools' };
            return;
          }
          yield { type: 'tool-call', call };

          const result = await this.dispatcher.call(call.id, call.name, call.args);
          yield { type: 'tool-result', result };
          this.history.push({
            role: 'tool',
            content: result.content,
            toolCallId: call.id,
            toolName: call.name,
          });
        }

        // Loop back: provider gets new messages and continues.
      }
    } catch (err) {
      this.history = snapshot;
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'turn-done', reason: 'error', error: msg };
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- tests/main/agent/agent-runtime.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/main/agent/agent-runtime.ts tests/main/agent/agent-runtime.test.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(agent): AgentRuntime tool-use loop with caps, rollback, abort"
```

---

## Task 8: Full suite + tag

**Files:** none modified

- [ ] **Step 1: Run all tests**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test
```

Expected: ~115 tests across `tests/shared/`, `tests/main/db/`, `tests/main/services/`, `tests/main/tools/`, and the new `tests/main/agent/` (≈ 6 + 12 + 7 + 9 + 9 = 43 new ones plus prior 72).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Update README status**

Read `README.md`, replace the line `⏳ Plan B — Path sandbox + file tools (resolveSafe, FileTools, 52 tests)` with that line followed by `- ✅ Plan C1 — Backend agent runtime (AgentRuntime, OllamaProvider, ToolDispatcher)` and remove the corresponding `⏳` line if any. Adjust the `Plan C — Single-agent runtime + chat UI` line to read `⏳ Plan C2 — Persistence + IPC` and add `⏳ Plan C3 — Chat UI`.

Final Status section should look like:

```markdown
## Status

- ✅ Plan A — Foundation (Electron shell, SQLite, IPC, Ollama health check)
- ✅ Plan B — Path sandbox + file tools (resolveSafe, FileTools, 52 tests)
- ✅ Plan C1 — Backend agent runtime (AgentRuntime, OllamaProvider, ToolDispatcher)
- ⏳ Plan C2 — Persistence + IPC streaming
- ⏳ Plan C3 — Chat UI
- ⏳ Plan D — Multi-agent dashboard
- ⏳ Plan E — Shell tool with approval gate
- ⏳ Plan F — Orchestrator routing
- ⏳ Plan G — Polish
```

- [ ] **Step 5: Commit + tag**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add README.md
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "docs: mark Plan C1 complete in README"
git tag plan-c1-runtime
```

---

## Done Criteria

- All 5 new test files green: `tool-specs`, `tool-dispatcher`, `fake-provider`, `ollama-provider`, `agent-runtime`.
- ~43 new tests passing (≥ that count is fine).
- Full `npm test` reports green for all suites.
- `npm run typecheck` clean.
- `npm run build` succeeds.
- `git tag plan-c1-runtime` exists.
- No real Ollama traffic in tests (the real-Ollama smoke is part of Plan C3 — this plan is fully isolated).

---

## Out of Scope (Plans C2 / C3)

- SQLite migration 002 (`agents`/`chats`/`messages`) — C2.
- ChatRepository — C2.
- Hardcoded Code Helper agent seed — C2.
- IPC channels for chat — C2.
- Chat UI (composer, message stream, tool-call cards) — C3.
- Real Ollama smoke test — C3.
- Token/context summarization — Plan G or later.
- Multi-agent CRUD — Plan D.
