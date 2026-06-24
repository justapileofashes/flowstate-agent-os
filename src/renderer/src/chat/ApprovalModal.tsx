import { useState } from 'react';
import { motion } from 'framer-motion';
import { modalBackdrop, sheetUp } from '../lib/motion';

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
}

interface Props {
  pending: PendingApproval;
  onRespond: (
    decision: 'allow-once' | 'allow-rest' | 'deny',
    reason?: string,
  ) => void;
}

export function ApprovalModal({ pending, onRespond }: Props): JSX.Element {
  const [reason, setReason] = useState('');
  const isShell = pending.toolName === 'run_shell';
  const command = isShell ? (pending.args as { command?: string }).command ?? '' : '';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 pb-8"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="w-[640px] max-w-[90vw] rounded-lg border border-[var(--accent)]/40 bg-[var(--bg)] p-5 space-y-3 shadow-xl"
        variants={sheetUp}
      >
        <header className="flex items-center gap-2">
          <span className="text-[var(--accent)]">!</span>
          <h3 className="text-base font-semibold">Approval needed</h3>
        </header>
        <div className="text-sm space-y-1">
          <div>
            <span className="text-[var(--ink-faint)]">Tool:</span>{' '}
            <span className="kbd">{pending.toolName}</span>
          </div>
          <div className="text-xs text-[var(--ink-faint)]">
            cwd: <code className="kbd">{pending.cwd}</code>
          </div>
        </div>
        {isShell ? (
          <pre className="kbd p-3 whitespace-pre-wrap break-all text-sm">{command}</pre>
        ) : (
          <pre className="kbd p-3 whitespace-pre-wrap break-all text-xs max-h-48 overflow-auto">
            {JSON.stringify(pending.args, null, 2)}
          </pre>
        )}
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional reason if denying"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => onRespond('deny', reason || undefined)}
          >
            Deny
          </button>
          <button type="button" className="btn" onClick={() => onRespond('allow-once')}>
            Allow once
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onRespond('allow-rest')}
          >
            Allow rest of chat
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
