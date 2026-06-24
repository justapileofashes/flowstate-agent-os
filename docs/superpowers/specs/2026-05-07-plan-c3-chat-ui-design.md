# Flowstate — Plan C3: Chat UI Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent:** `2026-05-05-ai-agent-dashboard-design.md`
**Depends on:** Plan A (Foundation), Plan B (FileTools), Plan C1 (Backend runtime), Plan C2 (Persistence + IPC)

## 1. Concept

Plan C3 ships the renderer chat experience: pick the Code Helper agent in a sidebar, browse/create chats, send messages, watch tool calls execute in real time. After C3 the app is end-to-end usable against a real local Ollama. UI matches the Anthropic-inspired palette established in Plan A polish.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| App shell layout | Left sidebar (256px) with **Agents** list + **Settings** link, main area = active screen | Standard chat-app pattern; scales to multi-agent in Plan D |
| Routing | Lightweight in-memory `view` state in App.tsx (no react-router for v1) | YAGNI — single window, two screens (Settings, Chat) |
| Chat layout | Left rail = chat list for selected agent + "New chat" button; main = message thread + composer | Familiar (Claude.ai, ChatGPT pattern) |
| Tool call render | **Collapsed by default** card showing `{tool_name}({arg-summary})`; click to expand args + result | Best signal-to-noise; user can drill in when curious |
| Streaming throttle | 50ms batched flush in renderer (collect deltas in ref, flush via `setInterval`) | Avoids React re-render storm during fast token streams |
| Composer | Multiline textarea, **Cmd/Ctrl+Enter** submits, Shift+Enter newline | Standard; no slash commands in v1 |
| Stop button | Visible while a stream is active; calls `chat:abort` IPC | Spec section 6 essential feature |
| Empty states | "No chats yet — start one" CTA in chat list; "Pick a chat or start a new one" in main when no chat selected | Onboarding clarity |
| Markdown rendering | None in v1 — plain text in `<pre>` for code-likely content, normal `<div>` otherwise. Real markdown render = Plan G polish | YAGNI; tool output already JSON-stringified |
| Auto-scroll | Pin to bottom on new message UNLESS user scrolled up; resume on send | Prevents content jumping while user reads |
| Manual smoke test | Plan task: pull `qwen2.5-coder:14b` (user), launch app, send "list this folder", verify tool-call card + result | Validates tool-use loop end-to-end against real model |
| New deps | None | All UI built with existing Tailwind + Framer Motion (already installed in Plan A) |

## 3. Architecture

```
src/renderer/src/
├── App.tsx                          # MODIFY — sidebar shell + view switcher (settings|chat)
├── lib/
│   ├── ipc.ts                       # MODIFY — add chat methods + stream subscription helper
│   └── chat-stream.ts               # NEW — wraps IPC event subscription as AsyncIterable for components
├── screens/
│   ├── Settings.tsx                 # KEEP — existing
│   └── Chat.tsx                     # NEW — chat screen orchestrator
├── chat/                            # NEW — chat screen sub-components
│   ├── ChatSidebar.tsx              # left rail: chat list + new-chat button
│   ├── MessageList.tsx              # scrollable thread, auto-scroll behavior
│   ├── Message.tsx                  # one rendered message (user/assistant/tool)
│   ├── ToolCallCard.tsx             # collapsible tool-call display
│   ├── Composer.tsx                 # textarea + send/stop buttons
│   └── EmptyChatState.tsx           # placeholder when no chat selected
└── store/                           # NEW — light state holders (no Redux)
    └── chat-store.ts                # zustand-style holder for active chat, messages, stream state
```

**State approach:** plain React `useState` + `useReducer` in `Chat.tsx` for chat-scoped state. A small custom hook (`useChatStream`) handles IPC subscription. **No new state library** — zustand was installed in Plan A but we don't need it for one screen with no cross-cutting state.

## 4. Sidebar shell (App.tsx)

```
┌────────────┬──────────────────────────────┐
│ Flowstate  │                              │
│            │                              │
│ AGENTS     │                              │
│  ◉ Code    │   <active screen>            │
│    Helper  │                              │
│            │                              │
│ Settings   │                              │
│            │                              │
│ v0.0.1     │                              │
└────────────┴──────────────────────────────┘
```

- 256px fixed sidebar, surface bg.
- "AGENTS" section header (uppercase, muted).
- Each agent = button row with the orange "F"-style avatar (use first letter of name) + name. Active row highlighted with accent-soft bg + accent left border.
- "Settings" link below.
- Footer: version pill.

Click an agent → main switches to `Chat` screen with that agent's id. Click Settings → main switches to existing `Settings` screen.

Default view on app open: Code Helper chat (the only agent in C2).

## 5. Chat screen layout

