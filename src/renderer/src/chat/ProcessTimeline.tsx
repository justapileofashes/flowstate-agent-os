// ProcessTimeline — real-time + persistent record of every tool call.
// Each row is a clickable dropdown: collapsed it shows verb + detail +
// state; expanded it reveals full args, result body, and timing.

import { useState, type JSX } from 'react';
import type { ToolCallView } from '../lib/chat-stream-helpers';

interface Props {
  toolCalls: ToolCallView[];
  /** Whether the stream is still active (pulses trailing row). */
  inFlight?: boolean;
  /** Optional "thinking" content — the partial assistant text the model
   *  has produced so far this turn. When provided, prepends an
   *  expandable "Thinking" row whose dropdown shows the running text. */
  thinkingContent?: string;
  /** Optional finished-turn summary content — same widget but rendered
   *  on completed assistant messages, captioned "Reasoning" instead. */
  finalContent?: string;
}

interface StepCopy {
  verb: string;
  detail: string;
}

function describe(call: ToolCallView): StepCopy {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const path = typeof args['path'] === 'string' ? args['path'] : undefined;
  const query =
    typeof args['query'] === 'string'
      ? args['query']
      : typeof args['pattern'] === 'string'
        ? args['pattern']
        : undefined;
  const command = typeof args['command'] === 'string' ? args['command'] : undefined;
  const title = typeof args['title'] === 'string' ? args['title'] : undefined;
  const language = typeof args['language'] === 'string' ? args['language'] : undefined;
  const source = typeof args['source'] === 'string' ? args['source'] : undefined;
  const modelName = typeof args['name'] === 'string' ? args['name'] : undefined;
  switch (call.name) {
    case 'read_file':       return { verb: 'Reading',      detail: path ?? 'file' };
    case 'write_file':      return { verb: 'Writing',      detail: path ?? 'file' };
    case 'edit_file':       return { verb: 'Editing',      detail: path ?? 'file' };
    case 'delete_file':     return { verb: 'Deleting',     detail: path ?? 'file' };
    case 'list_dir':        return { verb: 'Listing',      detail: path ?? 'directory' };
    case 'search_files':    return { verb: 'Searching workspace', detail: query ?? '' };
    case 'web_search':      return { verb: 'Searching the web', detail: query ?? '' };
    case 'shell':           return { verb: 'Running',      detail: command ?? 'shell command' };
    case 'run_code':        return { verb: 'Running code', detail: source ? source.split('\n')[0]!.slice(0, 50) : '' };
    case 'design_artifact': return { verb: 'Drafting artifact', detail: `${title ?? ''}${language ? ` (${language})` : ''}`.trim() };
    case 'generate_3d_model': return { verb: 'Modelling 3D', detail: modelName ?? '' };
    case 'brain_search':    return { verb: 'Searching notes', detail: query ?? '' };
    case 'brain_read':      return { verb: 'Reading note',     detail: path ?? '' };
    case 'brain_write':     return { verb: 'Writing note',     detail: path ?? '' };
    case 'brain_capture':   return { verb: 'Capturing thought', detail: query ?? '' };
    default:                return { verb: 'Using ' + call.name, detail: '' };
  }
}

function IconFor({ name }: { name: string }): JSX.Element {
  const base = {
    width: 14,
    height: 14,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'read_file':
    case 'edit_file':
    case 'write_file':
    case 'delete_file':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <path d="M3 1.5h5l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" />
          <path d="M8 1.5v3h3" />
        </svg>
      );
    case 'list_dir':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <path d="M1.5 3a1 1 0 0 1 1-1h2.5l1 1h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3z" />
        </svg>
      );
    case 'search_files':
    case 'web_search':
    case 'brain_search':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <circle cx="6" cy="6" r="3.5" />
          <path d="M9 9l3 3" />
        </svg>
      );
    case 'shell':
    case 'run_code':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <path d="M2 3l3 4-3 4" />
          <path d="M7 11h5" />
        </svg>
      );
    case 'generate_3d_model':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <path d="M7 1.5l5 2.8v5.4L7 12.5 2 9.7V4.3z" />
          <path d="M7 1.5v11 M2 4.3l5 2.8 5-2.8" />
        </svg>
      );
    case 'design_artifact':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <path d="M2 11l4-7 3 5 3-3 2 5" />
          <path d="M1.5 12.5h11" />
        </svg>
      );
    case 'brain_read':
    case 'brain_write':
    case 'brain_capture':
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <path d="M7 12c-2.4 0-4-1.6-4-3.5S4.6 5 7 5s4 1.6 4 3.5S9.4 12 7 12z" />
          <path d="M7 5V2" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 14 14" {...base}>
          <circle cx="7" cy="7" r="3" />
        </svg>
      );
  }
}

function formatArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/** Pretty-print the tool result. Web search returns JSON of hits — render
 *  them as a numbered list of titles for legibility. */
function formatResult(name: string, content: string): JSX.Element {
  if (!content) return <span style={{ color: 'var(--ink-faint)' }}>(no content)</span>;
  if (name === 'web_search') {
    try {
      const hits = JSON.parse(content) as Array<{ title?: string; snippet?: string; url?: string }>;
      if (Array.isArray(hits)) {
        return (
          <ol
            style={{
              margin: 0,
              padding: '4px 0 0 18px',
              color: 'var(--ink-muted)',
              fontSize: 11,
            }}
          >
            {hits.slice(0, 8).map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{h.title || h.url}</span>
                {h.snippet ? (
                  <div style={{ color: 'var(--ink-muted)', fontSize: 11, marginTop: 2 }}>
                    {h.snippet.slice(0, 200)}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        );
      }
    } catch {
      // fall through to raw
    }
  }
  return (
    <pre
      style={{
        margin: 0,
        padding: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--ink-muted)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: 240,
        overflow: 'auto',
      }}
    >
      {content.slice(0, 4000)}
      {content.length > 4000 ? '\n…' : ''}
    </pre>
  );
}

function ProcessRow({
  call,
  isLast,
  inFlight,
}: {
  call: ToolCallView;
  isLast: boolean;
  inFlight: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const running = call.result === undefined && isLast && inFlight;
  const failed = call.result !== undefined && !call.result.ok;
  const done = call.result !== undefined && call.result.ok;
  const { verb, detail } = describe(call);
  const stateColor = failed
    ? 'var(--bad)'
    : done
      ? 'var(--good)'
      : running
        ? 'var(--accent)'
        : 'var(--ink-faint)';
  const stateLabel = failed ? 'failed' : done ? 'done' : running ? 'running' : 'queued';

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="row"
        style={{
          width: '100%',
          gap: 10,
          padding: '6px 12px',
          alignItems: 'center',
          background: 'transparent',
          border: 0,
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--ink)',
        }}
      >
        <span
          aria-hidden
          style={{
            color: stateColor,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: 'rgba(240,236,226,0.04)',
            border: `1px solid ${stateColor}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 18px',
          }}
        >
          <IconFor name={call.name} />
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500, flex: '0 0 auto' }}>
          {verb}
        </span>
        {detail ? (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={detail}
          >
            {detail}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: stateColor,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            flex: '0 0 auto',
            animation: running ? 'brightness-pulse 1.4s var(--ease-mid) infinite' : 'none',
          }}
        >
          {stateLabel}
        </span>
        <span
          aria-hidden
          style={{
            color: 'var(--ink-faint)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            width: 12,
            display: 'inline-block',
            textAlign: 'center',
            transform: open ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform var(--d-fast) var(--ease)',
          }}
        >
          ▸
        </span>
      </button>
      {open ? (
        <div
          style={{
            padding: '4px 12px 10px 38px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 9.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                marginBottom: 4,
              }}
            >
              Tool
            </div>
            <code className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
              {call.name}
            </code>
          </div>
          <div>
            <div
              style={{
                fontSize: 9.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                marginBottom: 4,
              }}
            >
              Arguments
            </div>
            <pre
              style={{
                margin: 0,
                padding: 8,
                background: 'var(--bg-elev, var(--surface))',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--ink-muted)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {formatArgs(call.args)}
            </pre>
          </div>
          <div>
            <div
              style={{
                fontSize: 9.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                marginBottom: 4,
              }}
            >
              {failed ? 'Error' : 'Result'}
            </div>
            {call.result ? (
              <div
                style={{
                  padding: 8,
                  background: 'var(--bg-elev, var(--surface))',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}
              >
                {formatResult(call.name, call.result.content)}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                {running ? 'still running…' : 'not yet started'}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Expandable "Thinking" / "Reasoning" row. Mirrors ProcessRow styling so
 *  the whole panel reads as one continuous timeline. */
function ThinkingRow({
  content,
  inFlight,
  label,
}: {
  content: string;
  inFlight: boolean;
  label: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const stateColor = inFlight ? 'var(--accent)' : 'var(--good)';
  const stateLabel = inFlight ? 'thinking' : 'done';
  // Compact preview of the latest few words for the collapsed row.
  const preview = content.trim().replace(/\s+/g, ' ').slice(-90);
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="row"
        style={{
          width: '100%',
          gap: 10,
          padding: '6px 12px',
          alignItems: 'center',
          background: 'transparent',
          border: 0,
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--ink)',
        }}
      >
        <span
          aria-hidden
          style={{
            color: stateColor,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: 'rgba(240,236,226,0.04)',
            border: `1px solid ${stateColor}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 18px',
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 1.5a4 4 0 0 0-2.5 7.2V11a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V8.7A4 4 0 0 0 7 1.5z" />
            <path d="M5.5 12.5h3" />
          </svg>
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500, flex: '0 0 auto' }}>
          {label}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
            fontStyle: 'italic',
          }}
          title={preview}
        >
          {preview || (inFlight ? 'forming a response…' : 'no reasoning recorded')}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: stateColor,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            flex: '0 0 auto',
            animation: inFlight ? 'brightness-pulse 1.4s var(--ease-mid) infinite' : 'none',
          }}
        >
          {stateLabel}
        </span>
        <span
          aria-hidden
          style={{
            color: 'var(--ink-faint)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            width: 12,
            display: 'inline-block',
            textAlign: 'center',
            transform: open ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform var(--d-fast) var(--ease)',
          }}
        >
          ▸
        </span>
      </button>
      {open ? (
        <div style={{ padding: '4px 12px 10px 38px' }}>
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              marginBottom: 4,
            }}
          >
            {label}
          </div>
          <div
            style={{
              padding: 8,
              background: 'var(--bg-elev, var(--surface))',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--ink-muted)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 320,
              overflow: 'auto',
            }}
          >
            {content.length > 0 ? content : inFlight ? 'Waiting for the model to begin…' : '(empty)'}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProcessTimeline({
  toolCalls,
  inFlight = false,
  thinkingContent,
  finalContent,
}: Props): JSX.Element | null {
  const hasThinking = inFlight && thinkingContent !== undefined;
  const hasFinal = !inFlight && finalContent !== undefined && finalContent.length > 0;
  if (toolCalls.length === 0 && !hasThinking && !hasFinal) return null;
  const stepCount = toolCalls.length + (hasThinking || hasFinal ? 1 : 0);
  return (
    <div
      aria-label="Agent process"
      style={{
        marginTop: 8,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '8px 0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="eyebrow"
        style={{
          fontSize: 9.5,
          padding: '0 12px 4px',
          color: 'var(--ink-faint)',
        }}
      >
        Process · {stepCount} step{stepCount === 1 ? '' : 's'}
        {inFlight ? (
          <span
            className="dot dot-good dot-pulse"
            style={{ marginLeft: 8, display: 'inline-block', verticalAlign: 'middle' }}
          />
        ) : null}
      </div>
      {hasThinking ? (
        <ThinkingRow content={thinkingContent ?? ''} inFlight label="Thinking" />
      ) : null}
      {hasFinal ? (
        <ThinkingRow content={finalContent ?? ''} inFlight={false} label="Reasoning" />
      ) : null}
      {toolCalls.map((c, i) => (
        <ProcessRow
          key={c.id}
          call={c}
          isLast={i === toolCalls.length - 1}
          inFlight={inFlight}
        />
      ))}
    </div>
  );
}
