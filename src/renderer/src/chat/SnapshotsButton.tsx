import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { SnapshotDto } from '@shared/ipc-channels';

interface Props {
  agentId: string;
}

export function SnapshotsButton({ agentId }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotDto[]>([]);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const res = await ipc.snapshots.list(agentId);
      setSnapshots(res.snapshots);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, agentId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function take(): Promise<void> {
    setBusy(true);
    try {
      const label = `Manual @ ${new Date().toLocaleTimeString()}`;
      await ipc.snapshots.create(agentId, label);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string): Promise<void> {
    if (!window.confirm('Restore workspace to this snapshot? Files newer than the snapshot will be overwritten.')) return;
    setBusy(true);
    try {
      await ipc.snapshots.restore(agentId, id);
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string): Promise<void> {
    setBusy(true);
    try {
      await ipc.snapshots.delete(agentId, id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        className="btn text-xs"
        onClick={() => setOpen((v) => !v)}
        title="Workspace snapshots"
      >
        Snapshots
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-full mt-1.5 w-72 rounded-md border border-[var(--border)] glass shadow-xl z-30"
          >
            <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold">
                Snapshots
              </span>
              <button
                type="button"
                className="btn btn-primary text-[10px] px-2 py-0.5"
                disabled={busy}
                onClick={() => void take()}
              >
                {busy ? '…' : 'Take now'}
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {snapshots.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-[var(--ink-faint)]">
                  No snapshots. Take one before risky changes — restore later if it goes wrong.
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {snapshots.map((s) => (
                    <li key={s.id} className="px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--ink)]">{s.label}</div>
                          <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">
                            {new Date(s.createdAt).toLocaleString()} · {s.fileCount} files ·{' '}
                            {(s.bytes / 1024 / 1024).toFixed(1)} MB
                          </div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="text-[10px] text-[var(--ink-faint)] hover:text-[var(--bad)]"
                          disabled={busy}
                          onClick={() => void del(s.id)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-[var(--accent)] font-semibold hover:underline"
                          disabled={busy}
                          onClick={() => void restore(s.id)}
                        >
                          Restore
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
