// Shared building blocks for the Business screens — monochrome, token-only,
// matching the rest of Flowstate (card / btn / pill / field / modal).

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CycleStatus, PendingStatus, RiskLevel, RunStatus, StopReason, TaskStatus } from '@shared/business/types';

const I = (d: React.ReactNode, size = 14): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="none" width={size} height={size} aria-hidden="true">
    {d}
  </svg>
);

export const Icon = {
  play: I(<path d="M5 3.5l7 4.5-7 4.5z" stroke="currentColor" strokeLinejoin="round" />),
  stop: I(<rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" />),
  pause: I(<path d="M5.5 3.5v9 M10.5 3.5v9" stroke="currentColor" strokeLinecap="round" />),
  plus: I(<path d="M8 3v10 M3 8h10" stroke="currentColor" strokeLinecap="round" />),
  x: I(<path d="M3.5 3.5l9 9 M12.5 3.5l-9 9" stroke="currentColor" strokeLinecap="round" />, 13),
  check: I(<path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />, 13),
  chev: I(<path d="M4 6l4 4 4-4" stroke="currentColor" />, 13),
  chevR: I(<path d="M6 4l4 4-4 4" stroke="currentColor" />, 13),
  clock: I(<><circle cx="8" cy="8" r="5.5" stroke="currentColor" /><path d="M8 5v3l2 1.5" stroke="currentColor" /></>),
  inbox: I(<><path d="M2.5 9.5l1.8-5.2a1 1 0 01.95-.68h5.5a1 1 0 01.95.68l1.8 5.2v3a1 1 0 01-1 1h-9a1 1 0 01-1-1z" stroke="currentColor" /><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" stroke="currentColor" /></>),
  shield: I(<path d="M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4z" stroke="currentColor" strokeLinejoin="round" />),
  spark: I(<path d="M8 2v3 M8 11v3 M2 8h3 M11 8h3 M4 4l2 2 M10 10l2 2 M12 4l-2 2 M6 10l-2 2" stroke="currentColor" strokeLinecap="round" />),
  key: I(<><circle cx="5.5" cy="10.5" r="2.5" stroke="currentColor" /><path d="M7.3 8.7L13 3 M11 5l1.5 1.5" stroke="currentColor" strokeLinecap="round" /></>),
  download: I(<path d="M8 2.5v8 M4.5 7.5L8 11l3.5-3.5 M3 13.5h10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />),
  help: I(<><circle cx="8" cy="8" r="5.5" stroke="currentColor" /><path d="M6.4 6.3a1.7 1.7 0 113 1.1c-.6.4-1.4.8-1.4 1.6 M8 11.2v.1" stroke="currentColor" strokeLinecap="round" /></>),
  send: I(<path d="M2.5 8l11-5-4 11-2-4.5z" stroke="currentColor" strokeLinejoin="round" />),
  search: I(<><circle cx="7" cy="7" r="4" stroke="currentColor" /><path d="M10 10l3.5 3.5" stroke="currentColor" strokeLinecap="round" /></>),
  alert: I(<><path d="M8 2.5l6 10.5H2z" stroke="currentColor" strokeLinejoin="round" /><path d="M8 6.5v3 M8 11.2v.1" stroke="currentColor" strokeLinecap="round" /></>),
};

export type PillKind = '' | 'good' | 'bad' | 'streaming';

export function Pill({ kind = '', label, title }: { kind?: PillKind; label: string; title?: string }): JSX.Element {
  return (
    <span className={`pill ${kind}`} title={title}>
      <span className="dot" />
      <span>{label}</span>
    </span>
  );
}

export const CYCLE_PILL: Record<CycleStatus, { kind: PillKind; label: string }> = {
  running: { kind: 'streaming', label: 'running' },
  done: { kind: 'good', label: 'done' },
  failed: { kind: 'bad', label: 'failed' },
  aborted: { kind: '', label: 'aborted' },
  budget_stopped: { kind: 'bad', label: 'budget stop' },
  skipped: { kind: '', label: 'skipped' },
};

export const RUN_PILL: Record<RunStatus, { kind: PillKind; label: string }> = {
  running: { kind: 'streaming', label: 'running' },
  done: { kind: 'good', label: 'done' },
  failed: { kind: 'bad', label: 'failed' },
  stopped: { kind: '', label: 'stopped' },
};

export const TASK_PILL: Record<TaskStatus, { kind: PillKind; label: string }> = {
  backlog: { kind: '', label: 'backlog' },
  todo: { kind: '', label: 'to do' },
  in_progress: { kind: 'streaming', label: 'in progress' },
  awaiting_approval: { kind: '', label: 'needs you' },
  done: { kind: 'good', label: 'done' },
  failed: { kind: 'bad', label: 'failed' },
  rejected: { kind: 'bad', label: 'rejected' },
  skipped: { kind: '', label: 'skipped' },
};

export const ACTION_PILL: Record<PendingStatus, { kind: PillKind; label: string }> = {
  pending: { kind: '', label: 'waiting' },
  approved: { kind: 'good', label: 'approved' },
  executing: { kind: 'streaming', label: 'executing' },
  executed: { kind: 'good', label: 'done' },
  failed: { kind: 'bad', label: 'failed' },
  rejected: { kind: '', label: 'rejected' },
  expired: { kind: '', label: 'expired' },
};

export const STOP_LABEL: Record<StopReason, string> = {
  goal_achieved: 'goal achieved',
  agent_done_unverified: 'finished (unverified)',
  max_iterations: 'step limit',
  budget_exhausted: 'budget limit',
  no_progress: 'no progress',
  timeout: 'time limit',
  aborted: 'aborted',
  error: 'error',
};

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'low risk', medium: 'medium risk', high: 'high risk' };

const GLYPHS: Record<string, string> = {
  ceo: 'CE',
  researcher: 'RS',
  planner: 'PL',
  coder: 'CD',
  copywriter: 'CW',
  sdr: 'SD',
  support: 'SU',
  ads: 'AD',
  finance: 'FI',
  kaizen: 'KZ',
  drift: 'DR',
};

export const ROLE_LABEL: Record<string, string> = {
  ceo: 'CEO',
  researcher: 'Researcher',
  planner: 'Planner',
  coder: 'Coder',
  copywriter: 'Copywriter',
  sdr: 'SDR',
  support: 'Support',
  ads: 'Ads',
  finance: 'Finance',
  kaizen: 'Lessons review',
  drift: 'Drift check',
  other: 'Other',
};

export function RoleBadge({ role }: { role: string | null | undefined }): JSX.Element {
  const r = role ?? '';
  return (
    <span className="biz-rolebadge" title={ROLE_LABEL[r] ?? r}>
      {GLYPHS[r] ?? (r.slice(0, 2).toUpperCase() || '·')}
    </span>
  );
}

export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="markdown biz-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={`biz-switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="biz-switch-knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="ap-toggle" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  foot,
  wide,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  foot?: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal biz-modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="modal-head">
          <span className="biz-modal-title">{title}</span>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            {Icon.x}
          </button>
        </div>
        <div className="modal-body scroll">{children}</div>
        {foot && <div className="biz-modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function CardHead({ title, right, sub }: { title: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode }): JSX.Element {
  return (
    <div className="biz-card-h">
      <div>
        <span>{title}</span>
        {sub && <div className="biz-card-sub">{sub}</div>}
      </div>
      {right && <div className="row gap-2">{right}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="biz-empty-line muted">{children}</div>;
}

export function ErrorLine({ error }: { error: string }): JSX.Element | null {
  return error ? <div className="fc-errline">{error}</div> : null;
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'good' }): JSX.Element {
  return (
    <div className="biz-stat">
      <div className="biz-stat-label">{label}</div>
      <div className={`biz-stat-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="biz-stat-sub">{sub}</div>}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }): JSX.Element {
  return (
    <div className="fc-field-label">
      {children}
      {hint && <span className="faint biz-hint"> {hint}</span>}
    </div>
  );
}

/** Editable list of short strings (goals, dos/don'ts, price points). */
export function ListEditor({
  values,
  onChange,
  placeholder,
  max = 10,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
}): JSX.Element {
  const rows = values.length ? values : [''];
  return (
    <div className="biz-goals">
      {rows.map((v, i) => (
        <div key={i} className="biz-goalrow">
          <input
            className="field"
            value={v}
            placeholder={placeholder}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {rows.length > 1 && (
            <button className="btn btn-sm btn-ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove">
              {Icon.x}
            </button>
          )}
        </div>
      ))}
      {rows.length < max && (
        <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...rows, ''])}>
          {Icon.plus}
          <span>Add</span>
        </button>
      )}
    </div>
  );
}

export const cleanList = (xs: string[]): string[] => xs.map((x) => x.trim()).filter(Boolean);
