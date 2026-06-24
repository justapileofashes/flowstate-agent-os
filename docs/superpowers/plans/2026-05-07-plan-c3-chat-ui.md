# Flowstate — Plan C3: Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the renderer chat experience: sidebar with the Code Helper agent, chat list, message thread with streaming token updates and collapsible tool-call cards, composer with Cmd+Enter to send and a Stop button while streaming. After C3 the app is end-to-end usable against a real local Ollama.

**Architecture:** Renderer-only changes. Preload exposes new `flowstate.chat.*` methods + a `subscribeToStream(streamId, onEvent, onEnd)` bridge that auto-cleans listeners on stream end. App shell becomes a 256px sidebar + main pane with a simple in-memory view switcher (Settings vs Chat). The Chat screen owns chat list, message thread, and composer; a `useChatStream` hook batches IPC deltas at 50ms.

**Tech Stack:** Existing React 18 + Tailwind + Framer Motion + zod. **No new npm deps.**

**Demo target:** `npm run dev` opens the app. Click Code Helper. Click "+ New". Type a message, Cmd+Enter. Watch streaming + tool-call card. Reload — chat persists.

---

## File Structure

```
src/preload/
└── index.ts                                # MODIFY — add chat methods + subscribe helper, expose

src/renderer/src/
├── App.tsx                                 # MODIFY — sidebar shell + view switcher
├── lib/
│   ├── ipc.ts                              # MODIFY — declare chat API surface
│   └── chat-stream-helpers.ts              # NEW — pure flush/merge logic, testable
├── screens/
│   ├── Settings.tsx                        # KEEP
│   └── Chat.tsx                            # NEW — orchestrator
├── chat/
│   ├── ChatSidebar.tsx                     # NEW
│   ├── MessageList.tsx                     # NEW
│   ├── Message.tsx                         # NEW
│   ├── ToolCallCard.tsx                    # NEW
│   ├── Composer.tsx                        # NEW
│   ├── EmptyChatState.tsx                  # NEW
│   └── useChatStream.ts                    # NEW — custom hook
└── styles.css                              # KEEP
```

---

## Conventions

- Git author flags: `git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit ...`
- Node 22 PATH on every shell command:

  ```bash
  export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH"
  ```
- Every file MUST typecheck cleanly with `npm run typecheck` before commit.

---

## Task 1: Preload bridge — chat methods + stream subscription

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNELS,
  chatEventChannel,
  chatEventEndChannel,
} from '@shared/ipc-channels';
import type {
  SettingsGetResponse,
  SettingsSetResponse,
  SettingsListResponse,
  OllamaHealthResponse,
  ChatListAgentsResponse,
  ChatListChatsResponse,
  ChatCreateChatResponse,
  ChatGetMessagesResponse,
  ChatSendMessageResponse,
  ChatAbortResponse,
} from '@shared/ipc-channels';

const api = {
  settings: {
    get: (key: string): Promise<SettingsGetResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_GET, { key }),
    set: (key: string, value: string): Promise<SettingsSetResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_SET, { key, value }),
    list: (): Promise<SettingsListResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_LIST, {}),
  },
  ollama: {
    health: (): Promise<OllamaHealthResponse> =>
      ipcRenderer.invoke(CHANNELS.OLLAMA_HEALTH, {}),
  },
  chat: {
    listAgents: (): Promise<ChatListAgentsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_AGENTS, {}),
    listChats: (agentId: string): Promise<ChatListChatsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_CHATS, { agentId }),
    createChat: (agentId: string, title?: string): Promise<ChatCreateChatResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_CREATE_CHAT, { agentId, title }),
    getMessages: (chatId: string): Promise<ChatGetMessagesResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_GET_MESSAGES, { chatId }),
    sendMessage: (chatId: string, text: string): Promise<ChatSendMessageResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_SEND_MESSAGE, { chatId, text }),
    abort: (streamId: string): Promise<ChatAbortResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_ABORT, { streamId }),
    subscribeToStream: (
      streamId: string,
      onEvent: (event: unknown) => void,
      onEnd: (payload: { reason: string }) => void,
    ): (() => void) => {
      const evtChannel = chatEventChannel(streamId);
      const endChannel = chatEventEndChannel(streamId);
      const onEvtRaw = (_e: Electron.IpcRendererEvent, payload: unknown) => {
        onEvent(payload);
      };
      const onEndRaw = (_e: Electron.IpcRendererEvent, payload: { reason: string }) => {
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
  },
};

