import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { AuditEntryDto } from '@shared/ipc-channels';

interface Props {
  agentId: string;
}

// Human-readable label + accent color per audit event.
function describe(e: AuditEntryDto): { label: string; tone: string } {
  if (e.eventType === 'approval') {
    const denied = e.decision === 'deny' || e.decision === 'auto-deny';
    return {
      label: `${e.decision} · ${e.toolName ?? 'tool'}`,
      tone: denied ? 'var(--bad)' : 'var(--accent)',
    };
  }
  if (e.eventType === 'rollback') {
    return { label: 'rollback', tone: 'var(--warn, #d08700)' };
  }
  if (e.eventType === 'checkpoint') {
    return { label: `checkpoint · ${e.toolName ?? ''}`.trim(), tone: 'var(--accent)' };
  }
  // tool_call
  return {
    label: e.toolName ?? 'tool',
    tone: e.ok === false ? 'var(--bad)' : 'var(--ink-faint)',
  };
}

export function AuditButton({ agentId }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const res = await ipc.audit.list({ agentId, limit: 200 });
      setEntries(res.entries);
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

  async function forget(): Promise<void> {
    if (
      !window.confirm(
        "Forget this agent's entire activity history? The audit log will be permanently erased.",
      )
    )
      return;
    setBusy(true);
    try {
      await ipc.audit.clear(agentId);
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
        title="Agent audit log"
      >
        Audit
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-full mt-1.5 w-80 rounded-md border border-[var(--border)] glass shadow-xl z-30"
          >
            <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold">
                Audit log
              </span>
              <button
                type="button"
                className="text-[10px] text-[var(--ink-faint)] hover:text-[var(--bad)] font-semibold"
                disabled={busy || entries.length === 0}
                onClick={() => void forget()}
                title="Erase this agent's audit history"
              >
                {busy ? '…' : 'Forget'}
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {entries.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-[var(--ink-faint)]">
                  No recorded activity yet. Tool calls, approvals, and rollbacks show here as the
                  agent works.
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {entries.map((e) => {
                    const { label, tone } = describe(e);
                    return (
                      <li key={e.id} className="px-3 py-1.5 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate" style={{ color: tone }}>
                            {label}
                          </span>
                          <span className="text-[10px] text-[var(--ink-faint)] shrink-0">
                            {new Date(e.ts).toLocaleTimeString()}
                            {e.durationMs != null ? ` · ${e.durationMs}ms` : ''}
                          </span>
                        </div>
                        {e.argSummary ? (
                          <div className="text-[10px] text-[var(--ink-faint)] mt-0.5 truncate font-mono">
                            {e.argSummary}
                          </div>
                        ) : null}
                        {e.detail ? (
                          <div className="text-[10px] text-[var(--ink-faint)] mt-0.5 truncate">
                            {e.detail}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
