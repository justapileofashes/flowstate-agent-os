import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentDto } from '@shared/chat-types';
import type { ChatListRecentChatsResponse } from '@shared/ipc-channels';
import { AgentAvatar } from '../lib/agent-icons';
import { ipc } from '../lib/ipc';
import { useCustomizePrefs } from '../lib/CustomizeContext';

type RecentChat = ChatListRecentChatsResponse['chats'][number];

interface Props {
  chats: RecentChat[];
  agents: AgentDto[];
  activeChatId?: string | null;
  streamingChatIds: Set<string>;
  onOpenChat: (agent: AgentDto, chatId: string) => void;
  onChatsChanged: () => void;
  onNewSession?: () => void;
}

interface Group {
  label: string;
  chats: RecentChat[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketChats(chats: RecentChat[]): Group[] {
  const now = startOfDay(Date.now());
  const today = now;
  const yesterday = now - MS_PER_DAY;
  const weekAgo = now - 7 * MS_PER_DAY;
  const monthAgo = now - 30 * MS_PER_DAY;

  const buckets: Record<string, RecentChat[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    'This month': [],
    Older: [],
  };
  for (const c of chats) {
    const d = startOfDay(c.updatedAt);
    if (d >= today) buckets['Today']!.push(c);
    else if (d >= yesterday) buckets['Yesterday']!.push(c);
    else if (d >= weekAgo) buckets['This week']!.push(c);
    else if (d >= monthAgo) buckets['This month']!.push(c);
    else buckets['Older']!.push(c);
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, chats: list }));
}

function resolveAgent(chat: RecentChat, agents: AgentDto[]): AgentDto {
  const found = agents.find((a) => a.id === chat.agentId);
  if (found) return found;
  return {
    id: chat.agentId,
    name: chat.agentName,
    description: '',
    specialtyTags: [],
    avatarColor: chat.agentColor,
    systemPrompt: '',
    model: '',
    workspacePath: '',
    toolPerms: { shell_enabled: false, delete_enabled: false },
    approvalPolicy: 'cautious',
    createdAt: 0,
    updatedAt: 0,
  };
}

