// Agent pack export/import — quiet sidebar row above the Ollama footer.
// Export opens a picker modal; import is one click into the native dialog.
// Design source: Claude Design handoff (agent-packs.jsx), adapted to the
// real AgentDto shape (avatarColor dot instead of glyph).

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { AgentDto } from '@shared/chat-types';
import { modalBackdrop, modalPanel } from '../lib/motion';

interface Toast {
  kind: 'ok' | 'error';
  title: string;
  sub?: string;
}

function PackToast({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }): JSX.Element | null {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDismiss, 4200);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);
  if (!toast) return null;
  return (
    <div className={'pack-toast glass ' + (toast.kind === 'error' ? 'err' : '')} role="status">
      <span className={'pill ' + (toast.kind === 'error' ? 'bad' : 'good')}>
        <span className="dot" />
        <span>{toast.kind === 'error' ? 'failed' : 'done'}</span>
      </span>
      <div className="pack-toast-body">
        <div className="pack-toast-title">{toast.title}</div>
        {toast.sub ? <div className="pack-toast-sub">{toast.sub}</div> : null}
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}

function ExportAgentsModal({
  agents,
  onClose,
  onDone,
}: {
  agents: AgentDto[];
  onClose: () => void;
  onDone: (t: Toast) => void;
}): JSX.Element {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string): void =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = sel.size === agents.length && agents.length > 0;
  const selectAll = (): void => setSel(allSelected ? new Set() : new Set(agents.map((a) => a.id)));

  async function doExport(): Promise<void> {
    setBusy(true);
    try {
      const r = await ipc.chat.exportAgentPack([...sel]);
      if (r.canceled) {
        setBusy(false);
        return; // silent no-op
      }
      if (r.ok) {
        const n = r.count ?? sel.size;
        onDone({ kind: 'ok', title: `Exported ${n} agent${n === 1 ? '' : 's'}`, sub: r.path });
      }
    } catch (e) {
      onDone({ kind: 'error', title: 'Export failed', sub: e instanceof Error ? e.message : String(e) });
    }
    onClose();
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={onClose}
    >
      <motion.div
        className="w-[480px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5 space-y-3"
        variants={modalPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--ink-strong)]">Export agent pack</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">
            Pick agents to include. Secrets and chat history never leave this machine.
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={selectAll}>
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="pack-list max-h-[380px] overflow-y-auto">
          {agents.map((a) => (
            <label key={a.id} className={'pack-row ' + (sel.has(a.id) ? 'on' : '')}>
              <input
                type="checkbox"
                checked={sel.has(a.id)}
                onChange={() => toggle(a.id)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="pack-avatar">
                <span className="dot" style={{ background: a.avatarColor }} />
              </span>
              <span className="pack-name">{a.name}</span>
              <span className="pack-model">{a.model}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-[var(--ink-faint)] font-mono">{sel.size} selected</span>
          <div className="flex-1" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={sel.size === 0 || busy}
            onClick={() => void doExport()}
          >
            {busy ? 'Exporting…' : `Export ${sel.size > 0 ? sel.size + ' ' : ''}agent${sel.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function AgentPackRow({
  agents,
  onImported,
}: {
  agents: AgentDto[];
  onImported: () => void;
}): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  async function doImport(): Promise<void> {
    setImporting(true);
    try {
      const r = await ipc.chat.importAgentPack();
      if (r.canceled) {
        setImporting(false);
        return; // silent
      }
      if (r.ok && r.agents) {
        onImported();
        setToast({
          kind: 'ok',
          title: `Imported ${r.agents.length} agent${r.agents.length === 1 ? '' : 's'}`,
          sub: r.agents.map((a) => a.name).join(' · '),
        });
      }
    } catch (e) {
      setToast({ kind: 'error', title: 'Import failed', sub: e instanceof Error ? e.message : String(e) });
    }
    setImporting(false);
  }

  return (
    <>
      <div className="pack-actions">
        <span className="pack-actions-label">Agent packs</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExportOpen(true)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 10V2 M5 5l3-3 3 3 M3 10v3h10v-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Export</span>
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void doImport()} disabled={importing}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8 M5 7l3 3 3-3 M3 13h10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{importing ? 'Importing…' : 'Import'}</span>
        </button>
      </div>
      {exportOpen ? (
        <ExportAgentsModal agents={agents} onClose={() => setExportOpen(false)} onDone={setToast} />
      ) : null}
      <PackToast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
