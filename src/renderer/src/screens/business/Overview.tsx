// Company dashboard: alerts, KPI tiles, the live cycle (plan + progress +
// running credit tally) or the latest report, live activity, upcoming runs,
// and the team roster.

import { useEffect, useRef } from 'react';
import type { CycleDto, KpiDto, TaskDto } from '@shared/business/types';
import { biz, fmtAgo, fmtCredits, fmtIn, fmtTime, useBiz, useBizLive } from './api';
import { CardHead, CYCLE_PILL, Empty, ErrorLine, Icon, Markdown, Pill, RoleBadge, ROLE_LABEL, Stat, TASK_PILL } from './ui';

function kpi(kpis: KpiDto[], key: string): KpiDto | undefined {
  return kpis.find((k) => k.key === key);
}

function money(k: KpiDto | undefined): string {
  if (!k) return '—';
  return `${k.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${k.unit}`;
}

function LiveCycle({ cycle }: { cycle: CycleDto }): JSX.Element {
  const { company, version } = useBizLive();
  const { data } = useBiz('cycles.get', { companyId: company.id, cycleId: cycle.id }, [version]);
  const tasks = new Map<string, TaskDto>((data?.tasks ?? []).map((t) => [t.id, t]));
  const pct = cycle.creditsCap > 0 ? Math.min(100, (cycle.creditsSpent / cycle.creditsCap) * 100) : 0;
  return (
    <div className="card biz-card">
      <CardHead
        title="Cycle in progress"
        sub={`${cycle.kind} · started ${fmtTime(cycle.startedAt)}`}
        right={
          <>
            <Pill kind="streaming" label="running" />
            <button className="btn btn-sm" onClick={() => void biz('cycles.abort', { companyId: company.id })}>
              {Icon.stop}
              <span>Stop</span>
            </button>
          </>
        }
      />
      <div className="biz-meter" title={`${fmtCredits(cycle.creditsSpent)} of ${fmtCredits(cycle.creditsCap)} credits`}>
        <div className="biz-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="biz-meter-label mono">
        {fmtCredits(cycle.creditsSpent)} / {fmtCredits(cycle.creditsCap)} credits
      </div>
      {cycle.plan?.plan.length ? (
        <ol className="biz-plan">
          {cycle.plan.plan.map((p, i) => {
            const t = p.taskId ? tasks.get(p.taskId) : undefined;
            const st = t ? TASK_PILL[t.status] : { kind: '' as const, label: 'queued' };
            return (
              <li key={i} className="biz-plan-item">
                <RoleBadge role={p.role} />
                <span className="biz-plan-title">{p.title}</span>
                <span className="faint mono biz-plan-est">~{p.estimated_cost_credits}cr</span>
                <Pill kind={st.kind} label={st.label} />
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty>Perceiving state and writing the plan…</Empty>
      )}
    </div>
  );
}

function Feed(): JSX.Element {
  const { feed } = useBizLive();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [feed.length]);
  return (
    <div className="card biz-card biz-feed-card">
      <CardHead title="Live activity" right={<Pill kind="streaming" label="live" />} />
      <div className="biz-feed scroll" ref={ref} role="log" aria-live="polite" aria-label="business activity">
        {feed.map((ev) => (
          <div key={ev.id} className={`biz-feed-line kind-${ev.kind}`}>
            <span className="biz-feed-t">{fmtTime(ev.ts)}</span>
            {ev.role ? <RoleBadge role={ev.role} /> : <span className="biz-feed-sys">·</span>}
            <span className="biz-feed-text">
              {ev.text}
              {ev.credits !== undefined && ev.credits > 0 ? <span className="faint"> · {fmtCredits(ev.credits)}cr</span> : null}
            </span>
          </div>
        ))}
        {feed.length === 0 && (
          <div className="biz-feed-line">
            <span className="biz-feed-sys">·</span>
            <span className="biz-feed-text">Nothing yet — run a cycle to wake the team.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function Overview(): JSX.Element {
  const { company, version, openApprovals, goTab, askCeo } = useBizLive();
  const { data, error } = useBiz('companies.dashboard', { companyId: company.id }, [version]);
  if (error) return <ErrorLine error={error} />;
  if (!data) return <div className="biz-empty-line muted">Loading…</div>;
  const kpis = data.kpis;
  const site = kpi(kpis, 'site_up');
  const monthPct = data.company.config.budgets.monthlyCredits > 0 ? data.monthSpentCredits / data.company.config.budgets.monthlyCredits : 0;

  return (
    <div className="biz-overview">
      {data.alerts.length > 0 && (
        <div className="biz-alerts">
          {data.alerts.map((a) => (
            <div key={a.key} className={`biz-alert ${a.severity}`}>
              {Icon.alert}
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {data.validation.required && data.validation.status === 'pending' && (
        <div className="biz-banner">
          <div>
            <div className="biz-setting-name">Validate before you build</div>
            <div className="biz-setting-sub">
              Coding, outreach and ads are blocked until you accept a validation report. The researcher submits one to
              your approval queue — or waive the gate in Settings.
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => goTab('settings')}>Settings</button>
        </div>
      )}

      <div className="biz-stats">
        <Stat label="Net revenue · 30d" value={money(kpi(kpis, 'net_revenue_30d'))} sub={kpi(kpis, 'net_revenue_30d') ? `Stripe · ${fmtAgo(kpi(kpis, 'net_revenue_30d')!.capturedAt)}` : 'connect Stripe'} />
        <button className="biz-stat-btn" onClick={openApprovals}>
          <Stat label="Waiting for you" value={data.pendingApprovals} sub={data.pendingApprovals ? 'open the queue' : 'all clear'} tone={data.pendingApprovals ? 'bad' : undefined} />
        </button>
        <button className="biz-stat-btn" onClick={() => goTab('tasks')}>
          <Stat label="Open tasks" value={data.openTasks} sub="task board" />
        </button>
        <button className="biz-stat-btn" onClick={() => goTab('usage')}>
          <Stat
            label="Credits left"
            value={fmtCredits(data.balance)}
            sub={`${Math.round(monthPct * 100)}% of month used`}
            tone={monthPct >= 0.8 ? 'bad' : undefined}
          />
        </button>
        <Stat label="Site" value={site ? (site.value ? 'up' : 'down') : '—'} sub={site ? site.unit : 'add your site in Settings'} tone={site && !site.value ? 'bad' : undefined} />
      </div>

      <div className="biz-grid">
        <div className="biz-col">
          {data.running ? (
            <LiveCycle cycle={data.running} />
          ) : (
            <div className="card biz-card">
              <CardHead
                title={data.lastSummary ? (data.lastSummary.kind === 'evening' ? 'Evening summary' : 'Latest report') : 'Latest report'}
                sub={data.lastSummary ? fmtAgo(data.lastSummary.at) : undefined}
                right={
                  data.lastCycle ? <Pill {...CYCLE_PILL[data.lastCycle.status]} /> : undefined
                }
              />
              {data.lastSummary ? (
                <>
                  <Markdown text={data.lastSummary.text} />
                  <div className="row gap-2" style={{ marginTop: 12 }}>
                    <button className="btn btn-sm" onClick={() => goTab('timeline')}>View timeline</button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        askCeo(`Walk me through the cycle from ${new Date(data.lastSummary!.at).toLocaleString()}: what did you decide, why, and what went wrong?`)
                      }
                    >
                      {Icon.help}
                      <span>Get help on this cycle</span>
                    </button>
                  </div>
                </>
              ) : (
                <Empty>The first report lands after a cycle finishes. Start one with “Run cycle”.</Empty>
              )}
              {data.lastCycle?.stopReason && data.lastCycle.status !== 'done' && (
                <div className="biz-action-result fail">Stopped: {data.lastCycle.stopReason}</div>
              )}
            </div>
          )}

          <div className="card biz-card">
            <CardHead title="Goals" />
            {data.company.config.goals.length ? (
              <ul className="biz-goallist">
                {data.company.config.goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            ) : (
              <Empty>No goals yet — add them in Settings.</Empty>
            )}
          </div>
        </div>

        <div className="biz-col">
          <Feed />
          <div className="card biz-card">
            <CardHead title="Coming up" />
            {data.nextRuns.length ? (
              <div className="biz-history">
                {data.nextRuns.slice(0, 5).map((r) => (
                  <div key={r.job} className="biz-hrow">
                    <span className="biz-hdate mono">{fmtIn(r.at)}</span>
                    <span className="biz-hmeta">{r.job}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>{data.company.status === 'paused' ? 'Paused — no scheduled runs.' : 'No scheduled runs.'}</Empty>
            )}
          </div>
          <div className="card biz-card">
            <CardHead title="Team" right={<button className="btn btn-sm btn-ghost" onClick={() => goTab('settings')}>Manage</button>} />
            <div className="biz-team">
              {data.agents.map((a) => (
                <span key={a.id} className={`biz-team-chip ${a.enabled ? '' : 'off'}`} title={a.scheduleCron ? `also runs on ${a.scheduleCron}` : undefined}>
                  <RoleBadge role={a.role} />
                  {ROLE_LABEL[a.role]}
                  {a.scheduleCron && <span className="faint">{Icon.clock}</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
