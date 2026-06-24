import { useEffect, useRef, useState } from 'react';
import type { MessageDto, AgentDto } from '@shared/chat-types';
import type { StreamingAssistant } from '../lib/chat-stream-helpers';
import { Message } from './Message';
import { ToolCallCard } from './ToolCallCard';
import { MarkdownText } from './MarkdownText';
import { AgentAvatar } from '../lib/agent-icons';
import { ProcessTimeline } from './ProcessTimeline';

interface Props {
  messages: MessageDto[];
  streaming: StreamingAssistant | null;
  agent?: AgentDto;
}

/** Pretty human label for what the agent is currently doing, derived from
 *  the latest in-flight tool call (or "Thinking…" when nothing else). */
function activityLabel(streaming: StreamingAssistant): string {
  const last = streaming.toolCalls[streaming.toolCalls.length - 1];
  if (!last) {
    return streaming.content.length > 0 ? 'Writing reply' : 'Thinking';
  }
  const args = (last.args ?? {}) as Record<string, unknown>;
  const path = typeof args['path'] === 'string' ? args['path'] : undefined;
  const query =
    typeof args['query'] === 'string'
      ? args['query']
      : typeof args['pattern'] === 'string'
        ? args['pattern']
        : undefined;
  const cmd = typeof args['command'] === 'string' ? args['command'] : undefined;
  switch (last.name) {
    case 'read_file':       return path ? `Reading ${shorten(path)}` : 'Reading file';
    case 'write_file':      return path ? `Writing ${shorten(path)}` : 'Writing file';
    case 'edit_file':       return path ? `Editing ${shorten(path)}` : 'Editing file';
    case 'list_dir':        return path ? `Listing ${shorten(path)}` : 'Listing files';
    case 'search_files':    return query ? `Searching for "${shorten(query, 30)}"` : 'Searching workspace';
    case 'web_search':      return query ? `Web-searching "${shorten(query, 30)}"` : 'Searching the web';
    case 'shell':           return cmd ? `Running ${shorten(cmd, 30)}` : 'Running shell command';
    case 'run_code':        return 'Running code';
    case 'design_artifact': return 'Generating artifact';
    case 'generate_3d_model': return 'Modelling in 3D';
    case 'brain_search':    return query ? `Brain-search "${shorten(query, 30)}"` : 'Searching notes';
    case 'brain_read':      return path ? `Reading note ${shorten(path)}` : 'Reading note';
    case 'brain_write':     return path ? `Writing note ${shorten(path)}` : 'Writing note';
    default:                return `Using ${last.name}`;
  }
}

function shorten(s: string, max = 40): string {
  return s.length > max ? '…' + s.slice(-max + 1) : s;
}

export function MessageList({ messages, streaming, agent }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  // Replay mode: cursor is an index into the visible (non-tool) message
  // sequence. While `replayCursor !== null` we hide messages after it.
  const visibleMessages = messages.filter((m) => m.role !== 'system');
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const isReplaying = replayCursor !== null;
  const cursor = isReplaying ? Math.min(replayCursor, visibleMessages.length - 1) : visibleMessages.length - 1;
  const shown = isReplaying ? visibleMessages.slice(0, cursor + 1) : visibleMessages;

  const toolResults = new Map<string, { ok: boolean; content: string }>();
  for (const m of shown) {
    if (m.role === 'tool' && m.toolCallId) {
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
      className="scroll"
      style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
    >
      <div className="chat-stream">
        {visibleMessages.length > 1 ? (
          <div
            className="row gap-2"
            style={{
              marginBottom: 12,
              padding: '8px 12px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <span className="muted text-xs mono">Replay</span>
            <input
              type="range"
              min={0}
              max={visibleMessages.length - 1}
              value={cursor}
              onChange={(e) => setReplayCursor(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
              aria-label="Replay cursor"
            />
            <span className="muted text-xs mono">
              {cursor + 1} / {visibleMessages.length}
            </span>
            {isReplaying ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setReplayCursor(null)}
              >
                Live
              </button>
            ) : null}
          </div>
        ) : null}
        {messages.length === 0 && streaming === null ? (
          <div className="muted text-sm">Send a message to begin.</div>
        ) : null}
        {shown.map((m) => (
          <Message key={m.id} message={m} toolResults={toolResults} agent={agent} />
        ))}
        {!isReplaying && streaming ? (
          <div className="msg">
            <div className="avatar" style={{ padding: 0 }}>
              {agent ? <AgentAvatar agent={agent} size={20} /> : <span>▲</span>}
            </div>
            <div className="body">
              <div className="role">
                {agent?.name?.toLowerCase() ?? 'agent'}
                <span
                  className="pill streaming"
                  style={{ marginLeft: 8, height: 18, padding: '0 7px' }}
                >
                  <span className="dot" />
                  <span>{activityLabel(streaming)}</span>
                </span>
              </div>
              <ProcessTimeline
                toolCalls={streaming.toolCalls}
                inFlight
                thinkingContent={streaming.content}
              />
              {streaming.content.length > 0 ? (
                <div className="text markdown" style={{ marginTop: 8 }}>
                  <MarkdownText>{streaming.content}</MarkdownText>
                </div>
              ) : null}
              {streaming.toolCalls.length > 0 ? (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {streaming.toolCalls.map((c) => (
                    <ToolCallCard key={c.id} call={c} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
