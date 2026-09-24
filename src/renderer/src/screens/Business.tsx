// Business — an AI team that runs a company (docs/superpowers/specs/
// 2026-09-24-business-agent-design.md). Shell: company switcher, run-cycle
// with a transparent cost meter, the approval queue, and tabs. Live events
// from main append to the feed and bump a version counter the tabs refetch on.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyDto, FeedEventDto } from '@shared/business/types';
import type { CycleEstimateDto } from '@shared/business/api';
import { biz, BizLiveContext, errText, fmtCredits, useBizEvents, type BizLive, type BizTab } from './business/api';
import { ErrorLine, Icon, Modal, Pill } from './business/ui';
import { Onboarding } from './business/Onboarding';
import { Overview } from './business/Overview';
import { Timeline } from './business/Timeline';
import { TaskBoard } from './business/TaskBoard';
import { Outputs } from './business/Outputs';
import { Knowledge } from './business/Knowledge';
import { Usage } from './business/Usage';
import { CeoChat } from './business/CeoChat';
import { BizSettings } from './business/Settings';
import { ApprovalDrawer } from './business/ApprovalDrawer';

const TABS: Array<{ id: BizTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'usage', label: 'Usage' },
  { id: 'chat', label: 'Ask the CEO' },
  { id: 'settings', label: 'Settings' },
];

const STATE_KINDS = new Set<FeedEventDto['kind']>([
  'cycle-start',
  'cycle-end',
  'plan',
  'task-start',
  'task-done',
  'task-failed',
  'approval-requested',
  'approval-decided',
  'action-executed',
  'action-failed',
  'summary',
  'learn',
  'alert',
]);

const LAST_COMPANY = 'biz.company';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_COMPANY);
  } catch {
    return null;
  }
}

class BizErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="biz-page">
          <div className="card biz-card">
            <div className="fc-errline">Business screen crashed: {String(this.state.error)}</div>
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RunCycleModal({ company, onClose, onStarted }: { company: CompanyDto; onClose: () => void; onStarted: () => void }): JSX.Element {
  const [est, setEst] = useState<CycleEstimateDto | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void biz('cycles.estimate', { companyId: company.id }).then(setEst).catch((e) => setErr(errText(e)));
  }, [company.id]);
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await biz('cycles.trigger', { companyId: company.id, kind: 'manual' });
      if (r.error) setErr(r.error);
      else {
        onStarted();
        onClose();
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const blocked = est?.verdict === 'block';
  return (
    <Modal
      title="Run a cycle now"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !est || blocked || est.running} onClick={() => void start()}>
            {Icon.play}
            <span>{est?.running ? 'Already running' : `Spend up to ${est ? fmtCredits(est.creditsCap) : '…'} credits`}</span>
          </button>
        </>
      }
    >
      <div className="biz-setting-sub" style={{ marginBottom: 12 }}>
        The CEO reads the company's state, writes a plan within this budget, and dispatches the team. Anything outward
        lands in your approval queue. Unused credits stay in your balance; failed actions are refunded.
      </div>
      {est ? (
        <div className="biz-review">
          <div className="biz-review-row"><span className="faint">This cycle's cap</span><span className="mono">{fmtCredits(est.creditsCap)} credits{est.usdCap > 0 ? ` · $${est.usdCap.toFixed(2)} max cloud spend` : ''}</span></div>
          <div className="biz-review-row"><span className="faint">Recent cycles used</span><span className="mono">{est.avgRecentCredits ? `${fmtCredits(est.avgRecentCredits)} credits on average` : 'no history yet'}</span></div>
          <div className="biz-review-row"><span className="faint">Balance</span><span className="mono">{fmtCredits(est.balance)} credits</span></div>
          <div className="biz-review-row"><span className="faint">This month</span><span className="mono">{fmtCredits(est.monthSpent)} / {fmtCredits(est.monthlyCredits)}</span></div>
        </div>
      ) : (
        <div className="biz-empty-line muted">Estimating…</div>
      )}
      {est?.message && <div className={`biz-action-result ${blocked ? 'fail' : ''}`}>{est.message}</div>}
      <ErrorLine error={err} />
    </Modal>
  );
}

