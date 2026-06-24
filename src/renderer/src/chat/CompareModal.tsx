// Multi-agent compare: send one prompt to several agents at once and watch the
// responses stream side by side. Reuses the normal chat stream IPC — each
// column is a real chat the user can open afterward.

import { useEffect, useRef, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import type { AgentDto } from '@shared/chat-types';

interface Column {
  agentId: string;
  name: string;
  model: string;
  chatId: string | null;
  text: string;
  status: 'pending' | 'streaming' | 'done' | 'error';
}

export function CompareModal({
  agents,
  onClose,
  onOpenChat,
}: {
  agents: AgentDto[];
  onClose: () => void;
  onOpenChat?: (agentId: string, chatId: string) => void;
}): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<Column[]>([]);
  const [running, setRunning] = useState(false);
  const unsubs = useRef<Array<() => void>>([]);

  useEffect(() => () => { unsubs.current.forEach((u) => u()); }, []);

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < 4) n.add(id);
      return n;
    });

  const update = (agentId: string, patch: Partial<Column>): void =>
    setColumns((cols) => cols.map((c) => (c.agentId === agentId ? { ...c, ...patch } : c)));

  async function run(): Promise<void> {
    if (running || prompt.trim().length === 0 || selected.size < 2) return;
    unsubs.current.forEach((u) => u());
    unsubs.current = [];
    setRunning(true);
    const picked = agents.filter((a) => selected.has(a.id));
    setColumns(picked.map((a) => ({ agentId: a.id, name: a.name, model: a.model, chatId: null, text: '', status: 'pending' })));

    await Promise.all(
      picked.map(async (a) => {
        try {
          const { chat } = await ipc.chat.createChat(a.id, 'Compare');
          update(a.id, { chatId: chat.id, status: 'streaming' });
          const { streamId } = await ipc.chat.sendMessage(chat.id, prompt.trim());
          const unsub = ipc.chat.subscribeToStream(
            streamId,
            (event) => {
              const e = event as { type: string; text?: string };
              if (e.type === 'text-delta' && e.text) {
                setColumns((cols) => cols.map((c) => (c.agentId === a.id ? { ...c, text: c.text + e.text } : c)));
              }
            },
            () => update(a.id, { status: 'done' }),
          );
          unsubs.current.push(unsub);
        } catch {
          update(a.id, { status: 'error' });
        }
      }),
    );
    setRunning(false);
  }

  const allDone = columns.length > 0 && columns.every((c) => c.status === 'done' || c.status === 'error');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass" style={{ width: 'min(1100px, calc(100% - 48px))', maxHeight: '86%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span style={{ color: 'var(--ink-strong)', fontSize: 14, fontWeight: 500 }}>Compare agents</span>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor" /></svg>
            <span>Close</span>
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            className="field"
            rows={2}
            placeholder="One prompt, sent to every selected agent…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {agents.slice(0, 24).map((a) => (
              <button
                key={a.id}
                type="button"
                className={'btn btn-sm ' + (selected.has(a.id) ? '' : 'btn-ghost')}
                onClick={() => toggle(a.id)}
                disabled={running}
              >
                <span className="dot" style={{ background: a.avatarColor, width: 7, height: 7, borderRadius: 999, marginRight: 5 }} />
                {a.name}
              </button>
            ))}
          </div>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <span className="muted text-xs">{selected.size} selected (pick 2–4)</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" onClick={() => void run()} disabled={running || prompt.trim().length === 0 || selected.size < 2}>
              {running ? 'Running…' : 'Run comparison'}
            </button>
          </div>

          {columns.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: 10 }}>
              {columns.map((c) => (
                <div key={c.agentId} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, maxHeight: 420, overflow: 'hidden' }}>
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <span style={{ color: 'var(--ink-strong)', fontSize: 13 }}>{c.name}</span>
                    <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: 10 }}>{c.model}</span>
                    <div style={{ flex: 1 }} />
                    <span className={'pill ' + (c.status === 'done' ? 'good' : c.status === 'error' ? 'bad' : c.status === 'streaming' ? 'streaming' : '')}>
                      <span className="dot" /><span>{c.status}</span>
                    </span>
                  </div>
                  <div style={{ overflowY: 'auto', fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-muted)', whiteSpace: 'pre-wrap' }}>
                    {c.text || (c.status === 'pending' ? '…' : '')}
                  </div>
                  {c.chatId && c.status !== 'pending' && onOpenChat ? (
                    <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onOpenChat(c.agentId, c.chatId!)}>
                      Open chat
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {allDone && <div className="muted text-xs">Each column is a real chat — open any to continue it.</div>}
        </div>
      </div>
    </div>
  );
}
