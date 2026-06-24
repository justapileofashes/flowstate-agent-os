import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { AgentDto } from '@shared/chat-types';
import { modalBackdrop, modalPanel } from '../lib/motion';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

interface Props {
  agents: AgentDto[];
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onOpenAgent: (agent: AgentDto) => void;
}

export function CommandPalette({
  agents,
  onClose,
  onOpenSettings,
  onOpenDashboard,
  onOpenAgent,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: CommandItem[] = useMemo(() => {
    const out: CommandItem[] = [
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        hint: '◇',
        group: 'Navigate',
        run: onOpenDashboard,
      },
      {
        id: 'nav-settings',
        label: 'Open Settings',
        hint: 'S',
        group: 'Navigate',
        run: onOpenSettings,
      },
      ...agents.map((a) => ({
        id: `open-${a.id}`,
        label: `Open ${a.name}`,
        hint: a.specialtyTags.slice(0, 2).join(', '),
        group: 'Agents',
        run: () => onOpenAgent(a),
      })),
    ];
    if (!query.trim()) return out;
    const q = query.trim().toLowerCase();
    return out.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.hint?.toLowerCase().includes(q) ?? false) ||
        i.group.toLowerCase().includes(q),
    );
  }, [agents, query, onOpenDashboard, onOpenSettings, onOpenAgent]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[cursor];
      if (item) {
        item.run();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  // Group items for display
  const grouped = items.reduce<Record<string, { item: CommandItem; idx: number }[]>>(
    (acc, item, idx) => {
      const list = acc[item.group] ?? [];
      list.push({ item, idx });
      acc[item.group] = list;
      return acc;
    },
    {},
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={onClose}
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="w-[560px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-2xl overflow-hidden"
        variants={modalPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type to search agents and actions…"
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {Object.entries(grouped).map(([group, entries]) => (
            <div key={group}>
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
                {group}
              </div>
              {entries.map(({ item, idx }) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                  onMouseEnter={() => setCursor(idx)}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                    idx === cursor ? 'bg-[var(--accent-soft)]' : 'hover:bg-white/5'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.hint ? (
                    <span className="text-xs text-[var(--ink-faint)]">{item.hint}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
          {items.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[var(--ink-faint)] text-center">
              No matches.
            </div>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