function CompanyView({
  company,
  companies,
  onSelect,
  onNew,
  onChanged,
  enabled,
}: {
  company: CompanyDto;
  companies: CompanyDto[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onChanged: () => void;
  enabled: boolean;
}): JSX.Element {
  const [tab, setTab] = useState<BizTab>('overview');
  const [version, setVersion] = useState(0);
  const [feed, setFeed] = useState<FeedEventDto[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState(0);
  const [runModal, setRunModal] = useState(false);
  const [chatPrefill, setChatPrefill] = useState('');
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bump = useCallback((): void => {
    if (bumpTimer.current) clearTimeout(bumpTimer.current);
    bumpTimer.current = setTimeout(() => setVersion((v) => v + 1), 350);
  }, []);

  useEffect(() => {
    setFeed([]);
    void biz('feed.list', { companyId: company.id, limit: 300 }).then((r) => setFeed(r.events)).catch(() => undefined);
    return () => {
      if (bumpTimer.current) clearTimeout(bumpTimer.current);
    };
  }, [company.id]);

  useEffect(() => {
    void biz('companies.dashboard', { companyId: company.id })
      .then((d) => {
        setRunning(Boolean(d.running));
        setPending(d.pendingApprovals);
      })
      .catch(() => undefined);
  }, [company.id, version]);

  useBizEvents(company.id, (ev) => {
    if (ev.type === 'feed') {
      setFeed((f) => (f.some((x) => x.id === ev.event.id) ? f : [...f, ev.event].slice(-300)));
      if (STATE_KINDS.has(ev.event.kind)) bump();
    } else {
      if (ev.what === 'company') onChanged();
      bump();
    }
  });

  const live: BizLive = useMemo(
    () => ({
      company,
      version,
      feed,
      refresh: () => {
        onChanged();
        bump();
      },
      openApprovals: () => setDrawer(true),
      goTab: setTab,
      askCeo: (prompt: string) => {
        setChatPrefill(prompt);
        setTab('chat');
      },
      chatPrefill,
      clearPrefill: () => setChatPrefill(''),
    }),
    [company, version, feed, onChanged, bump, chatPrefill],
  );

  return (
    <BizLiveContext.Provider value={live}>
      <div className="screen-enter biz-page">
        <div className="biz-header">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Business</div>
            <div className="biz-title-row">
              <h2 className="section-title biz-title">{company.name}</h2>
              <select
                  className="field biz-company-select"
                  value={company.id}
                  aria-label="Switch company"
                  onChange={(e) => (e.target.value === '__new' ? onNew() : onSelect(e.target.value))}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new">+ New company…</option>
                </select>
            </div>
            <div className="biz-sched muted">
              {Icon.clock}
              <span>
                {!enabled
                  ? 'Emergency stop is on — nothing runs'
                  : company.status === 'paused'
                    ? 'Paused — scheduled cycles are off'
                    : company.config.schedule.enabled
                      ? `Plans at ${company.config.schedule.morning}, reports at ${company.config.schedule.evening}`
                      : 'Manual cycles only'}
                {' · '}
                {company.config.autonomy} mode
              </span>
            </div>
          </div>
          <div className="row gap-2" style={{ alignItems: 'center', flexShrink: 0 }}>
            {running && <Pill kind="streaming" label="cycle running" />}
            {!enabled && <Pill kind="bad" label="stopped" />}
            {company.status === 'paused' && <Pill label="paused" />}
            <button className={`btn ${pending ? 'biz-queue-btn hot' : ''}`} onClick={() => setDrawer(true)}>
              {Icon.inbox}
              <span>{pending ? `${pending} waiting` : 'Approvals'}</span>
            </button>
            <button className="btn btn-primary" disabled={running || !enabled} onClick={() => setRunModal(true)}>
              {Icon.play}
              <span>Run cycle</span>
            </button>
          </div>
        </div>

        <div className="biz-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`biz-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="biz-tabpanel" role="tabpanel">
          {tab === 'overview' && <Overview />}
          {tab === 'timeline' && <Timeline />}
          {tab === 'tasks' && <TaskBoard />}
          {tab === 'outputs' && <Outputs />}
          {tab === 'knowledge' && <Knowledge />}
          {tab === 'usage' && <Usage />}
          {tab === 'chat' && <CeoChat />}
          {tab === 'settings' && <BizSettings />}
        </div>
      </div>
      {drawer && <ApprovalDrawer onClose={() => setDrawer(false)} />}
      {runModal && <RunCycleModal company={company} onClose={() => setRunModal(false)} onStarted={bump} />}
    </BizLiveContext.Provider>
  );
}

export function Business(): JSX.Element {
  const [companies, setCompanies] = useState<CompanyDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(readLast());
  const [creating, setCreating] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, status] = await Promise.all([biz('companies.list', {}), biz('status', {})]);
      setCompanies(list.companies);
      setEnabled(status.enabled);
    } catch (e) {
      setError(errText(e));
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const select = (id: string): void => {
    setSelected(id);
    setCreating(false);
    try {
      localStorage.setItem(LAST_COMPANY, id);
    } catch {
      // per-viewer convenience only
    }
  };

  if (!companies) return <div className="biz-page" />;
  const company = companies.find((c) => c.id === selected) ?? companies[0] ?? null;

  return (
    <BizErrorBoundary>
      {error && (
        <div className="biz-page">
          <ErrorLine error={error} />
        </div>
      )}
      {!company || creating ? (
        <Onboarding
          onCreated={(c) => {
            void load().then(() => select(c.id));
          }}
          {...(company ? { onCancel: () => setCreating(false) } : {})}
        />
      ) : (
        <CompanyView
          key={company.id}
          company={company}
          companies={companies}
          onSelect={select}
          onNew={() => setCreating(true)}
          onChanged={() => void load()}
          enabled={enabled}
        />
      )}
    </BizErrorBoundary>
  );
}
