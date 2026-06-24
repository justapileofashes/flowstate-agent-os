// Multi-select view picker. Each enabled view becomes an additional
// side-panel column next to the conversation. Conversation is always on.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ChatView =
  | 'preview'
  | 'artifact'
  | 'changes'
  | 'terminal'
  | 'files'
  | 'tasks'
  | 'plan';

interface ViewDef {
  id: ChatView;
  label: string;
  hint: string;
}

export const CHAT_VIEWS: ViewDef[] = [
  { id: 'preview', label: 'Preview', hint: 'Rendered last agent reply' },
  { id: 'artifact', label: 'Artifact', hint: 'Live HTML/SVG iframe' },
  { id: 'changes', label: 'Changes', hint: 'File writes + deletes' },
  { id: 'terminal', label: 'Terminal', hint: 'Shell command output' },
  { id: 'files', label: 'Files', hint: 'Touched-file list' },
  { id: 'tasks', label: 'Tasks', hint: 'Extracted checklists' },
  { id: 'plan', label: 'Plan', hint: 'Plan + per-agent tabs' },
];

interface Props {
  open: Set<ChatView>;
  onToggle: (v: ChatView) => void;
}

export function ViewsButton({ open, onToggle }: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const count = open.size;

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        title="Toggle side panels"
      >
        <span style={{ color: 'var(--ink-faint)' }}>View:</span>
        <span>{count === 0 ? 'Conversation' : `${count} panel${count === 1 ? '' : 's'}`}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.2" />
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
            className="dropdown glass"
            style={{ minWidth: 260 }}
          >
            {CHAT_VIEWS.map((v) => {
              const active = open.has(v.id);
              return (
                <div
                  key={v.id}
                  role="menuitemcheckbox"
                  aria-checked={active}
                  className="dropdown-item"
                  onClick={() => onToggle(v.id)}
                  style={{ alignItems: 'flex-start' }}
                >
                  <span style={{ color: active ? 'var(--accent)' : 'transparent', width: 8 }}>•</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--ink)' }}>{v.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{v.hint}</div>
                  </span>
                </div>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
