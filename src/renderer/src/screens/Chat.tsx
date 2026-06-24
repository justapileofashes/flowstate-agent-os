import { useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { AgentDto, ChatDto } from '@shared/chat-types';
import { Composer } from '../chat/Composer';
import { EmptyChatState } from '../chat/EmptyChatState';
import { MessageList } from '../chat/MessageList';
import { useChatStream } from '../chat/useChatStream';
import { ApprovalModal } from '../chat/ApprovalModal';
import { FileBrowser } from '../chat/FileBrowser';
import { ViewsButton, type ChatView } from '../chat/ViewsButton';
import { ViewPanel } from '../chat/ViewPanel';
import { TerminalPanel } from '../chat/TerminalPanel';
import { SnapshotsButton } from '../chat/SnapshotsButton';
import { AuditButton } from '../chat/AuditButton';
import { ExportRunButton } from '../chat/ExportRunButton';
import type { NavTarget } from '../chat/slash-commands';
import { AgentAvatar } from '../lib/agent-icons';
import type { TokenUsage } from '../chat/useChatStream';
import { useCustomizePrefs } from '../lib/CustomizeContext';

function contextCapFor(model: string): number {
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 200_000;
  if (m.startsWith('gpt-') || m.startsWith('o') || m.startsWith('chatgpt-')) return 128_000;
  return 32_768; // ollama default-ish
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function TokenChip({
  tokens,
  cap,
}: {
  tokens: TokenUsage;
  cap: number;
}): JSX.Element | null {
  if (tokens.total === 0) return null;
  const pct = tokens.total / cap;
  // Color thresholds: under 60% neutral, 60-80% warm, 80%+ bad.
  const variant = pct >= 0.8 ? 'bad' : '';
  const tooltip =
    pct >= 0.8
      ? `Context window ${Math.round(pct * 100)}% full — consider /clear or start a new session.\nPrompt ${tokens.promptTokens} · Completion ${tokens.completionTokens} · Total ${tokens.total} / ${cap}`
      : `Prompt ${tokens.promptTokens} · Completion ${tokens.completionTokens} · Total ${tokens.total} / ${cap}`;
  return (
    <span className={'pill ' + variant} title={tooltip}>
      {pct >= 0.8 ? <span className="dot" /> : null}
      <span>
        {fmtTokens(tokens.total)} / {fmtTokens(cap)}
      </span>
    </span>
  );
}

function StatusChip({
  pending,
  status,
}: {
  pending: boolean;
  status: string;
}): JSX.Element | null {
  if (status === 'idle' && !pending) return null;
  const label = pending
    ? 'awaiting approval'
    : status === 'streaming'
      ? 'streaming'
      : status;
  const variant = pending ? 'bad' : status === 'streaming' ? 'streaming' : '';
  return (
    <span className={'pill ' + variant} style={{ marginLeft: 12 }}>
      <span className="dot" />
      <span>{label}</span>
    </span>
  );
}

interface PendingChat {
  chatId: string;
  firstMessage: string;
  onConsumed: () => void;
}

interface Props {
  agent: AgentDto;
  openChatId?: string | null;
  pendingChat?: PendingChat | null;
  onChatActivity?: () => void;
  onNav?: (target: NavTarget) => void;
}

export function Chat({ agent, openChatId, pendingChat, onChatActivity, onNav }: Props): JSX.Element {
  const [activeChatId, setActiveChatId] = useState<string | null>(openChatId ?? null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [openViews, setOpenViews] = useState<Set<ChatView>>(new Set());
  const stream = useChatStream(activeChatId);
  // Track which pendingChat id we've already auto-sent for, so effect
  // re-runs (after onConsumed clears the prop) don't re-fire.
  const handledPendingRef = useRef<string | null>(null);
  const [modelOverride, setModelOverride] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [costUsd, setCostUsd] = useState<number>(0);
  const [wsOverride, setWsOverride] = useState<string>('');
  const effectiveModel = modelOverride || agent.model;
  const cap = contextCapFor(effectiveModel);
  const headerPrefs = useCustomizePrefs().chatHeader;

  // Load model override + available models when chat changes
  useEffect(() => {
    if (!activeChatId) return;
    void ipc.settings.get(`chat_model_override:${activeChatId}`).then((r) => {
      setModelOverride(r.value ?? '');
    });
    void ipc.settings.get(`chat_workspace_override:${activeChatId}`).then((r) => {
      setWsOverride(r.value ?? '');
    });
    void ipc.chat.listModels().then((r) => {
      setAvailableModels(r.models.map((m) => m.name));
    });
  }, [activeChatId]);

  // Refresh per-chat cost meter on token updates.
  useEffect(() => {
    if (!activeChatId) return;
    void ipc.usage.list(activeChatId).then((r) => setCostUsd(r.totalUsd));
  }, [activeChatId, stream.tokens.total]);

  async function changeModel(next: string): Promise<void> {
    if (!activeChatId) return;
    setModelOverride(next);
    await ipc.settings.set(`chat_model_override:${activeChatId}`, next);
  }

  async function changeWorkspace(): Promise<void> {
    if (!activeChatId) return;
    const next = prompt(
      'Workspace path for this session (leave empty to use agent default):',
      wsOverride || agent.workspacePath,
    );
    if (next === null) return;
    setWsOverride(next);
    await ipc.settings.set(`chat_workspace_override:${activeChatId}`, next);
  }

  useEffect(() => {
    if (openChatId && openChatId !== activeChatId) {
      setActiveChatId(openChatId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChatId]);

  useEffect(() => {
    if (!pendingChat) return;
    // Sync activeChatId to the incoming chat first; effect will re-run.
    if (activeChatId !== pendingChat.chatId) {
      setActiveChatId(pendingChat.chatId);
      return;
    }
    // Guard against double-fire — once we've handled this pending chat,
    // ignore re-renders triggered by onConsumed clearing it in App.
    if (handledPendingRef.current === pendingChat.chatId) return;
    const text = pendingChat.firstMessage;
    if (!text || text.trim().length === 0) {
      pendingChat.onConsumed();
      return;
    }
    handledPendingRef.current = pendingChat.chatId;
    const consume = pendingChat.onConsumed;
    // Fire send; clear pendingChat *after* send completes so the effect
    // cleanup never races a cancelled timer. Wait one task tick so
    // useChatStream finishes wiring up its chatId-dependent listeners.
    setTimeout(() => {
      void (async () => {
        try {
          await stream.send(text);
          onChatActivity?.();
        } catch {
          // best-effort
        } finally {
          consume();
        }
      })();
    }, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChat, activeChatId]);

  useEffect(() => {
    if (activeChatId !== null) return;
    if (pendingChat) return;
    void (async () => {
      const { chats } = await ipc.chat.listChats(agent.id);
      if (chats.length > 0) {
        setActiveChatId((chats[0] as ChatDto).id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  async function handleNewChat(): Promise<void> {
    const { chat } = await ipc.chat.createChat(agent.id);
    setActiveChatId(chat.id);
    onChatActivity?.();
  }

  async function handleSend(text: string): Promise<void> {
    if (!activeChatId) return;
    await stream.send(text);
    onChatActivity?.();
  }

  const toggleView = (v: ChatView): void => {
    setOpenViews((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };
  const closeView = (v: ChatView): void => {
    setOpenViews((prev) => {
      const next = new Set(prev);
      next.delete(v);
      return next;
    });
  };
  const openViewsOrdered: ChatView[] = Array.from(openViews);

  return (
    <div className="screen-enter col" style={{ height: '100%' }}>
      <header className="chat-header">
        <div className="left" style={{ minWidth: 0 }}>
          <div
            className="a-icon"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink-muted)',
            }}
          >
            <AgentAvatar agent={agent} size={20} />
          </div>
          <div className="min-w-0">
            <div className="agent-name truncate">{agent.name}</div>
            {headerPrefs.crumbs ? (
              <div className="crumbs truncate" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  value={effectiveModel}
                  onChange={(e) => void changeModel(e.target.value === agent.model ? '' : e.target.value)}
                  title="Override the model used for this session"
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--ink-faint)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {availableModels.includes(agent.model) ? null : (
                    <option value={agent.model}>{agent.model}</option>
                  )}
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}{m === agent.model ? ' (default)' : ''}</option>
                  ))}
                </select>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => void changeWorkspace()}
                  title={`Workspace: ${wsOverride || agent.workspacePath}\nClick to change for this session only.`}
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--ink-faint)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: wsOverride ? 'underline dotted' : 'none',
                  }}
                >
                  {wsOverride ? 'workspace·custom' : 'workspace'}
                </button>
                <span>· {agent.specialtyTags.join(' · ') || 'plan'}</span>
              </div>
            ) : null}
          </div>
          <StatusChip pending={!!stream.pendingApproval} status={stream.status} />
        </div>
        <div className="right">
          {headerPrefs.tokenChip ? <TokenChip tokens={stream.tokens} cap={cap} /> : null}
          {headerPrefs.tokenChip && costUsd > 0 ? (
            <span className="pill" title={`Total spend for this chat`}>
              <span>${costUsd < 0.01 ? '<0.01' : costUsd.toFixed(costUsd < 1 ? 3 : 2)}</span>
            </span>
          ) : null}
          {headerPrefs.snapshots ? <SnapshotsButtonInline agentId={agent.id} /> : null}
          {headerPrefs.audit ? (
            <span className="inline-flex">
              <AuditButton agentId={agent.id} />
            </span>
          ) : null}
          {activeChatId ? (
            <ExportRunButton chatId={activeChatId} hasMessages={stream.messages.length > 0} />
          ) : null}
          {headerPrefs.files ? (
            <button
              type="button"
              className={'btn btn-sm ' + (filesOpen ? '' : 'btn-ghost')}
              title="Files"
              onClick={() => setFilesOpen((v) => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="2.5" y="2.5" width="9" height="9" rx="1" stroke="currentColor" />
                <line x1="4.5" y1="6" x2="9.5" y2="6" stroke="currentColor" />
                <line x1="4.5" y1="9" x2="8" y2="9" stroke="currentColor" />
              </svg>
              <span>Files</span>
            </button>
          ) : null}
          {headerPrefs.views ? <ViewsButton open={openViews} onToggle={toggleView} /> : null}
          <button
            type="button"
            className={'btn btn-sm ' + (terminalOpen ? '' : 'btn-ghost')}
            title="Open an interactive terminal in this agent's workspace"
            onClick={() => setTerminalOpen((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" />
              <path d="M4 5.5l2 1.5-2 1.5 M7.5 9h2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Terminal</span>
          </button>
          {activeChatId ? (
            <button
              type="button"
              title="Pop this session into its own window for side-by-side work"
              className="btn btn-sm btn-ghost"
              onClick={() => void ipc.window.popChat(activeChatId, agent.id)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h6v4H2V6z M6 2h4v4 M5 7l5-5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span>Pop out</span>
            </button>
          ) : null}
          <button
            type="button"
            title="New chat"
            className="btn btn-sm btn-ghost"
            onClick={() => void handleNewChat()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8 M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>New</span>
          </button>
        </div>
      </header>

      {activeChatId === null ? (
        <EmptyChatState onCreate={() => void handleNewChat()} />
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <MessageList
              messages={stream.messages}
              streaming={stream.streamingAssistant}
              agent={agent}
            />
            <Composer
              disabled={false}
              streaming={stream.status === 'streaming'}
              onSend={(text) => void handleSend(text)}
              onStop={stream.abort}
              agent={agent}
              {...(activeChatId ? { chatId: activeChatId } : {})}
              {...(onNav ? { onNav } : {})}
            />
          </div>
          {openViewsOrdered.map((v) => (
            <div
              key={v}
              className="flex flex-col min-w-[280px] max-w-[640px] border-l border-[var(--border)]"
              style={{ flex: '1 1 0' }}
            >
              <ViewPanel view={v} messages={stream.messages} onClose={() => closeView(v)} />
            </div>
          ))}
          {filesOpen ? (
            <FileBrowser workspacePath={agent.workspacePath} onClose={() => setFilesOpen(false)} />
          ) : null}
          {terminalOpen && activeChatId ? (
            <div
              className="flex flex-col min-w-[320px] max-w-[680px] border-l border-[var(--border)]"
              style={{ flex: '1 1 0' }}
            >
              <TerminalPanel
                id={`term-${activeChatId}`}
                cwd={agent.workspacePath}
                onClose={() => setTerminalOpen(false)}
              />
            </div>
          ) : null}
        </div>
      )}

      {stream.pendingApproval ? (
        <ApprovalModal
          pending={stream.pendingApproval}
          onRespond={(decision, reason) => void stream.respondApproval(decision, reason)}
        />
      ) : null}
    </div>
  );
}

/** Snapshots dropdown styled to match the inline header look. */
function SnapshotsButtonInline({ agentId }: { agentId: string }): JSX.Element {
  return (
    <span className="inline-flex">
      <SnapshotsButton agentId={agentId} />
    </span>
  );
}

