// Approval queue drawer: everything waiting for the owner, with the full
// decrypted action, why it was gated, the skill's rubric, and approve (with
// an optional note) / reject (reason required — it becomes a lesson).

import { useEffect, useState } from 'react';
import type { PendingActionDetailDto, PendingActionDto } from '@shared/business/types';
import { biz, errText, fmtAgo, fmtCredits, fmtIn, useBiz, useBizLive } from './api';
import { ACTION_PILL, Empty, ErrorLine, Icon, Pill, RISK_LABEL, RoleBadge, Segmented } from './ui';

const CATEGORY_LABEL: Record<string, string> = {
  publish: 'Publish',
  outbound: 'Outbound email',
  ad_budget: 'Ad budget',
  external_write: 'External write',
  config_edit: 'Config change',
  validation: 'Validation',
  deploy: 'Deploy',
  pricing: 'Pricing',
  refund: 'Refund',
};

function ArgsView({ action }: { action: PendingActionDetailDto }): JSX.Element {
  const a = (action.args ?? {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '');
  switch (action.skillKey) {
    case 'email.send':
      return (
        <div className="biz-email">
          <div className="biz-email-row"><span className="faint">To</span><span className="mono">{s('to')}</span></div>
          <div className="biz-email-row"><span className="faint">Subject</span><span>{s('subject')}</span></div>
          <div className="biz-email-body">{s('body')}</div>
          {s('kind') === 'outreach' && <div className="biz-setting-sub">An opt-out line is added automatically if missing.</div>}
        </div>
      );
    case 'github.open_pr': {
      const files = Array.isArray(a['files']) ? (a['files'] as Array<{ path: string; content: string }>) : [];
      return (
        <div>
          <div className="biz-action-text">{s('body')}</div>
          {files.map((f) => (
            <details key={f.path} className="biz-file">
              <summary className="mono">{f.path}</summary>
              <pre className="biz-action-pre mono">{f.content.slice(0, 8_000)}</pre>
            </details>
          ))}
        </div>
      );
    }
    case 'config.propose_change':
      return (
        <div>
          <div className="biz-email-row"><span className="faint">Field</span><span className="mono">{s('field')}</span></div>
          <div className="biz-email-body">{Array.isArray(a['value']) ? (a['value'] as string[]).join('\n') : s('value')}</div>
          <div className="biz-setting-sub">Why: {s('rationale')}</div>
        </div>
      );
    case 'validation.submit': {
      const list = (k: string): string[] => (Array.isArray(a[k]) ? (a[k] as string[]) : []);
      return (
        <div className="biz-email biz-report">
          <div className="biz-email-row"><span className="faint">Verdict</span><span>{s('verdict').replace('_', ' ')}</span></div>
          <div className="biz-email-body">
            <div className="biz-resolved-label" style={{ marginTop: 0 }}>Problem</div>
            <div>{s('problem')}</div>
            <div className="biz-resolved-label">Competitors & substitutes</div>
            <ul>{list('competitors').map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="biz-resolved-label">Demand signals</div>
            <ul>{list('demand_signals').map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="biz-resolved-label">Summary</div>
            <div>{s('summary')}</div>
            <div className="biz-resolved-label">Sources</div>
            <ul>{list('sources').map((c) => <li key={c} className="mono biz-small">{c}</li>)}</ul>
          </div>
          <div className="biz-setting-sub" style={{ padding: '0 12px 10px' }}>Approving marks the idea validated and unlocks coding, outreach and ads.</div>
        </div>
      );
    }
    case 'ads.update_budget':
      return (
        <div>
          <div className="biz-email-row"><span className="faint">Ad set</span><span className="mono">{s('adset_id')}</span></div>
          <div className="biz-email-row"><span className="faint">New daily budget</span><span className="mono">${Number(a['new_daily_budget_usd'] ?? 0).toFixed(2)}</span></div>
          <div className="biz-setting-sub">Why: {s('reason')}</div>
        </div>
      );
    default:
      return <pre className="biz-action-pre mono">{JSON.stringify(a, null, 2)}</pre>;
  }
}

function Detail({ companyId, id, onDone }: { companyId: string; id: string; onDone: () => void }): JSX.Element {
  const { data, error, reload } = useBiz('approvals.get', { companyId, actionId: id }, [id]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const a = data?.action;
  if (error) return <ErrorLine error={error} />;
  if (!a) return <div className="biz-empty-line muted">Loading…</div>;
  const pending = a.status === 'pending' || a.status === 'failed';

  const approve = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const r = await biz('approvals.approve', { companyId, actionId: a.id, ...(note.trim() ? { note: note.trim() } : {}) });
      if (!r.ok) setErr(r.error ?? 'failed');
      reload();
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const reject = async (): Promise<void> => {
    if (!reason.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const r = await biz('approvals.reject', { companyId, actionId: a.id, reason: reason.trim() });
      if (!r.ok) setErr(r.error ?? 'failed');
      reload();
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="biz-detail">
      <div className="biz-why">
        {Icon.shield}
        <span>
          <span className="ink">{RISK_LABEL[a.riskLevel]}</span> · {a.reason}
          {a.gate === 'objection_window' && a.executeAfter && a.status === 'pending' ? ` · applies ${fmtIn(a.executeAfter)} unless you reject it` : ''}
        </span>
      </div>
      <ArgsView action={a} />
      {a.rubric.length > 0 && (
        <div className="biz-rubric">
          <div className="biz-resolved-label">Check before approving</div>
          <ul>
            {a.rubric.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="biz-setting-sub">
        {a.skillName} · {fmtCredits(a.credits)} credits · requested {fmtAgo(a.createdAt)}
        {a.decidedAt ? ` · decided ${fmtAgo(a.decidedAt)}` : ''}
      </div>
      {a.decisionNote && <div className="biz-action-result">Note: {a.decisionNote}</div>}
      {a.result && <div className={`biz-action-result ${a.status === 'failed' ? 'fail' : ''}`}>{a.status === 'failed' ? '✕ ' : '→ '}{a.result}</div>}
      <ErrorLine error={err} />
      {pending && !rejecting && (
        <div className="biz-detail-actions">
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy} onClick={() => setRejecting(true)}>
              {Icon.x}
              <span>Reject</span>
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void approve()}>
              {Icon.check}
              <span>{a.status === 'failed' ? 'Retry' : 'Approve'}</span>
            </button>
          </div>
        </div>
      )}
      {pending && rejecting && (
        <div className="biz-detail-actions">
          <input
            className="field"
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? (becomes a lesson for the team)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void reject();
            }}
          />
          <div className="row gap-2">
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={busy || !reason.trim()} onClick={() => void reject()}>
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApprovalDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  const { company, version } = useBizLive();
  const [filter, setFilter] = useState<'pending' | 'resolved'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, reload } = useBiz('approvals.list', { companyId: company.id, status: filter }, [version]);
  const actions: PendingActionDto[] = data?.actions ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="biz-drawer-backdrop" onClick={onClose}>
      <aside className="biz-drawer" role="dialog" aria-label="Approval queue" onClick={(e) => e.stopPropagation()}>
        <div className="biz-drawer-head">
          <div>
            <div className="eyebrow">Approval queue</div>
            <div className="biz-drawer-title">{company.name}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            {Icon.x}
          </button>
        </div>
        <div className="biz-drawer-tabs">
          <Segmented
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setOpenId(null);
            }}
            options={[
              { value: 'pending', label: 'Waiting' },
              { value: 'resolved', label: 'Resolved' },
            ]}
          />
        </div>
        <div className="biz-drawer-body scroll">
          <ErrorLine error={error} />
          {actions.length === 0 && <Empty>{filter === 'pending' ? 'Nothing is waiting for you.' : 'No decisions yet.'}</Empty>}
          <div className="biz-actions">
            {actions.map((a) => (
              <div key={a.id} className={`biz-action ${a.status === 'pending' ? 'pending' : ''}`}>
                <div className="biz-action-head" onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  <span className={`biz-chev ${openId === a.id ? 'open' : ''}`}>{Icon.chev}</span>
                  <RoleBadge role={a.role} />
                  <span className="biz-action-kind">{CATEGORY_LABEL[a.category] ?? a.category}</span>
                  <span className="biz-action-title">{a.title}</span>
                  <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <Pill {...ACTION_PILL[a.status]} />
                  </span>
                </div>
                {openId === a.id && (
                  <div className="biz-action-body">
                    <Detail companyId={company.id} id={a.id} onDone={reload} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
