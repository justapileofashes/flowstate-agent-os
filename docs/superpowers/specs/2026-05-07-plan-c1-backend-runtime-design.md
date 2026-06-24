# Flowstate — Plan C1: Backend Runtime Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent project:** Flowstate (see `2026-05-05-ai-agent-dashboard-design.md`)

## 1. Concept

Plan C of Flowstate splits into three sub-plans:

- **C1 — Backend runtime** (this spec): `LLMProvider` interface, `OllamaProvider`, `AgentRuntime` class with tool-use loop, `ToolDispatcher` wrapping `FileTools`. No UI, no DB, no IPC. Fully unit-testable with a `FakeProvider`.
- **C2 — Persistence + IPC**: migration 002 for `agents`/`chats`/`messages` tables, `ChatRepository`, IPC streaming channels.
- **C3 — Chat UI**: chat screen, streaming token render, tool-use cards, sidebar nav.

C1 ships the riskiest core (open-weight model tool-use reliability) in isolation. If it works against a real local Ollama in manual smoke testing, C2 and C3 build on a proven base.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Agent count in Plan C | One hardcoded "Code Helper" agent (multi-agent CRUD = Plan D) | Smallest demoable cycle; isolate runtime risk before investing in CRUD |
| Tool-use mechanism | Native Ollama `tools` parameter (OpenAI-compatible) | Cleaner than prompt-engineered JSON; default model `qwen2.5-coder:14b` supports it |
| Model availability | User-managed (`ollama pull` themselves; app errors clearly if missing) | Plan C focus = runtime, not download UX. M2 puller deferred to Plan G polish |
| Output validation | zod schemas inside `ToolDispatcher` | Belt-and-suspenders on top of Ollama's parser; validated args always reach `FileTools` |
| Tool output size cap | 100 KB per tool result, truncated with marker | Prevents context blow-up from `read_file` on large files |
| Tool calls per turn | Hard cap 25, then `turn-done max-tools` | Prevents runaway loops; resets per user message |
| History rollback | On `error`/`aborted`, restore pre-turn snapshot | Failed turns don't poison subsequent retries |

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│ AgentRuntime                                        │
│   send(userMessage, abort?) → AsyncIterable<Event>  │
│   getHistory() → ConversationMessage[]              │
│   - history, tools, systemPrompt, toolCallsThisTurn │
└────┬────────────────────────────────────────────────┘
     │ uses
┌────▼────────────────────────────────────────────────┐
│ LLMProvider                                          │
│   chatStream(opts) → AsyncIterable<ProviderDelta>    │
│   listModels() → Model[]                             │
│   isReachable() → boolean                            │
└────┬────────────────────────────────────────────────┘
     │ implementations
┌────▼──────────────┐    ┌──────────────────┐
│ OllamaProvider    │    │ FakeProvider     │
│ HTTP → :11434     │    │ Test-only        │
└───────────────────┘    └──────────────────┘

┌─────────────────────────────────────────────────────┐
│ ToolDispatcher                                       │
│   call(id, name, rawArgs) → ToolResult               │
│   - zod validates args                               │
│   - routes to FileTools (Plan B)                     │
│   - serializes errors as ok=false ToolResult         │
│   - caps output at 100 KB                            │
└─────────────────────────────────────────────────────┘
```

### Files

```
src/main/agent/
├── types.ts              # ConversationMessage, AgentEvent, ToolCall, etc.
├── llm-provider.ts       # LLMProvider interface + ProviderDelta types
├── ollama-provider.ts    # OllamaProvider (real)
├── fake-provider.ts      # FakeProvider (tests)
├── tool-specs.ts         # FILE_TOOL_SPECS — static JSON Schema array
├── tool-dispatcher.ts    # ToolDispatcher class
└── agent-runtime.ts      # AgentRuntime class

tests/main/agent/
├── tool-specs.test.ts
├── tool-dispatcher.test.ts
├── fake-provider.test.ts
├── ollama-provider.test.ts
└── agent-runtime.test.ts
```

## 4. Public Types

```ts
// src/main/agent/types.ts
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];   // assistant role only
  toolCallId?: string;      // tool role only
  toolName?: string;        // tool role only
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
  content: string;          // serialized result OR error message
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object;       // raw JSON Schema (Ollama's format)
}

export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | { type: 'turn-done'; reason: 'end' | 'max-tools' | 'aborted' | 'error'; error?: string }
  | { type: 'token-usage'; promptTokens: number; completionTokens: number };
```

```ts
// src/main/agent/llm-provider.ts
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

## 5. AgentRuntime Loop Semantics

