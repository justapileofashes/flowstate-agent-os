import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ipc } from '../lib/ipc';
import type {
  BrainCategoryDto,
  BrainListEntryDto,
  BrainNoteDto,
  BrainSearchHitDto,
  BrainStatusDto,
} from '@shared/ipc-channels';

const CATEGORIES: Array<{ id: BrainCategoryDto; label: string; hint: string }> = [
  { id: 'inbox', label: 'Inbox', hint: 'Fleeting captures' },
  { id: 'projects', label: 'Projects', hint: 'Finite outcome + deadline' },
  { id: 'areas', label: 'Areas', hint: 'Ongoing responsibilities' },
  { id: 'resources', label: 'Resources', hint: 'Topics + knowledge' },
  { id: 'archive', label: 'Archive', hint: 'Completed / inactive' },
  { id: 'daily', label: 'Daily', hint: 'One note per day' },
  { id: 'routines', label: 'Routines', hint: 'Recurring patterns' },
];

export function Brain(): JSX.Element {
  const [status, setStatus] = useState<BrainStatusDto | null>(null);
  const [activeCategory, setActiveCategory] = useState<BrainCategoryDto | 'all'>('all');
  const [notes, setNotes] = useState<BrainListEntryDto[]>([]);
  const [selected, setSelected] = useState<BrainNoteDto | null>(null);
  const [captureText, setCaptureText] = useState('');
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchHits, setSearchHits] = useState<BrainSearchHitDto[] | null>(null);

  const refresh = useCallback(async () => {
    const st = await ipc.brain.status();
    setStatus(st);
    const list = await ipc.brain.list(activeCategory === 'all' ? undefined : activeCategory);
    setNotes(list);
  }, [activeCategory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function doCapture(): Promise<void> {
    const text = captureText.trim();
    if (text.length === 0) return;
    try {
      const res = await ipc.brain.capture(text, 'user');
      setCaptureText('');
      setCaptureMsg(`Captured → ${res.relPath}`);
      setTimeout(() => setCaptureMsg(null), 3000);
      void refresh();
    } catch (err) {
      setCaptureMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function doSearch(): Promise<void> {
    const q = search.trim();
    if (q.length === 0) {
      setSearchHits(null);
      return;
    }
    try {
      const hits = await ipc.brain.search(q, 25);
      setSearchHits(hits);
    } catch {
      setSearchHits([]);
    }
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void doSearch();
    } else if (e.key === 'Escape') {
      setSearch('');
      setSearchHits(null);
    }
  }

  async function openNote(relPath: string): Promise<void> {
    try {
      const note = await ipc.brain.read(relPath);
      setSelected(note);
    } catch (err) {
      console.warn(err);
    }
  }

  const visibleList = useMemo(() => searchHits ?? notes, [searchHits, notes]);

  return (
    <div
      className="screen-enter h-full"
      style={{ display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}
    >
      <aside
        style={{
          borderRight: '1px solid var(--border)',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div>
          <div className="eyebrow">Brain</div>
          <div
            style={{
              marginTop: 6,
              color: 'var(--ink-strong)',
              fontSize: 20,
              fontWeight: 300,
              letterSpacing: '-0.015em',
            }}
          >
            {status?.totalNotes ?? 0} notes
          </div>
          <div className="muted text-xs mt-1 mono" style={{ wordBreak: 'break-all' }}>
            {status?.vaultPath ?? '~/Vault'}
          </div>
        </div>

        <input
          className="field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Search notes…"
        />
        <input
          className="field"
          value={captureText}
          onChange={(e) => setCaptureText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void doCapture();
            }
          }}
          placeholder="Quick capture…"
          style={{ borderColor: 'var(--accent)' }}
        />
        {captureMsg ? (
          <div className="text-[10px] text-[var(--good)]">{captureMsg}</div>
        ) : null}

        <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className={'btn btn-sm ' + (activeCategory === 'all' ? '' : 'btn-ghost')}
            onClick={() => setActiveCategory('all')}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'btn btn-sm ' + (activeCategory === c.id ? '' : 'btn-ghost')}
              onClick={() => setActiveCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="scroll" style={{ flex: 1, overflowY: 'auto', margin: '0 -8px' }}>
          {visibleList.length === 0 ? (
            <div className="text-xs text-[var(--ink-faint)] px-3 py-4">
              {searchHits ? 'No matches.' : 'No notes here.'}
            </div>
          ) : (
            visibleList.map((n) => {
              const hit = (n as BrainSearchHitDto).snippet;
              const active = selected?.relPath === n.relPath;
              return (
                <div
                  key={n.relPath}
                  onClick={() => void openNote(n.relPath)}
                  style={{
                    padding: '10px 12px',
                    margin: '0 4px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: active ? 'rgba(240,236,226,0.06)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 13, color: 'var(--ink-strong)' }}>{n.title}</div>
                  <div className="muted text-xs mt-1">
                    {n.category} · {new Date(n.updatedAt).toLocaleDateString()}
                    {hit ? ` · ${hit.slice(0, 64)}` : ''}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {status ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void ipc.brain.openVault()}
            style={{ alignSelf: 'flex-start' }}
          >
            Open vault folder ↗
          </button>
        ) : null}
      </aside>

      <div className="scroll" style={{ padding: '40px 56px', overflowY: 'auto' }}>
        {selected ? (
          <>
            <div className="muted text-xs mono">
              {new Date(selected.updatedAt).toLocaleString()}
            </div>
            <h1
              style={{
                fontWeight: 300,
                fontSize: 36,
                color: 'var(--ink-strong)',
                letterSpacing: '-0.02em',
                margin: '8px 0 16px',
              }}
            >
              {selected.title}
            </h1>
            {selected.tags.length > 0 ? (
              <div className="row gap-1 mb-4" style={{ flexWrap: 'wrap' }}>
                {selected.tags.map((t) => (
                  <span key={t} className="kbd">
                    #{t}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="markdown text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.body}</ReactMarkdown>
            </div>
          </>
        ) : (
          <div className="muted">Select a note from the left.</div>
        )}
      </div>
    </div>
  );
}
