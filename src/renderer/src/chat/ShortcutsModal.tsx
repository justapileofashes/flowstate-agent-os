import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { modalBackdrop, modalPanel } from '../lib/motion';
import { BrandMark } from '../lib/brand-mark';

export interface ShortcutEntry {
  keys: string[];
  label: string;
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['Ctrl', 'K'], label: 'Open command palette' },
  { keys: ['Enter'], label: 'Send chat message' },
  { keys: ['Shift', 'Enter'], label: 'Newline in composer' },
  { keys: ['Ctrl', 'Enter'], label: 'Route from Ask box / generate agent' },
  { keys: ['Esc'], label: 'Close dialog or palette' },
  { keys: ['↑', '↓'], label: 'Navigate command palette' },
  { keys: ['Double-click'], label: 'Rename chat in sidebar' },
];

interface Props {
  onClose: () => void;
  /** If provided, shows a "Don't show again" checkbox that calls back on close. */
  onDismissPreference?: (dontShowAgain: boolean) => void;
}

export function ShortcutsModal({ onClose, onDismissPreference }: Props): JSX.Element {
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dontShow]);

  function handleClose(): void {
    onDismissPreference?.(dontShow);
    onClose();
  }

  return (
    <motion.div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={handleClose}
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
            <h2 className="text-base font-semibold tracking-tight">Welcome to Flowstate</h2>
            <p className="text-[11px] text-[var(--ink-muted)]">
              A few shortcuts to keep you in flow.
            </p>
          </div>
        </header>

        <div className="px-6 py-5">
          <ShortcutsList />
        </div>

        <footer className="px-6 py-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
          {onDismissPreference ? (
            <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={(e) => setDontShow(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Don&apos;t show again
            </label>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-primary text-xs" onClick={handleClose}>
            Got it
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}

/** Reusable list — used inside the welcome modal AND the Settings page. */
export function ShortcutsList(): JSX.Element {
  return (
    <ul className="divide-y divide-[var(--border)]">
      {SHORTCUTS.map((s) => (
        <li key={s.label} className="flex items-center justify-between py-2.5">
          <span className="text-sm text-[var(--ink)]">{s.label}</span>
          <span className="flex items-center gap-1">
            {s.keys.map((k, i) => (
              <span key={`${k}-${i}`} className="kbd">
                {k}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
