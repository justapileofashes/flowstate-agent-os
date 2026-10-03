// Agent Library — every built-in agent template. A fresh install only gets a
// core set; the rest are added from here in one click (with a model this
// machine has). Deleted built-ins can be re-added here too.

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import { ipcErrorMessage } from '../lib/ipc-error';
import { modalBackdrop, modalPanel } from '../lib/motion';
import { TOOL_GROUPS } from '@shared/tool-groups';
import type { AgentTemplateDto } from '@shared/ipc-channels';
import type { AgentDto } from '@shared/chat-types';

const GROUP_LABEL = new Map<string, string>(TOOL_GROUPS.map((g) => [g.id, g.label]));

export function AgentLibraryModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (agent: AgentDto) => void;
}): JSX.Element {
  const [templates, setTemplates] = useState<AgentTemplateDto[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void ipc.agentLibrary
      .list()
      .then((r) => setTemplates(r.templates))
      .catch((err) => setError(ipcErrorMessage(err)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = templates ?? [];
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.specialtyTags.some((tag) => tag.includes(q)),
    );
  }, [templates, query]);

  async function add(t: AgentTemplateDto): Promise<void> {
    setBusy(t.id);
    setError('');
    try {
      const { agent } = await ipc.agentLibrary.add(t.id);
      setTemplates((ts) => ts?.map((x) => (x.id === t.id ? { ...x, added: true } : x)) ?? ts);
      onAdded(agent);
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={busy ? undefined : onClose}
    >
      <motion.div
        className="glass w-full max-w-2xl flex flex-col"
        style={{ maxHeight: '80vh', borderRadius: 'var(--r-xl)' }}
        variants={modalPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Agent library"
      >
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Agent library</h3>
            <span className="muted text-xs" style={{ marginLeft: 10 }}>
              {templates ? `${templates.length} built-in agents` : 'Loading…'}
            </span>
            <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>
              Close
            </button>
          </div>
          <input
            className="field"
            style={{ marginTop: 12, width: '100%' }}
            placeholder="Search by name, job or tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {error && <div className="hint" style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</div>}
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 12px 16px' }}>
          {shown.map((t) => (
            <div
              key={t.id}
              className="row"
              style={{ alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: '1px solid var(--border)' }}
            >
              <span
                aria-hidden
                style={{ width: 10, height: 10, borderRadius: 999, background: t.avatarColor, flex: 'none' }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: 'var(--ink-strong)' }}>{t.name}</div>
                <div className="muted text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.description}
                </div>
                <div className="faint text-xs mono" style={{ marginTop: 2 }}>
                  {t.groups.map((g) => GROUP_LABEL.get(g) ?? g).join(' · ')}
                </div>
              </div>
              {t.added ? (
                <span className="pill good">Added</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={() => void add(t)}
                >
                  {busy === t.id ? 'Adding…' : 'Add'}
                </button>
              )}
            </div>
          ))}
          {templates && shown.length === 0 && <div className="muted text-sm" style={{ padding: 12 }}>No matches.</div>}
        </div>
      </motion.div>
    </motion.div>
  );
}
