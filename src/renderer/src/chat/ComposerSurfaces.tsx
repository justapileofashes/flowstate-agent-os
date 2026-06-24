// Composer surface sub-components: the snippet fill-in modal, @mention chips,
// and the project-convention chip. Design source: Claude Design devtools-composer.jsx.

import { useEffect, useRef, useState, type JSX } from 'react';
import type { SnippetDto } from '@shared/ipc-channels';
import { snippetVars, expandSnippet } from '../lib/snippets-client';

export function MentionChip({ path, onRemove }: { path: string; onRemove: () => void }): JSX.Element {
  const base = path.split('/').pop();
  return (
    <span className="mchip" title={path}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M7.5 3.5L4 7a1.6 1.6 0 102.3 2.3l3.2-3.2a2.4 2.4 0 10-3.4-3.4L2.7 5.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <span className="mchip-name">{base}</span>
      <button onClick={onRemove} aria-label={`Remove ${base}`}>
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" /></svg>
      </button>
    </span>
  );
}

export function ConvChip({ conv }: { conv: { files: string[]; preamble: string } }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!conv.files.length) return null;
  const head = conv.files[0] + (conv.files.length > 1 ? ` +${conv.files.length - 1}` : '');
  return (
    <span className="conv-chip-wrap" ref={ref}>
      <button className={'conv-chip' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} title="House style feeding this agent">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M3 1.5h4.5L9.5 3.5V10a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5Z" stroke="currentColor" strokeWidth="1" />
          <path d="M4.3 6h3.4 M4.3 8h2.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span>convention: {head}</span>
      </button>
      {open && (
        <div className="conv-pop dropdown glass" style={{ bottom: 'calc(100% + 6px)', top: 'auto', left: 0, right: 'auto', width: 320 }}>
          <div className="conv-pop-head">Feeding house style</div>
          {conv.files.map((f) => (
            <div key={f} className="conv-pop-file mono">{f}</div>
          ))}
          <div className="conv-pop-pre">{conv.preamble}</div>
        </div>
      )}
    </span>
  );
}

export function FillInModal({
  snippet,
  onCancel,
  onInsert,
}: {
  snippet: SnippetDto;
  onCancel: () => void;
  onInsert: (text: string) => void;
}): JSX.Element {
  const vars = snippetVars(snippet.body);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    vars.forEach((v) => { o[v.name] = v.def || ''; });
    return o;
  });
  const preview = expandSnippet(snippet.body, vals);
  const firstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal glass fill-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="row gap-2" style={{ alignItems: 'baseline' }}>
            <span style={{ color: 'var(--ink-strong)', fontSize: 14 }}>{snippet.label}</span>
            <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: 11 }}>:{snippet.name}</span>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor" /></svg>
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="fill-grid">
            {vars.map((v, i) => (
              <label key={v.name} className="fill-field">
                <span className="mono">{v.name}</span>
                <input
                  ref={i === 0 ? firstRef : null}
                  className="field"
                  value={vals[v.name] ?? ''}
                  placeholder={v.def || '—'}
                  onChange={(e) => setVals((s) => ({ ...s, [v.name]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div>
            <div className="fill-preview-label">Preview</div>
            <div className="fill-preview mono">{preview}</div>
          </div>
        </div>
        <div className="row" style={{ padding: '0 18px 18px', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onInsert(preview)}>Insert</button>
        </div>
      </div>
    </div>
  );
}