```
┌──────────────────┬─────────────────────────────────┐
│ CHATS  [+ New]   │ ╔══ Code Helper ══════════════╗ │
│                  │ ║ list this folder            ║ │
│  Active title 1  │ ║                             ║ │
│  earlier title 2 │ ║ I'll list the workspace.    ║ │
│  another...      │ ║ ┌─────────────────────────┐ ║ │
│                  │ ║ │ ▸ list_dir(".")         │ ║ │
│                  │ ║ └─────────────────────────┘ ║ │
│                  │ ║                             ║ │
│                  │ ║ Found 3 entries: ...        ║ │
│                  │ ╚═════════════════════════════╝ │
│                  │ ┌─────────────────────────────┐ │
│                  │ │ Type a message…       [⏎]   │ │
│                  │ └─────────────────────────────┘ │
└──────────────────┴─────────────────────────────────┘
```

**Left rail** (220px):
- Header row: "CHATS" + "+ New" button
- Each chat row: title (truncate), faint timestamp; active row has accent-soft bg
- Empty state: "No chats yet — start one" with a centered "+ New chat" button

**Main pane:**
- Header bar: agent name (e.g. "Code Helper") + status pill (idle / streaming / awaiting / error)
- Message list (scrollable, gap-4 between messages)
- Composer (sticky bottom): textarea + Send (or Stop, if streaming)

## 6. Components

### 6.1 `ChatSidebar`

Props: `chats: ChatDto[]`, `activeChatId: string | null`, `onSelectChat(id)`, `onNewChat()`.

Renders the chats list. Highlights active. New-chat button calls `onNewChat()` which invokes `ipc.chat.createChat(agentId)` and selects the new chat.

### 6.2 `MessageList`

Props: `messages: MessageDto[]`, `streamingAssistant: { content: string; toolCalls: ToolCall[] } | null`.

Renders one `<Message>` per persisted row, then optionally a "streaming" assistant message reflecting in-flight `currentAssistant` state from `useChatStream`.

Auto-scroll: keep a ref to the scroll container. On props change, if `scrollTop + clientHeight >= scrollHeight - 100` (within 100px of bottom), scroll to bottom. Otherwise leave alone.

### 6.3 `Message`

Switch by role:
- `user`: right-aligned bubble, accent-soft bg, ink text
- `assistant`: left-aligned, surface bg, ink text; if `toolCalls` present, render `<ToolCallCard>` for each below the content
- `tool`: hidden by default — its content is shown inside the matching `ToolCallCard` via tool-call-id matching
- `system`: hidden (internal)

### 6.4 `ToolCallCard`

Props: `call: ToolCall`, `result?: ToolResult` (matched by toolCallId from the surrounding messages list).

Visual:
- Default: collapsed card with chevron + tool name + one-line arg summary (e.g. `read_file("src/main/index.ts")`)
- While result is missing (tool running): show small spinner dot + "running…"
- If result.ok === false: red-tinted card with "error" badge
- Click chevron → expands to show full args (JSON pretty) and result content (in `<pre>`)

### 6.5 `Composer`

Multiline textarea (auto-grow up to 6 lines, then scroll). Submit on Enter when no Shift; Shift+Enter for newline. Cmd/Ctrl+Enter also submits.

While streaming: textarea disabled, "Send" button replaced with "Stop" button (calls `chat:abort`).

After streaming ends successfully: textarea clears, focus returns.

### 6.6 `EmptyChatState`

Shown in main pane when no chat is selected. Centered, just "Pick a chat or create a new one" with a CTA button.

## 7. IPC + streaming wiring

### 7.1 `ipc.ts` additions

```ts
chat: {
  listAgents: () => ipcRenderer.invoke('chat:list-agents', {}),
  listChats: (agentId: string) => ipcRenderer.invoke('chat:list-chats', { agentId }),
  createChat: (agentId: string, title?: string) =>
    ipcRenderer.invoke('chat:create-chat', { agentId, title }),
  getMessages: (chatId: string) => ipcRenderer.invoke('chat:get-messages', { chatId }),
  sendMessage: (chatId: string, text: string) =>
    ipcRenderer.invoke('chat:send-message', { chatId, text }),
  abort: (streamId: string) => ipcRenderer.invoke('chat:abort', { streamId }),
  subscribeToStream: (streamId: string, onEvent, onEnd) => {
    const evtChannel = `chat:event:${streamId}`;
    const endChannel = `chat:event:${streamId}:end`;
    const onEvtRaw = (_e, payload) => onEvent(payload);
    const onEndRaw = (_e, payload) => {
      onEnd(payload);
      ipcRenderer.removeListener(evtChannel, onEvtRaw);
      ipcRenderer.removeListener(endChannel, onEndRaw);
    };
    ipcRenderer.on(evtChannel, onEvtRaw);
    ipcRenderer.on(endChannel, onEndRaw);
    return () => {
      ipcRenderer.removeListener(evtChannel, onEvtRaw);
      ipcRenderer.removeListener(endChannel, onEndRaw);
    };
  },
}
```