```
1. Snapshot history (for rollback).
2. Append user message to history. Reset toolCallsThisTurn = 0.
3. Loop:
   a. Call provider.chatStream(history + tools).
   b. Buffer assistant text + tool calls from provider deltas.
      Emit 'text-delta' events as they arrive.
   c. On provider 'done':
      - If no tool calls:
          push assistant message; emit 'turn-done' end; BREAK.
      - Else:
          push assistant message with toolCalls; for each call:
            increment toolCallsThisTurn; if > max → emit 'turn-done' max-tools; BREAK.
            emit 'tool-call' event.
            await dispatcher.call(...). emit 'tool-result' event. push tool message.
          GOTO 3a.
4. On provider/dispatcher throw → emit 'turn-done' error, history := snapshot.
5. On signal.aborted → emit 'turn-done' aborted, history := snapshot.
```

### Error matrix

| Failure | Behavior |
|---|---|
| Malformed tool args (zod fail in dispatcher) | `tool-result { ok: false }` fed back to model. Counts toward `toolCallsThisTurn`. Model gets to retry. |
| Provider HTTP error mid-stream | `turn-done error`. History rolled back. |
| Dispatcher unexpected throw | Same as zod fail: `tool-result { ok: false }` so model can recover. |
| Tool calls > max | `turn-done max-tools`. History keeps emissions up to that point (no rollback — partial work is real). |
| Abort signal | `turn-done aborted`. History rolled back. |
| Unknown tool name | `tool-result { ok: false, content: "unknown tool: <name>" }`. |

## 6. Tool Surface (v1)

| Tool | Behavior | Backed by |
|---|---|---|
| `read_file(path)` | Returns UTF-8 contents, capped at 100 KB | `FileTools.readFile` |
| `list_dir(path)` | JSON array of `{name, kind}` | `FileTools.listDir` |
| `write_file(path, content)` | Creates or overwrites, parent dirs auto-created | `FileTools.writeFile` |
| `delete_file(path)` | Files only, refuses dirs | `FileTools.deleteFile` |
| `search_files({pattern, kind})` | `kind: 'name' \| 'content'`, max 200 hits | `FileTools.searchFiles` |

All paths are workspace-relative; sandbox enforced by `FileTools` (Plan B).

`tool-specs.ts` exports `FILE_TOOL_SPECS: ToolSpec[]` — static JSON Schema fed to Ollama's `tools` parameter.
`tool-dispatcher.ts` exports `ToolDispatcher` with internal zod schemas matching the JSON Schemas, validating model output before invoking `FileTools`.

## 7. Test Strategy

**FakeProvider:** constructor takes a flat script of `{kind: 'text'|'tool-call'|'done', ...}` items. Each `chatStream(opts)` call advances through items until the next `done`, then yields. Lets `AgentRuntime` be tested deterministically without a real LLM.

**Test files** (~50 tests):

- `tool-specs.test.ts` — JSON Schema sanity, all required fields present.
- `tool-dispatcher.test.ts` — per-tool happy + bad-args, output truncation at 100 KB, unknown tool name. Real `FileTools` against `mkdtempSync` workspace.
- `fake-provider.test.ts` — script consumption correctness.
- `ollama-provider.test.ts` — mocked `fetch` with canned ND-JSON. Verify: text deltas, tool_call extraction from `message.tool_calls`, done flag, abort propagation, HTTP error throw.
- `agent-runtime.test.ts` — 9+ cases:
  1. Single text turn
  2. One tool call → success → final text
  3. Malformed args → retry → success
  4. Max tool calls exceeded
  5. Provider mid-stream throw → error + rollback
  6. Abort during streaming
  7. Dispatcher failure recoverable
  8. Empty user message rejected synchronously
  9. History resumption

**Coverage targets:** `agent-runtime.ts` ~95% (it IS the loop logic). Others ~85%.

**Real Ollama smoke** deferred to Plan C3 manual test. C1 ends with all tests green.

## 8. Out of Scope (Plan C2 / C3)

- SQLite migration 002 (`agents`/`chats`/`messages` tables) — C2.
- IPC channels for chat send/stream — C2.
- Hardcoded "Code Helper" agent seed — C2.
- Chat UI screen, message stream rendering, composer — C3.
- Manual smoke against real Ollama with real model — C3.
- Token/context window summarization — Plan G or later.
- Per-message token counts in UI — C3.
- Streaming throttling (50ms/500-char batching) — C3 (it's a renderer concern).

## 9. Open Questions

- None at spec time. (Future: should AgentRuntime emit a `tool-call-pending` event before invoking dispatcher to let UI show "running…" state? Defer to C3 if UI needs it — current `tool-call` event already fires before `tool-result`, which UI can use as the "pending" signal.)
