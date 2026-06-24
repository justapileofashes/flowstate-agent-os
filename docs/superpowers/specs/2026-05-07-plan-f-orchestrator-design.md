# Flowstate — Plan F: Orchestrator Routing Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent:** `2026-05-05-ai-agent-dashboard-design.md`
**Depends on:** Plan A, B, C1, C2, C3, D, E

## 1. Concept

Plan F adds the global "Ask anything" input from the dashboard mockup. User types a task; an orchestrator (small Ollama call) reads each agent's name + description + specialty tags + a one-line task summary, picks the best-suited agent, opens that agent's chat with a fresh thread, and posts the user task as the first message — agent then responds normally.

This is the **O3** decision locked in the parent spec: Router + manual override. Manual override = sidebar agent click still bypasses orchestrator entirely. Plan F adds only the routing path.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Orchestrator model | Settings `orchestrator_model`. Default = first installed tool-supporting model that's not too big — preference list `qwen2.5:7b` > `llama3.1:8b` > existing fallback list | Small + fast > smart for routing |
| Orchestrator prompt format | JSON-mode (`format: 'json'` Ollama option). System: "Pick the best agent. Reply ONLY JSON." Returns `{chosen_agent_id, reasoning}` | Reliable structured output |
| Routing granularity | Always returns one agent. Multi-agent dispatch / chains = future | YAGNI |
| New chat or existing? | Always new chat. Title auto-set from first user message (already implemented) | Simpler; user can keep classifier-style routing clean |
| Where input lives | Dashboard top: "Ask anything" textarea + "Route" button. Cmd/Ctrl+Enter submits. **Not** in sidebar header (avoid clutter) | Dashboard is "home" already |
| What happens during orchestrator call | Button shows spinner. Toast or status row shows "Routing…" | Brief; orchestrator typically <2s on 7b |
| Reasoning display | Toast at top right after route decided: "Routed to **<agent>** — <reason>". Auto-dismiss 5s | Lightweight |
| Failure modes | If orchestrator errors / returns invalid JSON / picks unknown id → fall back to first agent + show toast "Auto-routing failed; opened with <first agent>". Don't block user | Graceful degradation |
| No matching agent | Orchestrator picks "best fit" anyway (always returns ID). If only 1 agent exists → skip orchestrator, route directly | Common case fast-path |
| Streaming the routing call | No — single shot, JSON mode, await full response. Cheap (~50-100 tokens) | Simpler |
| New IPC channel | `chat:route` — input `{text}`, output `{agentId, chatId, reasoning}` | Single round-trip |
| Persistence | Orchestrator decision NOT persisted; only the resulting chat (which goes through normal createChat + appendMessage flow) | YAGNI |
| Tests | Orchestrator pure logic (response parsing, fallback) — covered. Real Ollama smoke = manual | Same pattern as C3 |

## 3. Architecture

```
┌──────────────────────────────────────────────────┐
│ Renderer Dashboard                                │
│   <GlobalAskBox>                                  │
│     onSubmit(text):                               │
│       const { agentId, chatId, reasoning } =      │
│         await ipc.chat.route(text);               │
│       toast(reasoning);                           │
│       setView({kind:'chat', agent: <agentId>});   │
│       activeChatId = chatId;                      │
│       stream.send(text);                          │
└────────────────┬─────────────────────────────────┘
                 │ IPC
┌────────────────▼─────────────────────────────────┐
│ Main: chat:route handler                          │
│   1. agents = repo.listAgents()                   │
│   2. if agents.length === 1: skip orchestrator    │
│   3. else: orchestrator.pickAgent(text, agents)   │
│   4. chat = repo.createChat(agentId)              │
│   5. return { agentId, chatId: chat.id,           │
│              reasoning }                          │
└────────────────┬─────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────┐
│ Orchestrator class                                │
│   pickAgent(text, agents): {agentId, reasoning}   │
│     - builds JSON-mode prompt                     │
│     - calls provider non-stream variant           │
│     - parses { chosen_agent_id, reasoning }       │
│     - validates id is in agents list              │
│     - on failure → returns {agents[0].id,         │
│       reasoning: 'fallback ...'}                  │
└──────────────────────────────────────────────────┘
```

### LLMProvider extension

Add a single non-streaming convenience method:

