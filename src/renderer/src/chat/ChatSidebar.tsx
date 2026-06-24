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
      <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border)]">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold">
          Chats
        </span>
        <button type="button" onClick={onNewChat} className="btn text-xs px-2 py-1">
          + New
        </button>
      </div>
      {chats.length === 0 ? (
        <div className="px-4 py-2 text-xs text-[var(--ink-faint)]">No chats yet.</div>
      ) : (
        <nav className="flex-1 overflow-y-auto">
          {chats.map((c) => {
            const active = c.id === activeChatId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectChat(c.id)}
                className={`nav-row w-full ${active ? 'nav-row-active' : ''}`}
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
