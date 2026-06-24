import { useEffect, useState } from 'react';
import type { ToolCallView } from '../lib/chat-stream-helpers';

interface Props {
  call: ToolCallView;
}

export function ToolCallCard({ call }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const argSummary = primaryArg(call.args);
  const running = call.result === undefined;
  const failed = call.result !== undefined && !call.result.ok;

  return (
    <div className="toolcall" style={failed ? { borderColor: 'var(--bad)' } : undefined}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="toolcall-head"
        style={{ width: '100%', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ color: 'var(--ink-muted)' }}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{ display: 'inline-block', verticalAlign: -1, marginRight: 6 }}
          >
            <path d="M2 4l4-2 4 2v4l-4 2-4-2V4z M6 2v4 M2 4l4 2 4-2" stroke="currentColor" />
          </svg>
          tool
        </span>
        <span className="name">{call.name}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)', fontSize: 11 }}>
          {running ? (
            <span className="dot dot-good dot-pulse" style={{ display: 'inline-block' }} />
          ) : failed ? (
            <span style={{ color: 'var(--bad)' }}>error</span>
          ) : (
            'done'
          )}
        </span>
      </button>
      {argSummary ? <div className="args">{argSummary}</div> : null}
      {/* Citation cards for web_search — render hits as clickable cards. */}
      {call.name === 'web_search' && call.result?.ok ? (
        <CitationCards content={call.result.content} />
      ) : null}

      {/* File generation: when an agent wrote/edited a file, show a quick
          "Open" button that reveals it in the OS file explorer / editor. */}
      {(call.name === 'write_file' || call.name === 'edit_file') && call.result?.ok ? (
        <WroteFile args={call.args} />
      ) : null}
      {open ? (
        <div className="args" style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--ink-faint)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            args
          </div>
          <pre style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', maxHeight: 192, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(call.args, null, 2)}
          </pre>
          {call.result ? (
            <>
              <div style={{ color: 'var(--ink-faint)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '8px 0 4px' }}>
                {call.result.ok ? 'result' : 'error'}
              </div>
              <pre style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', maxHeight: 256, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {call.result.content}
              </pre>
            </>
          ) : (
            <div style={{ color: 'var(--ink-faint)', marginTop: 6 }}>running…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function primaryArg(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const o = args as Record<string, unknown>;
  const preferKeys = ['path', 'command', 'pattern', 'query', 'url', 'title'];
  for (const k of preferKeys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return `${k}: "${truncate(v, 200)}"`;
  }
  const first = Object.entries(o)[0];
  if (!first) return '';
  const [k, v] = first;
  if (typeof v === 'string') return `${k}: "${truncate(v, 200)}"`;
  return `${k}: ${truncate(JSON.stringify(v), 200)}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function WroteFile({ args }: { args: unknown }): JSX.Element | null {
  if (!args || typeof args !== 'object') return null;
  const path = (args as { path?: unknown }).path;
  if (typeof path !== 'string' || path.length === 0) return null;
  return (
    <div className="args" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--good)', fontSize: 11 }}>file generated</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {path}
      </span>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        style={{ height: 20, padding: '0 8px', fontSize: 10 }}
        onClick={() => void window.flowstate?.shellOpen?.path?.(path)}
        title="Open in file explorer"
      >
        Open
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        style={{ height: 20, padding: '0 8px', fontSize: 10 }}
        onClick={() => void window.flowstate?.shellOpen?.vscode?.(path)}
        title="Open in VS Code"
      >
        Edit
      </button>
    </div>
  );
}

function CitationCards({ content }: { content: string }): JSX.Element | null {
  const hits = (() => {
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? (parsed as Array<{ title?: string; snippet?: string; url?: string }>) : [];
    } catch {
      return [];
    }
  })();
  const shown = hits.slice(0, 5);
  // "Reading" focus rotates through the cards every ~2s so the user can
  // see which source the agent is skimming. The active snippet scrolls
  // through its text via a CSS-keyframe translate, simulating the agent's
  // eye drifting down the page.
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (shown.length <= 1) return;
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % shown.length), 2200);
    return () => clearInterval(id);
  }, [shown.length]);

  if (shown.length === 0) return null;

  return (
    <div className="args" style={{ display: 'grid', gap: 6, padding: '8px 10px' }}>
      {shown.map((h, i) => {
        const active = i === activeIdx;
        const snippet = h.snippet ?? '';
        return (
          <a
            key={i}
            href={h.url}
            onClick={(e) => {
              e.preventDefault();
              if (h.url) void window.flowstate?.shellOpen?.url?.(h.url);
            }}
            style={{
              display: 'block',
              padding: 8,
              background: active ? 'var(--surface-3)' : 'var(--surface-2)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 6,
              textDecoration: 'none',
              color: 'var(--ink)',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              transition: 'background var(--d-base) var(--ease), border-color var(--d-base) var(--ease)',
            }}
            title={h.url}
          >
            <div
              className="row"
              style={{
                fontSize: 12,
                color: 'var(--ink-strong)',
                marginBottom: 2,
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.title || h.url || 'Result'}
              </span>
              {active ? (
                <span
                  className="pill streaming"
                  style={{ height: 16, padding: '0 6px', fontSize: 9 }}
                >
                  <span className="dot" />
                  <span>reading</span>
                </span>
              ) : null}
            </div>
            {snippet ? (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--ink-muted)',
                  lineHeight: 1.5,
                  ...(active
                    ? {
                        // Fully reveal the snippet on the active card so
                        // the user can actually read what the agent is
                        // "skimming". Inactive cards stay clamped.
                        maxHeight: 120,
                        overflow: 'auto',
                        background: 'var(--bg-elev, var(--surface))',
                        borderRadius: 4,
                        padding: '4px 6px',
                        marginTop: 2,
                      }
                    : {
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }),
                }}
              >
                {snippet}
              </div>
            ) : null}
            {h.url ? (
              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4 }}>
                {h.url.replace(/^https?:\/\//, '').slice(0, 64)}
              </div>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}