```ts
interface LLMProvider {
  // existing chatStream + listModels + isReachable
  chatOnce(opts: ChatOnceOpts): Promise<{ text: string; toolCalls: ProviderToolCall[] }>;
}

interface ChatOnceOpts {
  model: string;
  messages: ConversationMessage[];
  format?: 'json';
  signal?: AbortSignal;
}
```

`OllamaProvider.chatOnce` calls `/api/chat` with `stream: false` and `format: opts.format` (Ollama supports this), parses single response. Returns text + tool_calls (if any). For orchestrator we ignore toolCalls.

`FakeProvider.chatOnce` — for tests, returns canned response.

## 4. Files

```
src/main/agent/
└── orchestrator.ts                   # NEW

src/main/agent/llm-provider.ts        # MODIFY — add chatOnce + ChatOnceOpts
src/main/agent/ollama-provider.ts     # MODIFY — implement chatOnce
src/main/agent/fake-provider.ts       # MODIFY — implement chatOnce (script-aware)
src/main/services/settings-service.ts # KEEP (already key/value)
src/main/index.ts                     # MODIFY — construct Orchestrator, pass to handlers
src/main/ipc/handlers/chat.ts         # MODIFY — chat:route handler
src/main/ipc/register.ts              # MODIFY — pass orchestrator
src/shared/ipc-channels.ts            # MODIFY — CHAT_ROUTE channel + schemas

src/preload/index.ts                  # MODIFY — chat.route method
src/renderer/src/lib/ipc.ts           # MODIFY — declare same

src/renderer/src/chat/
├── GlobalAskBox.tsx                  # NEW — dashboard input
└── RoutingToast.tsx                  # NEW — slide-in notification

src/renderer/src/screens/Dashboard.tsx # MODIFY — embed GlobalAskBox + toast

tests/main/agent/orchestrator.test.ts  # NEW
tests/main/agent/ollama-provider-once.test.ts # NEW (chatOnce shape)
tests/shared/ipc-channels.test.ts      # MODIFY — chat:route schema cases
```

## 5. Orchestrator API

```ts
// src/main/agent/orchestrator.ts

interface AgentSummary {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
}

export interface RoutingDecision {
  agentId: string;
  reasoning: string;
  fallback: boolean;        // true when orchestrator failed and we picked first agent
}

export class Orchestrator {
  constructor(provider: LLMProvider, model: string);

  async pickAgent(userText: string, agents: AgentSummary[]): Promise<RoutingDecision>;
}
```

### System prompt

```
You are an agent router. Pick exactly ONE agent best suited to handle the user task below.
Reply with valid JSON only — no other text.
Schema: { "chosen_agent_id": "<agent id>", "reasoning": "<one sentence>" }

Available agents:
- id: agent-code-helper, name: Code Helper, description: A focused coding assistant with file tools, specialty: coding, files
- id: researcher-abc, name: Researcher, description: Synthesizes notes, specialty: research, notes
...
```

### User message: `<userText>`

Parse response:
1. Try JSON.parse on trimmed content.
2. Validate `chosen_agent_id` is one of the provided ids.
3. Validate `reasoning` is a non-empty string ≤ 200 chars (truncate if longer).
4. Return `{agentId, reasoning, fallback: false}`.
5. On any failure: `{agentId: agents[0].id, reasoning: 'Auto-routing failed: <reason>. Defaulted to first agent.', fallback: true}`.

## 6. IPC

`CHAT_ROUTE: 'chat:route'`

Request: `{ text: string }` (min 1 char)
Response:

```ts
{
  agentId: string;
  chatId: string;
  reasoning: string;
  fallback: boolean;
}
```

Handler:

```ts
ipcMain.handle(CHANNELS.CHAT_ROUTE, async (_e, raw) => {
  const { text } = schemas.chatRouteRequest.parse(raw);
  const agents = deps.repo.listAgents();
  if (agents.length === 0) throw new Error('no agents available');
  let decision: RoutingDecision;
  if (agents.length === 1) {
    decision = { agentId: agents[0]!.id, reasoning: 'Only one agent available.', fallback: false };
  } else {
    decision = await deps.orchestrator.pickAgent(text, agents.map((a) => ({
      id: a.id, name: a.name, description: a.description, specialtyTags: a.specialtyTags,
    })));
  }
  const chat = deps.repo.createChat(decision.agentId);
  return { agentId: decision.agentId, chatId: chat.id, reasoning: decision.reasoning, fallback: decision.fallback };
});
```

