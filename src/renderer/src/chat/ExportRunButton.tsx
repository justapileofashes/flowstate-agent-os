// Surface 4 — export run (chat header): one-click export of a whole chat run
// (transcript + tool calls + audit trail) to a shareable markdown file. The
// main process builds the document and owns the save dialog. Busy spinner in
// flight; disabled when the chat has no messages; silent on cancel; reuses the
// pack-toast idiom for the result. Design source: Claude Design (system-surfaces.jsx).

import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';

interface Toast {
  kind: 'ok' | 'error';
  title: string;
  sub?: string;
}

function ExportToast({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }): JSX.Element | null {
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

export function ExportRunButton({
  chatId,
  hasMessages,
}: {
  chatId: string;
  hasMessages: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  async function doExport(): Promise<void> {
    if (busy || !hasMessages) return;
    setBusy(true);
    try {
      const r = await ipc.chat.exportRun(chatId);
      if (r.canceled) {
        setBusy(false);
        return; // silent no-op
      }
      if (r.ok) setToast({ kind: 'ok', title: 'Run exported', sub: r.path });
    } catch (e) {
      setToast({ kind: 'error', title: 'Export failed', sub: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => void doExport()}
        disabled={!hasMessages || busy}
        aria-label="Export run"
        title="Export this chat as markdown (transcript + audit trail)"
      >
        {busy ? (
          <svg className="rm-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5" stroke="var(--ink-faint)" strokeOpacity="0.35" />
            <path d="M7 2a5 5 0 0 1 5 5" stroke="currentColor" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8 M5 7l3 3 3-3 M3 13h10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <ExportToast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