contextBridge.exposeInMainWorld('flowstate', api);

export type FlowstateApi = typeof api;
```

- [ ] **Step 2: Build to confirm preload bundles correctly**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npx electron-vite build 2>&1 | tail -10
```

Expected: `out/preload/index.cjs` rebuilt without errors. Size will increase modestly (still bundled with zod since `sandbox: true` requires CJS).

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/preload/index.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(preload): expose chat methods and stream subscription helper"
```

---

## Task 2: Renderer ipc.ts — declare chat API

**Files:**
- Modify: `src/renderer/src/lib/ipc.ts`

- [ ] **Step 1: Replace `src/renderer/src/lib/ipc.ts`**

```ts
import type {
  SettingsGetResponse,
  SettingsSetResponse,
  SettingsListResponse,
  OllamaHealthResponse,
  ChatListAgentsResponse,
  ChatListChatsResponse,
  ChatCreateChatResponse,
  ChatGetMessagesResponse,
  ChatSendMessageResponse,
  ChatAbortResponse,
} from '@shared/ipc-channels';

interface FlowstateApi {
  settings: {
    get: (key: string) => Promise<SettingsGetResponse>;
    set: (key: string, value: string) => Promise<SettingsSetResponse>;
    list: () => Promise<SettingsListResponse>;
  };
  ollama: {
    health: () => Promise<OllamaHealthResponse>;
  };
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
  };
}

declare global {
  interface Window {
    flowstate: FlowstateApi;
  }
}

export const ipc: FlowstateApi = window.flowstate;
```

- [ ] **Step 2: Typecheck renderer**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/lib/ipc.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): declare chat API surface in ipc.ts"
```

---

## Task 3: Stream-merge helper

**Files:**
- Create: `src/renderer/src/lib/chat-stream-helpers.ts`

This module isolates pure logic that merges incoming `AgentEvent`s into a `StreamingAssistant` snapshot — kept separate so a future test can cover it without React.

- [ ] **Step 1: Write `src/renderer/src/lib/chat-stream-helpers.ts`**

```ts
export interface ToolCallView {
  id: string;
  name: string;
  args: unknown;
  result?: { ok: boolean; content: string };
}

export interface StreamingAssistant {
  content: string;
  toolCalls: ToolCallView[];
}

export type AgentEventLike =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: { id: string; name: string; args: unknown } }
  | { type: 'tool-result'; result: { toolCallId: string; toolName: string; ok: boolean; content: string } }
  | { type: 'turn-done'; reason: string; error?: string }
  | { type: 'token-usage'; promptTokens: number; completionTokens: number };

export function emptyStreaming(): StreamingAssistant {
  return { content: '', toolCalls: [] };
}

export function mergeEvents(
  state: StreamingAssistant,
  events: AgentEventLike[],
): StreamingAssistant {
  let next: StreamingAssistant = state;
  let mutated = false;

  const ensure = (): StreamingAssistant => {
    if (!mutated) {
      next = { content: state.content, toolCalls: state.toolCalls.map((c) => ({ ...c })) };
      mutated = true;
    }
    return next;
  };

  for (const event of events) {
    if (event.type === 'text-delta') {
      const s = ensure();
      s.content += event.text;
    } else if (event.type === 'tool-call') {
      const s = ensure();
      s.toolCalls.push({
        id: event.call.id,
        name: event.call.name,
        args: event.call.args,
      });
    } else if (event.type === 'tool-result') {
      const s = ensure();
      const idx = s.toolCalls.findIndex((c) => c.id === event.result.toolCallId);
      if (idx >= 0) {
        const tc = s.toolCalls[idx]!;
        s.toolCalls[idx] = {
          ...tc,
          result: { ok: event.result.ok, content: event.result.content },
        };
      }
    }
    // 'turn-done' and 'token-usage' don't affect the streaming snapshot
  }

  return next;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/lib/chat-stream-helpers.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): add stream-merge helper for AgentEvent batching"
```