export function ChatHistory({
  chats,
  agents,
  activeChatId,
  streamingChatIds,
  onOpenChat,
  onChatsChanged,
  onNewSession,
}: Props): JSX.Element {
  const cards = useCustomizePrefs().agentCards;
  const cardPadding = cards.size === 'sm' ? '4px 12px' : cards.size === 'lg' ? '10px 14px' : '6px 12px';
  const avatarSize = cards.size === 'sm' ? 14 : cards.size === 'lg' ? 22 : 18;
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate pinned set from settings on mount + when chats list changes.
  useEffect(() => {
    void (async () => {
      const next = new Set<string>();
      const all = await ipc.settings.list();
      for (const { key, value } of all.items) {
        if (key.startsWith('chat_pinned:') && value === 'true') {
          next.add(key.slice('chat_pinned:'.length));
        }
      }
      setPinnedIds(next);
    })();
  }, [chats.length]);

  async function togglePin(chatId: string): Promise<void> {
    const isPinned = pinnedIds.has(chatId);
    await ipc.settings.set(`chat_pinned:${chatId}`, isPinned ? '' : 'true');
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (isPinned) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  // Close right-click menu on any outside click / ESC.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  async function exportChat(chatId: string, asMarkdown: boolean): Promise<void> {
    try {
      const { messages } = await ipc.chat.getMessages(chatId);
      const chat = chats.find((c) => c.id === chatId);
      const title = chat?.title || 'Untitled chat';
      const lines = [`# ${title}`, ''];
      for (const m of messages) {
        if (m.role === 'system' || m.role === 'tool') continue;
        const role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Agent' : m.role;
        lines.push(`## ${role}`, '', m.content || '_(empty)_', '');
      }
      const out = lines.join('\n');
      if (asMarkdown) {
        const blob = new Blob([out], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^a-z0-9-_]+/gi, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await navigator.clipboard.writeText(out);
      }
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const [searchHits, setSearchHits] = useState<
    Array<{ chatId: string; snippet: string }> | null
  >(null);

  // Live full-text search across all message bodies. Debounce 200ms.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchHits(null);
      return;
    }
    const id = setTimeout(() => {
      void (async () => {
        try {
          const res = await ipc.chat.search(q, 50);
          const seen = new Set<string>();
          const compact = res.hits
            .filter((h) => {
              if (seen.has(h.chatId)) return false;
              seen.add(h.chatId);
              return true;
            })
            .map((h) => ({ chatId: h.chatId, snippet: h.snippet }));
          setSearchHits(compact);
        } catch {
          setSearchHits([]);
        }
      })();
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return chats;
    // Title / agent-name match first (already-loaded chats).
    const local = chats.filter(
      (c) =>
        (c.title || '').toLowerCase().includes(q) ||
        c.agentName.toLowerCase().includes(q),
    );
    if (!searchHits) return local;
    // Merge with full-text hits: keep order of message-search results, but
    // promote local title-matches to the top.
    const localIds = new Set(local.map((c) => c.id));
    const hitChats = searchHits
      .filter((h) => !localIds.has(h.chatId))
      .map((h) => chats.find((c) => c.id === h.chatId))
      .filter((c): c is RecentChat => Boolean(c));
    return [...local, ...hitChats];
  }, [chats, query, searchHits]);

  const snippetFor = (id: string): string | null =>
    searchHits?.find((h) => h.chatId === id)?.snippet ?? null;

  const groups = useMemo(() => {
    const pinned = filtered.filter((c) => pinnedIds.has(c.id));
    const rest = filtered.filter((c) => !pinnedIds.has(c.id));
    const restGroups = bucketChats(rest);
    return pinned.length > 0 ? [{ label: 'Pinned', chats: pinned }, ...restGroups] : restGroups;
  }, [filtered, pinnedIds]);

  async function commitRename(chatId: string): Promise<void> {
    const next = renameValue.trim();
    setRenamingId(null);
    if (next.length === 0) return;
    const cur = chats.find((c) => c.id === chatId);
    if (cur && cur.title === next) return;
    try {
      await ipc.chat.renameChat(chatId, next);
      onChatsChanged();
    } catch {
      // best-effort
    }
  }

  async function commitDelete(chatId: string): Promise<void> {
    setConfirmDeleteId(null);
    try {
      await ipc.chat.deleteChat(chatId);
      onChatsChanged();
    } catch {
      // best-effort
    }
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, chatId: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitRename(chatId);
    } else if (e.key === 'Escape') {
      setRenamingId(null);
    }
  }

  return (
    <>
      <div className="sidebar-label">
        <span>Sessions</span>
        {onNewSession ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ height: 22, padding: '0 6px', color: 'var(--ink-muted)' }}
            title="New session"
            onClick={onNewSession}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8 M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      <div style={{ padding: '0 10px 6px' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          className="field"
          aria-label="Search sessions"
        />
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8 }}>
        {filtered.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--ink-faint)]">
            {query.length > 0
              ? 'No sessions match your search.'
              : 'No sessions yet. Open the Dashboard to start one.'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="date-divider">{g.label}</div>
              {g.chats.map((c) => {
                const active = c.id === activeChatId;
                const streaming = streamingChatIds.has(c.id);
                const renaming = renamingId === c.id;
                const confirmingDelete = confirmDeleteId === c.id;
                const agent = resolveAgent(c, agents);
                return (
                  <div
                    key={c.id}
                    className={`group chat-history-row ${active ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    style={{ padding: cardPadding }}
                    onClick={() => {
                      if (!renaming) onOpenChat(agent, c.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(c.title || '');
                      setRenamingId(c.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                    }}
                    title={`${c.agentName} — ${c.title || 'Untitled chat'} (double-click to rename · right-click for menu)`}
                  >
                    {cards.showAvatar ? (
                      <div className="avatar">
                        <AgentAvatar agent={agent} size={avatarSize} />
                      </div>
                    ) : null}
                    {renaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => onRenameKey(e, c.id)}
                        onBlur={() => void commitRename(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="meta bg-[var(--bg-elev)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-xs outline-none"
                        aria-label="Rename chat"
                      />
                    ) : (
                      <div className="meta">
                        {cards.showName ? (
                          <div className="title">{c.title || 'Untitled chat'}</div>
                        ) : null}
                        {cards.showLastActivity ? (
                          <div className="sub">{c.agentName}</div>
                        ) : null}
                        {snippetFor(c.id) ? (
                          <div
                            className="sub"
                            style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}
                          >
                            {snippetFor(c.id)}
                          </div>
                        ) : null}
                        {cards.showModel ? (
                          <div className="sub mono" style={{ fontSize: 10 }}>{agent.model || ''}</div>
                        ) : null}
                        {cards.showTags && agent.specialtyTags.length > 0 ? (
                          <div className="sub" style={{ fontSize: 10 }}>
                            {agent.specialtyTags.slice(0, 3).join(' · ')}
                          </div>
                        ) : null}
                      </div>
                    )}
                    {cards.showStatus && streaming ? <div className="stream-dot" /> : null}
                    {!renaming ? (
                      confirmingDelete ? (
                        <span
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="text-[10px] text-[var(--bad)] font-semibold hover:underline"
                            onClick={() => void commitDelete(c.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="text-[10px] text-[var(--ink-faint)] hover:text-[var(--ink)]"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--ink-faint)] hover:text-[var(--bad)] text-base leading-none px-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(c.id);
                          }}
                          aria-label="Delete chat"
                          title="Delete chat"
                        >
                          ×
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {menu ? (
        <div
          role="menu"
          className="dropdown glass"
          style={{
            position: 'fixed',
            left: Math.min(menu.x, window.innerWidth - 220),
            top: Math.min(menu.y, window.innerHeight - 200),
            right: 'auto',
            minWidth: 200,
            zIndex: 60,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const c = chats.find((x) => x.id === menu.id);
            if (!c) return null;
            const agent = resolveAgent(c, agents);
            return (
              <>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    onOpenChat(agent, c.id);
                    setMenu(null);
                  }}
                >
                  <span>Open</span>
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    void togglePin(c.id);
                    setMenu(null);
                  }}
                >
                  <span>{pinnedIds.has(c.id) ? 'Unpin' : 'Pin to top'}</span>
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    setRenameValue(c.title || '');
                    setRenamingId(c.id);
                    setMenu(null);
                  }}
                >
                  <span>Rename…</span>
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    void exportChat(c.id, true);
                    setMenu(null);
                  }}
                >
                  <span>Export as Markdown</span>
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    void exportChat(c.id, false);
                    setMenu(null);
                  }}
                >
                  <span>Copy transcript</span>
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    setConfirmDeleteId(c.id);
                    setMenu(null);
                  }}
                  style={{ color: 'var(--bad)' }}
                >
                  <span>Delete chat</span>
                </div>
              </>
            );
          })()}
        </div>
      ) : null}
    </>
  );
}