## 7. Renderer

### GlobalAskBox

```tsx
interface Props {
  onRouted: (agentId: string, chatId: string, text: string, reasoning: string, fallback: boolean) => void;
}
```

Layout: textarea + "Route" button (primary). Disabled while routing. Status row beneath shows "Routing…" with spinner.

### Dashboard integration

Above the agent grid:

```
┌──────────────────────────────────────────────────┐
│ Ask anything                                      │
│ ┌──────────────────────────────────────────────┐ │
│ │ Build me a todo list app                     │ │
│ └──────────────────────────────────────────────┘ │
│                              [Route] [Cmd+Enter] │
└──────────────────────────────────────────────────┘
```

After routing succeeds, App.tsx receives `(agentId, chatId, text)`, switches view to that agent's Chat with that chatId pre-selected, and Chat.tsx auto-posts `text` via `stream.send(text)`.

### RoutingToast

Slide in from top-right. Dismiss after 5s or on click. Shows agent name + reasoning. Red border if `fallback: true`.

### App.tsx routing wiring

App.tsx adds:

```ts
const [pendingChat, setPendingChat] = useState<{ agentId: string; chatId: string; firstMessage: string } | null>(null);

function handleRouted(agentId: string, chatId: string, text: string, reasoning: string, fallback: boolean): void {
  setToast({ agentName: agents.find(a => a.id === agentId)!.name, reasoning, fallback });
  const agent = agents.find(a => a.id === agentId)!;
  setView({ kind: 'chat', agent });
  setPendingChat({ agentId, chatId, firstMessage: text });
}
```

Chat.tsx accepts `pendingChat?: { chatId; firstMessage }`. On mount/change, if set, selects that chat and calls `stream.send(firstMessage)` once. Then clears pendingChat.

## 8. Settings

Add settings key `orchestrator_model` (string). Default chosen at app startup using same fallback algorithm as Plan C3 — first tool-supporting model installed locally. User can change via Settings screen later (Plan G polish, NOT required in F — for v1, no UI for it; just settings table).

## 9. Test Strategy

**`orchestrator.test.ts`** (~8 tests, FakeProvider):
- Returns chosen agent on valid JSON
- Truncates over-long reasoning to 200 chars
- Falls back on invalid JSON
- Falls back on unknown agent id
- Falls back on missing fields
- Single-agent path returns directly without provider call (handled at handler level — but orchestrator can also test it; we test handler logic separately)
- Sends a system prompt containing all agent ids
- Includes user text as the user message

**`ollama-provider-once.test.ts`** (~3 tests, mocked fetch):
- Sends `stream: false`, `format: 'json'` to `/api/chat`
- Parses single response message.content
- Throws on HTTP error

**`tests/shared/ipc-channels.test.ts`** — append cases for `chat:route`.

**No renderer unit tests.** Manual smoke covers UX.

## 10. Manual smoke test

1. Start app with 2+ agents (create one via dashboard if needed, e.g. "Researcher" with description "Reads papers, summarizes notes" and tags "research, notes").
2. On dashboard, type "explain what files are in this folder" in Ask anything box. Press Ctrl+Enter.
3. Routing toast appears: "Routed to **Code Helper** — task involves files."
4. View switches to Code Helper chat with new chat selected. Message posted. Stream begins.
5. Type "summarize the README" — expect Code Helper again.
6. Type "what is the meaning of life" — expect Researcher (or Code Helper as fallback if model misbehaves).
7. With only 1 agent in DB: typing should skip orchestrator. Toast says "Only one agent available." Chat opens.
8. Stop Ollama → type → expect fallback toast with red border + Code Helper opens.

## 11. Out of Scope (Plan G)

- Settings UI for orchestrator_model — Plan G.
- Multi-agent chains / handoff — future.
- Routing into existing chats (always new for v1).
- Conversation memory shared across orchestrator invocations.
- Confidence scores or "ask user to pick if low confidence" — future.

## 12. Resolved Decisions

- Single agent → bypass orchestrator (fast path).
- Orchestrator output: structured JSON via Ollama `format: 'json'`.
- Default orchestrator model = first available tool-supporting model (reuse fallback list).
- Routing always creates new chat.
- Reasoning is for display only; not persisted.
- Failures degrade to first-agent fallback with visible toast (red border).