---

## Task 4: useChatStream hook

**Files:**
- Create: `src/renderer/src/chat/useChatStream.ts`

- [ ] **Step 1: Write `src/renderer/src/chat/useChatStream.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import {
  emptyStreaming,
  mergeEvents,
  type AgentEventLike,
  type StreamingAssistant,
} from '../lib/chat-stream-helpers';
import type { MessageDto } from '@shared/chat-types';

export type StreamStatus = 'idle' | 'streaming' | 'aborted' | 'error' | 'max-tools';

export interface UseChatStreamResult {
  messages: MessageDto[];
  streamingAssistant: StreamingAssistant | null;
  status: StreamStatus;
  send: (text: string) => Promise<void>;
  abort: () => void;
  refresh: () => Promise<void>;
}

const FLUSH_INTERVAL_MS = 50;

export function useChatStream(chatId: string | null): UseChatStreamResult {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState<StreamingAssistant | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const streamIdRef = useRef<string | null>(null);
  const pendingRef = useRef<AgentEventLike[]>([]);
  const timerRef = useRef<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const flush = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setStreamingAssistant((prev) => mergeEvents(prev ?? emptyStreaming(), batch));
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setInterval(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const { messages: rows } = await ipc.chat.getMessages(chatId);
    setMessages(rows);
  }, [chatId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      stopTimer();
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [stopTimer]);

  const send = useCallback(
    async (text: string) => {
      if (!chatId) return;
      if (status === 'streaming') return;
      // Optimistic: show user message immediately. We'll refresh after end.
      const tempUser: MessageDto = {
        id: `temp-${Date.now()}`,
        chatId,
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, tempUser]);
      setStreamingAssistant(emptyStreaming());
      setStatus('streaming');
      startTimer();

      const { streamId } = await ipc.chat.sendMessage(chatId, text);
      streamIdRef.current = streamId;

      const unsub = ipc.chat.subscribeToStream(
        streamId,
        (event) => {
          pendingRef.current.push(event as AgentEventLike);
        },
        async (endPayload) => {
          stopTimer();
          flush();
          unsubRef.current = null;
          streamIdRef.current = null;

          const reason = endPayload.reason;
          if (reason === 'end' || reason === 'max-tools') {
            // Refetch to get persisted messages (replaces optimistic temp)
            await refresh();
            setStreamingAssistant(null);
            setStatus(reason === 'end' ? 'idle' : 'max-tools');
          } else {
            // aborted/error: backend rolled back, but we showed an optimistic
            // user message. Drop it by refetching (which will return only what's
            // persisted — the user message IS persisted by AgentSession before
            // the runtime call, so it stays).
            await refresh();
            setStreamingAssistant(null);
            setStatus(reason === 'aborted' ? 'aborted' : 'error');
          }
        },
      );
      unsubRef.current = unsub;
    },
    [chatId, status, startTimer, stopTimer, flush, refresh],
  );

  const abort = useCallback(() => {
    const streamId = streamIdRef.current;
    if (!streamId) return;
    void ipc.chat.abort(streamId);
  }, []);

  return { messages, streamingAssistant, status, send, abort, refresh };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/chat/useChatStream.ts
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): useChatStream hook batches deltas + manages stream lifecycle"
```

---

## Task 5: Chat sub-components — Composer, EmptyChatState, ToolCallCard, Message, MessageList, ChatSidebar

