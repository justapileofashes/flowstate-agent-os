import { useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { AgentDto } from '@shared/chat-types';
import { modalBackdrop, modalPanel } from '../lib/motion';

interface Props {
  agent: AgentDto;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteAgentModal({ agent, onClose, onDeleted }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await ipc.chat.deleteAgent(agent.id);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="w-[480px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6 space-y-4"
        variants={modalPanel}
      >
        <h2 className="text-lg font-semibold text-[var(--bad)]">Delete agent?</h2>
        <p className="text-sm">
          Delete <strong>{agent.name}</strong>? This removes all its chats and messages.
        </p>
        <p className="text-xs text-[var(--ink-faint)]">
          The workspace folder at <code className="kbd">{agent.workspacePath}</code> is preserved.
        </p>
        {error ? (
          <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary bg-[var(--bad)] border-[var(--bad)]"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
