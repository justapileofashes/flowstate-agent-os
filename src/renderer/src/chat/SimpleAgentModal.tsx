import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc } from '../lib/ipc';
import { modalBackdrop, modalPanel } from '../lib/motion';
import { BrandMark } from '../lib/brand-mark';
import type { AgentDto } from '@shared/chat-types';

interface Props {
  onClose: () => void;
  onCreated: (agent: AgentDto) => void;
  /** Optional: when set, the dropdown shows "Create manually" which fires
   *  this callback instead of generating via LLM. */
  onManualCreate?: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'error'; message: string };

export function SimpleAgentModal({ onClose, onCreated, onManualCreate }: Props): JSX.Element {
  const [name, setName] = useState('');
  const [use, setUse] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [menuOpen, setMenuOpen] = useState(false);
  const useInputRef = useRef<HTMLTextAreaElement | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    useInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (menuOpen) setMenuOpen(false);
        else if (status.kind !== 'generating') onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, status.kind, menuOpen]);

  // Click-away for dropdown
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const canSubmit = use.trim().length >= 3 && status.kind !== 'generating';

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setStatus({ kind: 'generating' });
    try {
      const trimmedName = name.trim();
      const { agent } = await ipc.chat.generateAgent({
        ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
        use: use.trim(),
      });
      onCreated(agent);
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onUseKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  const generating = status.kind === 'generating';

  return (
    <motion.div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={generating ? undefined : onClose}
    >
      <motion.div
        className="card w-full max-w-md p-0 overflow-hidden"
        variants={modalPanel}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-[var(--border)] flex items-center gap-3">
          <span className="w-7 h-7 flex items-center justify-center text-[var(--accent)]">
            <BrandMark size={24} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold tracking-tight">New agent</h2>
            <p className="text-[11px] text-[var(--ink-muted)]">
              Tell a local model what you want — it fills in the rest.
            </p>
          </div>
        </header>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold mb-1.5">
              Name <span className="text-[var(--ink-faint)] normal-case tracking-normal font-normal">— optional</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-named from purpose if left empty"
              disabled={generating}
              maxLength={40}
              className="field"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold mb-1.5">
              Use
            </label>
            <textarea
              ref={useInputRef}
              value={use}
              onChange={(e) => setUse(e.target.value)}
              onKeyDown={onUseKeyDown}
              placeholder="What should this agent do? e.g. 'Review TypeScript pull requests, focus on type safety and tests'"
              rows={4}
              disabled={generating}
              maxLength={500}
              className="field resize-none"
            />
            <div className="mt-1 flex items-center justify-end text-[10px] text-[var(--ink-faint)]">
              <span>{use.length} / 500</span>
            </div>
          </div>

          {status.kind === 'error' ? (
            <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
              {status.message}
            </div>
          ) : null}

          {generating ? (
            <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
              <span className="dot dot-good dot-pulse" />
              Local model is designing your agent…
            </div>
          ) : null}
        </div>

        <footer className="px-6 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn text-xs"
            onClick={onClose}
            disabled={generating}
          >
            Cancel
          </button>

          {/* Split button: primary action + dropdown chevron */}
          <div ref={menuWrapRef} className="relative inline-flex">
            <button
              type="button"
              className="btn btn-primary text-xs rounded-r-none border-r border-[rgba(0,0,0,0.18)]"
              onClick={() => void submit()}
              disabled={!canSubmit}
            >
              {generating ? 'Generating…' : 'Create agent'}
            </button>
            <button
              type="button"
              aria-label="More create options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="btn btn-primary text-xs rounded-l-none px-2"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={generating}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2 4 5 7 8 4" />
              </svg>
            </button>

            <AnimatePresence>
              {menuOpen ? (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 bottom-full mb-1.5 w-56 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1 z-50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--surface-2)] transition-colors"
                    onClick={() => {
                      setMenuOpen(false);
                      void submit();
                    }}
                    disabled={!canSubmit}
                  >
                    <div className="font-medium text-[var(--ink)]">Generate with AI</div>
                    <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">
                      Local model fills in everything
                    </div>
                  </button>
                  {onManualCreate ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--surface-2)] transition-colors border-t border-[var(--border)]"
                      onClick={() => {
                        setMenuOpen(false);
                        onManualCreate();
                      }}
                    >
                      <div className="font-medium text-[var(--ink)]">Create manually</div>
                      <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">
                        Fill every field yourself (advanced)
                      </div>
                    </button>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