**Files:**
- Create: `src/renderer/src/chat/Composer.tsx`
- Create: `src/renderer/src/chat/EmptyChatState.tsx`
- Create: `src/renderer/src/chat/ToolCallCard.tsx`
- Create: `src/renderer/src/chat/Message.tsx`
- Create: `src/renderer/src/chat/MessageList.tsx`
- Create: `src/renderer/src/chat/ChatSidebar.tsx`

- [ ] **Step 1: Write `Composer.tsx`**

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ disabled, streaming, onSend, onStop }: Props): JSX.Element {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return; // newline
    e.preventDefault();
    submit();
  }

  function submit(): void {
    const trimmed = value.trim();
    if (trimmed.length === 0 || streaming || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={streaming ? 'Streaming…' : 'Type a message — Cmd/Ctrl+Enter to send'}
          disabled={disabled || streaming}
          rows={2}
          className="flex-1 resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none focus-visible:border-[var(--accent)] disabled:opacity-60"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="btn"
            aria-label="Stop"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            className="btn btn-primary"
            disabled={disabled || value.trim().length === 0}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `EmptyChatState.tsx`**

```tsx
interface Props {
  onCreate: () => void;
}

export function EmptyChatState({ onCreate }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center px-8">
      <p className="text-[var(--ink-muted)] text-sm max-w-md">
        Pick a chat from the left rail or start a new one.
      </p>
      <button type="button" className="btn btn-primary" onClick={onCreate}>
        + New chat
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write `ToolCallCard.tsx`**

```tsx
import { useState } from 'react';
import type { ToolCallView } from '../lib/chat-stream-helpers';

interface Props {
  call: ToolCallView;
}

export function ToolCallCard({ call }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const argSummary = summarize(call.args);
  const running = call.result === undefined;
  const failed = call.result !== undefined && !call.result.ok;

  const borderColor = failed
    ? 'border-[var(--bad)]/40'
    : 'border-[var(--border)]';

  return (
    <div className={`rounded-md border ${borderColor} bg-[var(--surface-2)] my-2`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
      >
        <span className="text-[var(--ink-faint)]">{open ? '▾' : '▸'}</span>
        <span className="font-medium">{call.name}</span>
        <span className="text-[var(--ink-muted)] truncate">({argSummary})</span>
        <span className="ml-auto text-xs">
          {running ? <span className="dot dot-good dot-pulse inline-block align-middle" /> : null}
          {failed ? <span className="text-[var(--bad)]">error</span> : null}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] px-3 py-2 space-y-2 text-xs">
          <div>
            <div className="text-[var(--ink-faint)] mb-1">args</div>
            <pre className="kbd whitespace-pre-wrap break-all p-2 max-h-48 overflow-auto">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          {call.result ? (
            <div>
              <div className="text-[var(--ink-faint)] mb-1">
                {call.result.ok ? 'result' : 'error'}
              </div>
              <pre className="kbd whitespace-pre-wrap break-all p-2 max-h-64 overflow-auto">
                {call.result.content}
              </pre>
            </div>
          ) : (
            <div className="text-[var(--ink-faint)]">running…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function summarize(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args !== 'object') return String(args);
  const obj = args as Record<string, unknown>;
  return Object.entries(obj)
    .slice(0, 3)
    .map(([k, v]) => {
      const repr = typeof v === 'string' ? `"${truncate(v, 40)}"` : truncate(JSON.stringify(v), 40);
      return `${k}: ${repr}`;
    })
    .join(', ');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
```

- [ ] **Step 4: Write `Message.tsx`**

```tsx
import type { MessageDto } from '@shared/chat-types';
import { ToolCallCard } from './ToolCallCard';
import type { ToolCallView } from '../lib/chat-stream-helpers';

interface Props {
  message: MessageDto;
  // For assistant messages, look up tool results from the surrounding messages
  toolResults: Map<string, { ok: boolean; content: string }>;
}

export function Message({ message, toolResults }: Props): JSX.Element | null {
  if (message.role === 'system' || message.role === 'tool') {
    // tool messages are rendered inside ToolCallCard via id matching
    return null;
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="rounded-lg bg-[var(--accent-soft)] text-[var(--ink)] px-3 py-2 max-w-[80%] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  // assistant
  const calls: ToolCallView[] = (message.toolCalls ?? []).map((c) => {
    const r = toolResults.get(c.id);
    return r ? { ...c, result: r } : { ...c };
  });

  return (
    <div className="space-y-1">
      {message.content.length > 0 ? (
        <div className="rounded-lg bg-[var(--surface)] text-[var(--ink)] px-3 py-2 whitespace-pre-wrap">
          {message.content}
        </div>
      ) : null}
      {calls.map((c) => (
        <ToolCallCard key={c.id} call={c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `MessageList.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { MessageDto } from '@shared/chat-types';
import type { StreamingAssistant } from '../lib/chat-stream-helpers';
import { Message } from './Message';
import { ToolCallCard } from './ToolCallCard';

interface Props {
  messages: MessageDto[];
  streaming: StreamingAssistant | null;
}

export function MessageList({ messages, streaming }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  // Build a map of toolCallId → {ok, content} from persisted tool messages
  const toolResults = new Map<string, { ok: boolean; content: string }>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      // We don't store ok in the row; treat all persisted as ok=true.
      // Failed tool results were never persisted (rolled back on error/abort).
      toolResults.set(m.toolCallId, { ok: true, content: m.content });
    }
  }

  function handleScroll(): void {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom < 100;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
    >
      {messages.length === 0 && streaming === null ? (
        <p className="text-sm text-[var(--ink-faint)]">
          Send a message to begin.
        </p>
      ) : null}
      {messages.map((m) => (
        <Message key={m.id} message={m} toolResults={toolResults} />
      ))}
      {streaming ? (
        <div className="space-y-1">
          {streaming.content.length > 0 ? (
            <div className="rounded-lg bg-[var(--surface)] text-[var(--ink)] px-3 py-2 whitespace-pre-wrap">
              {streaming.content}
            </div>
          ) : null}
          {streaming.toolCalls.map((c) => (
            <ToolCallCard key={c.id} call={c} />
          ))}
          <div className="text-xs text-[var(--ink-faint)] pl-1">streaming…</div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Write `ChatSidebar.tsx`**

```tsx
import type { ChatDto } from '@shared/chat-types';

interface Props {
  chats: ChatDto[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
}

export function ChatSidebar({ chats, activeChatId, onSelectChat, onNewChat }: Props): JSX.Element {
  return (
    <aside className="w-[220px] border-r border-[var(--border)] flex flex-col">
      <div className="p-3 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-[var(--ink-faint)]">Chats</span>
        <button type="button" onClick={onNewChat} className="btn text-xs">
          + New
        </button>
      </div>
      {chats.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--ink-faint)]">No chats yet.</div>
      ) : (
        <nav className="flex-1 overflow-y-auto">
          {chats.map((c) => {
            const active = c.id === activeChatId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectChat(c.id)}
                className={`w-full text-left px-3 py-2 text-sm border-l-2 transition ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-transparent hover:bg-white/5'
                }`}
              >
                <div className="truncate">{c.title || 'Untitled'}</div>
              </button>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
```

- [ ] **Step 7: Typecheck**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/chat/Composer.tsx src/renderer/src/chat/EmptyChatState.tsx src/renderer/src/chat/ToolCallCard.tsx src/renderer/src/chat/Message.tsx src/renderer/src/chat/MessageList.tsx src/renderer/src/chat/ChatSidebar.tsx
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): chat sub-components (Composer, ToolCallCard, MessageList, ChatSidebar)"
```

---

## Task 6: Chat screen orchestrator

**Files:**
- Create: `src/renderer/src/screens/Chat.tsx`

- [ ] **Step 1: Write `src/renderer/src/screens/Chat.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { AgentDto, ChatDto } from '@shared/chat-types';
import { ChatSidebar } from '../chat/ChatSidebar';
import { Composer } from '../chat/Composer';
import { EmptyChatState } from '../chat/EmptyChatState';
import { MessageList } from '../chat/MessageList';
import { useChatStream } from '../chat/useChatStream';

interface Props {
  agent: AgentDto;
}

export function Chat({ agent }: Props): JSX.Element {
  const [chats, setChats] = useState<ChatDto[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const stream = useChatStream(activeChatId);

  async function refreshChats(): Promise<void> {
    const { chats } = await ipc.chat.listChats(agent.id);
    setChats(chats);
  }

  useEffect(() => {
    void refreshChats();
  }, [agent.id]);

  async function handleNewChat(): Promise<void> {
    const { chat } = await ipc.chat.createChat(agent.id);
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
  }

  async function handleSend(text: string): Promise<void> {
    if (!activeChatId) return;
    await stream.send(text);
    // After end the chat list may be reordered (updated_at bumped) and titled.
    await refreshChats();
  }

  return (
    <div className="flex h-full">
      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onNewChat={() => void handleNewChat()}
      />
      <div className="flex-1 flex flex-col">
        <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{agent.name}</h2>
            <p className="text-xs text-[var(--ink-faint)]">
              {agent.model} · {agent.workspacePath}
            </p>
          </div>
          <span className="pill text-xs">
            {stream.status === 'idle' ? 'Idle' : stream.status === 'streaming' ? 'Streaming…' : stream.status}
          </span>
        </header>
        {activeChatId === null ? (
          <EmptyChatState onCreate={() => void handleNewChat()} />
        ) : (
          <>
            <MessageList messages={stream.messages} streaming={stream.streamingAssistant} />
            <Composer
              disabled={false}
              streaming={stream.status === 'streaming'}
              onSend={(text) => void handleSend(text)}
              onStop={stream.abort}
            />
          </>
        )}
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
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/screens/Chat.tsx
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): Chat screen orchestrator with streaming and chat list"
```

---

## Task 7: App.tsx — sidebar shell + view switcher

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ipc } from './lib/ipc';
import type { AgentDto } from '@shared/chat-types';
import { Settings } from './screens/Settings';
import { Chat } from './screens/Chat';

type View = { kind: 'settings' } | { kind: 'chat'; agent: AgentDto };

export function App(): JSX.Element {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [view, setView] = useState<View>({ kind: 'settings' });

  useEffect(() => {
    void (async () => {
      const { agents } = await ipc.chat.listAgents();
      setAgents(agents);
      // Default to first agent's chat if available
      if (agents.length > 0) {
        setView({ kind: 'chat', agent: agents[0]! });
      }
    })();
  }, []);

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

        <div className="px-4 pt-4 pb-2 text-xs uppercase tracking-wider text-[var(--ink-faint)]">
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
                <div className="w-6 h-6 rounded bg-[var(--surface-2)] flex items-center justify-center text-xs font-semibold text-[var(--accent)]">
                  {a.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="truncate">{a.name}</span>
              </button>
            );
          })}
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
          <div className="px-4 pt-2 pb-1 text-[11px] text-[var(--ink-faint)]">v0.0.1 · foundation</div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {view.kind === 'settings' ? <Settings /> : <Chat agent={view.agent} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck both projects**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build to confirm renderer bundles**

```bash
npx electron-vite build 2>&1 | tail -10
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add src/renderer/src/App.tsx
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "feat(renderer): App shell with sidebar agents nav + view switcher"
```

---

## Task 8: Manual smoke test (USER-DRIVEN — no code change)

**Files:** none modified

This task is a checklist for the user to verify Plan C3 end-to-end against a real local Ollama. The plan executor (you) should NOT attempt to automate this — present the checklist to the user, wait for them to confirm, then proceed to Task 9.

- [ ] **Step 1: Confirm prerequisites**

The user must have:
- Ollama daemon running (`ollama serve` in a separate terminal)
- Pulled `qwen2.5-coder:14b`: in PowerShell, `ollama pull qwen2.5-coder:14b` (~9 GB, one-time)

- [ ] **Step 2: Run dev**

```bash
npm run dev
```

(In PowerShell with Node 22 active via fnm.)

- [ ] **Step 3: Manual checks**

Have the user verify:

1. App opens with sidebar showing **Code Helper** agent (highlighted).
2. Chat screen shows empty state with "+ New chat" button.
3. Click **+ New chat** in either the sidebar or empty state.
4. Type: `List the files in the workspace.`
5. Press **Cmd+Enter** (Ctrl+Enter on Windows). Status pill shows "Streaming…".
6. Streaming text appears character-by-character (50ms batched).
7. A `list_dir` tool-call card flashes "running…", then expands to show args + result on click.
8. Final assistant text confirms findings (e.g. "The workspace is empty.").
9. Status pill returns to "Idle".
10. The chat in the sidebar gets the auto-title "List the files in the workspace.".
11. Reload app (`Ctrl+R` in dev). Chat persists. Messages appear when chat selected.
12. **Abort test:** Send "Write a python tic-tac-toe game." Click **Stop** mid-stream. Status flips to "aborted". Refetched messages do NOT contain the partial assistant turn (only the user message remains).

- [ ] **Step 4: Capture screenshot for README (optional)**

Save a screenshot of a successful chat to `docs/screenshots/plan-c3-chat.png` (create the dir). Reference it in README.

- [ ] **Step 5: Report success or describe failure**

User confirms each numbered check. If anything fails, describe what happened and the executor will diagnose.

- [ ] **Step 6: No commit for this task**

Only Task 9 commits.

---

## Task 9: Tag plan-c3-chat-ui

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all tests + typecheck + build (sanity)**

```bash
cd "D:/docs/claude code projects/claude agents dashboard/" && export PATH="/c/Users/TUF/AppData/Roaming/fnm/node-versions/v22.22.2/installation:$PATH" && npm test && npm run typecheck && npm run build
```

Expected: all green. ~154 tests (no new tests added in C3 — manual smoke replaces unit tests for renderer for v1 per spec section 9).

- [ ] **Step 2: Update README status**

In `README.md`, replace `⏳ Plan C3 — Chat UI` with:

```markdown
- ✅ Plan C3 — Chat UI (sidebar nav, streaming chat, tool-call cards, manual smoke verified)
```

If a screenshot was saved at `docs/screenshots/plan-c3-chat.png`, append (after the Status section):

```markdown
## Screenshots

![Chat screen](docs/screenshots/plan-c3-chat.png)
```

- [ ] **Step 3: Commit + tag**

```bash
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" add README.md
git -c user.name="Ashton Rey Kusuma" -c user.email="ashtonreykusuma11@gmail.com" commit -m "docs: mark Plan C3 complete in README"
git tag plan-c3-chat-ui
```

---

## Done Criteria

- All renderer files exist per file structure.
- `npm run typecheck` clean.
- `npm run build` succeeds.
- `npm test` reports the prior 154 tests green (no new tests added).
- Manual smoke test passed against real Ollama with `qwen2.5-coder:14b`.
- `git tag plan-c3-chat-ui` exists.
- App is end-to-end usable: pick agent → new chat → send → stream → tool-call → result → final text → persists.

---

## Out of Scope (Plans D / E / F / G)

- Renderer unit tests — Plan G if churn warrants.
- Markdown rendering, syntax highlighting — Plan G.
- Multi-agent CRUD + dashboard grid — Plan D.
- Shell tool + approval modal UI — Plan E.
- Orchestrator routing UI — Plan F.
- Right-rail file browser, "Open in VS Code" — Plan G.
- Token usage/context bar — Plan G.
- In-app model puller — Plan G.
