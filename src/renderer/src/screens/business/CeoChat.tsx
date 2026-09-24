// Chat with the CEO about this company. The CEO answers from live state
// (KPIs, approvals, tasks, last report) and can add tasks for the next cycle.

import { useEffect, useRef, useState } from 'react';
import type { ChatMessageDto } from '@shared/business/types';
import { biz, errText, fmtAgo, useBiz, useBizLive } from './api';
import { Empty, ErrorLine, Icon, Markdown, RoleBadge } from './ui';

const STARTERS = [
  'What should we focus on this week, and why?',
  "Summarize what's waiting for my approval.",
  'Where are we spending the most credits?',
  'What did we learn from the last cycle?',
];

export function CeoChat(): JSX.Element {
  const { company, chatPrefill, clearPrefill } = useBizLive();
  const sessions = useBiz('chat.sessions', { companyId: company.id }, []);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatPrefill) {
      setSessionId(null);
      setMessages([]);
      setText(chatPrefill);
      clearPrefill();
    }
  }, [chatPrefill, clearPrefill]);

  useEffect(() => {
    if (!sessionId) return;
    void biz('chat.messages', { companyId: company.id, sessionId }).then((r) => setMessages(r.messages)).catch(() => undefined);
  }, [company.id, sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  const send = async (msg: string): Promise<void> => {
    const m = msg.trim();
    if (!m || busy) return;
    setBusy(true);
    setErr('');
    setText('');
    setMessages((xs) => [...xs, { id: 'pending', sessionId: sessionId ?? '', role: 'user', content: m, runId: null, createdAt: Date.now() }]);
    try {
      const r = await biz('chat.send', { companyId: company.id, message: m, ...(sessionId ? { sessionId } : {}) });
      setSessionId(r.session.id);
      setMessages(r.messages);
      if (r.error) setErr(r.error);
      sessions.reload();
    } catch (e) {
      setErr(errText(e));
      setMessages((xs) => xs.filter((x) => x.id !== 'pending'));
      setText(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="biz-chat">
      <aside className="biz-chat-side card">
        <button
          className="btn btn-sm btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => {
            setSessionId(null);
            setMessages([]);
          }}
        >
          {Icon.plus}
          <span>New conversation</span>
        </button>
        <div className="biz-chat-sessions">
          {(sessions.data?.sessions ?? []).map((s) => (
            <button key={s.id} className={`biz-chat-session ${s.id === sessionId ? 'on' : ''}`} onClick={() => setSessionId(s.id)}>
              <span className="biz-ellipsis">{s.title}</span>
              <span className="faint biz-small">{fmtAgo(s.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="biz-chat-main card">
        <div className="biz-chat-log scroll">
          {messages.length === 0 && !busy && (
            <div className="biz-chat-empty">
              <RoleBadge role="ceo" />
              <div className="biz-setting-name" style={{ marginTop: 10 }}>Ask your CEO</div>
              <div className="biz-setting-sub">It answers from the company's live state and can add tasks to the next cycle.</div>
              <div className="biz-starters">
                {STARTERS.map((s) => (
                  <button key={s} className="btn btn-sm" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`biz-msg ${m.role}`}>
              {m.role === 'assistant' && <RoleBadge role="ceo" />}
              <div className="biz-msg-body">{m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}</div>
            </div>
          ))}
          {busy && (
            <div className="biz-msg assistant">
              <RoleBadge role="ceo" />
              <div className="biz-msg-body faint">Thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <ErrorLine error={err} />
        <form
          className="biz-chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            className="field"
            rows={2}
            value={text}
            placeholder="Ask about the business, or ask for work to be done…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} aria-label="Send">
            {Icon.send}
          </button>
        </form>
        {messages.length === 0 && <Empty>Conversations are metered like cycles (small credit cost per reply).</Empty>}
      </section>
    </div>
  );
}