This bridge lives in the **preload** (`src/preload/index.ts`) so it can call `ipcRenderer`. The renderer-side `ipc.ts` declares the shape only.

### 7.2 `useChatStream` hook

```ts
function useChatStream(chatId: string | null) {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState<...>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error' | 'aborted'>('idle');
  const pendingDeltas = useRef<AgentEvent[]>([]);
  const flushIntervalRef = useRef<number | null>(null);

  const flush = () => { /* drain pendingDeltas → setStreamingAssistant */ };

  useEffect(() => {
    if (!chatId) return;
    void ipc.chat.getMessages(chatId).then(({ messages }) => setMessages(messages));
  }, [chatId]);

  const send = async (text: string) => {
    if (!chatId) return;
    setStatus('streaming');
    setStreamingAssistant({ content: '', toolCalls: [] });
    const { streamId } = await ipc.chat.sendMessage(chatId, text);
    setStreamId(streamId);

    flushIntervalRef.current = window.setInterval(flush, 50);

    ipc.chat.subscribeToStream(streamId,
      (event) => { pendingDeltas.current.push(event); },
      (endPayload) => {
        if (flushIntervalRef.current) window.clearInterval(flushIntervalRef.current);
        flush();
        // refetch messages to get persisted state on success
        if (endPayload.reason === 'end' || endPayload.reason === 'max-tools') {
          void ipc.chat.getMessages(chatId).then(({ messages }) => {
            setMessages(messages);
            setStreamingAssistant(null);
          });
        } else {
          setStreamingAssistant(null);
        }
        setStatus(endPayload.reason === 'end' ? 'idle' : endPayload.reason);
        setStreamId(null);
      });
  };

  const abort = () => { if (streamId) void ipc.chat.abort(streamId); };

  return { messages, streamingAssistant, status, streamId, send, abort };
}
```

### 7.3 Streaming render contract

While streaming, `streamingAssistant` reflects the in-flight assistant turn (text so far, pending tool calls). `MessageList` renders persisted messages first, then `streamingAssistant` as a "ghost" message. On `turn-done end`, persisted messages are refetched (now include the assistant + tool messages from C2's `AgentSession`), `streamingAssistant` clears.

## 8. Manual smoke test plan (last task in C3 plan)

User-driven test, documented as a plan task with explicit steps:

1. Pull model: `ollama pull qwen2.5-coder:14b` (one-time, ~9GB).
2. Run dev: `npm run dev`.
3. Sidebar shows Code Helper. Click it.
4. Click "+ New" in chat list.
5. Type "List the files in the workspace." → Cmd+Enter.
6. Expected: streaming text appears; tool-call card for `list_dir` flashes "running…" then expands result; final assistant text confirms findings.
7. Reload app — chat persists, messages persist.
8. Try abort: send a longer prompt ("write a python tic-tac-toe game"), click Stop mid-stream → assistant message NOT persisted, status flips to "aborted".

Doc step in plan: capture screenshots of working chat for README.

## 9. Test Strategy

Renderer tests are limited to pure-component logic that doesn't need Electron:

- `chat-stream-helpers.test.ts` — test the streaming-flush merge logic in isolation (split the merge fn out from `useChatStream`).
- `tool-call-card.test.ts` — render `<ToolCallCard>` with various states (collapsed, expanded, error, running) using vitest + jsdom + @testing-library/react. **Requires** `jsdom` environment override and adding `@testing-library/react` + `@testing-library/jest-dom` as dev deps.

To keep Plan C3 lean: **skip renderer unit tests for v1**. Manual smoke is enough; cover at Plan G polish if churn becomes a problem. Backend test count stays at 154+ from Plan C2.

## 10. Out of Scope (Plans D / E / F / G)

- Multi-agent CRUD — Plan D.
- Shell tool + approval modal UI — Plan E.
- Orchestrator routing UI ("ask anything" global input) — Plan F.
- Markdown rendering, syntax highlighting, animations beyond minimal — Plan G.
- Right-rail file browser — Plan G.
- Token usage display, context bar — Plan G.
- Renderer unit tests — Plan G if churn warrants.
- Real-time chat title regeneration via small LLM call — future.

## 11. Resolved Decisions

- **State management:** local React state + custom hook. No global store.
- **Streaming throttle:** 50ms batched flush in renderer.
- **Tool call rendering:** collapsed cards by default, click to expand.
- **Message types:** user (right bubble), assistant (left), tool (hidden, content shown in matching tool-call card), system (hidden).
- **Composer:** Cmd/Ctrl+Enter to send, Shift+Enter newline.
- **Stop:** visible during stream, calls `chat:abort`.
- **Manual smoke test:** documented as a plan task with explicit user-driven steps.
- **No new npm deps.**
