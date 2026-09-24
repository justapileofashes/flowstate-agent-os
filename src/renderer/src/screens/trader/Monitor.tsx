// Monitor (the in-app Grafana): metric series, alerts, every tick with its
// graph, data coverage/validation issues, the Prometheus endpoint, and the
// operator log.

import { useState } from 'react';
import type { MetricSeriesDto } from '@shared/trader/types';
import { CardHead, Empty } from '../business/ui';
import { ago, money, pct, useTr, when, tr } from './api';
import { CYCLE_PILL, LineChart, NodeChain, Pill } from './ui';

function seriesOf(all: MetricSeriesDto[] | undefined, name: string): Array<{ ts: number; value: number }> {
  const s = (all ?? []).filter((x) => x.name === name);
  return s.length ? s.reduce((best, x) => (x.points.length > best.points.length ? x : best), s[0]!).points : [];
}

export function Monitor({ onChange }: { onChange: () => void }): JSX.Element {
  const [hours, setHours] = useState(48);
  const [skipped, setSkipped] = useState(false);
  const snap = useTr('metrics.snapshot', { sinceHours: hours }, [], ['cycle']);
  const alerts = useTr('alerts.list', { limit: 100 }, [], ['alert']);
  const cycles = useTr('cycles.list', { limit: 60, includeSkipped: skipped }, [], ['cycle']);
  const coverage = useTr('data.coverage', {}, [], ['cycle']);
  const issues = useTr('data.issues', { limit: 50 });
  const prom = useTr('metrics.prometheus', {});
  const ops = useTr('opslog.list', { limit: 40 }, [], ['status']);
  const [showProm, setShowProm] = useState(false);
  const [openCycle, setOpenCycle] = useState<string | null>(null);
  const s = snap.data?.series;
  const hist = snap.data?.histograms ?? [];
  const tick = hist.find((h) => h.name === 'trader_tick_duration_ms');
  const s2o = hist.find((h) => h.name === 'trader_signal_to_order_ms');
  const slip = hist.filter((h) => h.name === 'trader_slippage_bps');

  return (
    <div className="col gap-4">
      <div className="biz-stats">
        <div className="biz-stat">
          <div className="biz-stat-label">Tick duration p50 / p95</div>
          <div className="biz-stat-value">{tick ? `${Math.round(tick.p50)} / ${Math.round(tick.p95)} ms` : '—'}</div>
          <div className="biz-stat-sub">{tick ? `${tick.count} ticks since start` : 'no ticks this session'}</div>
        </div>
        <div className="biz-stat">
          <div className="biz-stat-label">Signal → order p95</div>
          <div className="biz-stat-value">{s2o ? `${Math.round(s2o.p95)} ms` : '—'}</div>
        </div>
        <div className="biz-stat">
          <div className="biz-stat-label">Slippage vs assumed p50</div>
          <div className="biz-stat-value">{slip.length ? slip.map((x) => `${x.labels['account']}: ${x.p50.toFixed(1)}`).join(' · ') : '—'}</div>
          <div className="biz-stat-sub">bps (+ = worse than the decision price)</div>
        </div>
        <div className="biz-stat">
          <div className="biz-stat-label">Order success (24h)</div>
          <div className="biz-stat-value">{(() => { const v = seriesOf(s, 'trader_order_success_ratio').at(-1)?.value; return v === undefined ? '—' : pct(v * 100, 0); })()}</div>
        </div>
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead
            title="Equity"
            right={
              <div className="ap-toggle">
                {[24, 48, 168].map((h) => (
                  <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>
                    {h === 168 ? '7d' : `${h}h`}
                  </button>
                ))}
              </div>
            }
          />
          <LineChart label="Equity" format={(v) => money(v, 0)} series={[{ name: 'equity', points: seriesOf(s, 'trader_equity') }]} height={150} />
        </div>
        <div className="card biz-card">
          <CardHead title="Gross exposure" />
          <LineChart label="Gross exposure percent" format={(v) => pct(v, 0)} series={[{ name: 'exposure', points: seriesOf(s, 'trader_gross_exposure_pct') }]} height={150} />
        </div>
      </div>
      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Daily P&L" />
          <LineChart label="Daily profit and loss" format={(v) => money(v, 0)} baseline={0} series={[{ name: 'P&L', points: seriesOf(s, 'trader_daily_pnl') }]} height={150} />
        </div>
        <div className="card biz-card">
          <CardHead title="Worst data staleness" sub="> 2 min past a bar's close blocks trading on that symbol." />
          <LineChart label="Data staleness in seconds" format={(v) => `${Math.round(v / 1000)}s`} series={[{ name: 'staleness', points: seriesOf(s, 'trader_data_max_staleness_ms') }]} height={150} />
        </div>
      </div>

      <div className="card biz-card">
        <CardHead
          title="Alerts"
          sub="Circuit breaker, fill-failure streaks, model drift, data gaps, broker errors, aborted cycles. Also sent as desktop notifications and to the webhook, if one is set."
          right={
            <button className="btn btn-sm btn-ghost" onClick={() => void tr('alerts.ack', { id: 'all' }).then(() => { alerts.reload(); onChange(); })}>
              Acknowledge all
            </button>
          }
        />
        {!alerts.data?.alerts.length ? (
          <Empty>No alerts.</Empty>
        ) : (
          <div className="col gap-2">
            {alerts.data.alerts.map((a) => (
              <div key={a.id} className={`tr-alert ${a.severity} ${a.acknowledgedAt ? 'acked' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{a.title}</b>
                  {!a.acknowledgedAt && (
                    <button className="btn btn-sm btn-ghost" onClick={() => void tr('alerts.ack', { id: a.id }).then(() => { alerts.reload(); onChange(); })}>
                      Acknowledge
                    </button>
                  )}
                </div>
                <div className="faint tr-small">
                  {a.severity} · {ago(a.createdAt)} · {a.key}
                </div>
                <div className="tr-small">{a.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card biz-card">
        <CardHead
          title="Ticks"
          sub="One orchestrator cycle per closed bar: data → reconcile → guard → researcher → quant → risk officer → trader → logger."
          right={
            <label className="row gap-1 tr-small">
              <input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} /> include skipped
            </label>
          }
        />
        {!cycles.data?.cycles.length ? (
          <Empty>No ticks yet.</Empty>
        ) : (
          <table className="biz-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Signals / orders</th>
                <th>Duration</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {cycles.data.cycles.map((c) => (
                <tr key={c.id} className="tr-row" onClick={() => setOpenCycle(openCycle === c.id ? null : c.id)}>
                  <td>{when(c.startedAt)}</td>
                  <td>
                    {c.trigger} · {c.mode}
                  </td>
                  <td>
                    <Pill {...CYCLE_PILL[c.status]} />
                  </td>
                  <td className="mono">
                    {c.signals} / {c.orders}
                  </td>
                  <td className="mono">{c.endedAt ? `${c.endedAt - c.startedAt} ms` : '—'}</td>
                  <td>
                    {openCycle === c.id ? (
                      <div className="col gap-1">
                        <NodeChain nodes={c.nodes} />
                        {c.nodes.map((n, i) => (
                          <div key={i} className="tr-small">
                            <b>{n.node}</b> {n.ok ? '' : '✗ '}
                            {n.summary}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="faint tr-small">{c.skipReason ?? c.abortReason ?? c.nodes.find((n) => n.node === 'quant')?.summary ?? ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Data coverage" />
          {!coverage.data?.coverage.length ? (
            <Empty>No bars stored yet.</Empty>
          ) : (
            <div className="biz-table-wrap tr-scrolly">
              <table className="biz-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>TF</th>
                    <th>Bars</th>
                    <th>Last bar</th>
                    <th>Issues (7d)</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.data.coverage.map((c) => (
                    <tr key={`${c.symbol}-${c.timeframe}`}>
                      <td>{c.symbol}</td>
                      <td>{c.timeframe}</td>
                      <td className="mono">{c.bars}</td>
                      <td className={c.stale ? 'bad' : ''}>{when(c.lastTs)}</td>
                      <td className="mono">{c.issues || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card biz-card">
          <CardHead title="Validation issues" sub="Rows dropped or repaired during normalization." />
          {!issues.data?.issues.length ? (
            <Empty>None.</Empty>
          ) : (
            <div className="tr-scrolly">
              {issues.data.issues.map((i, k) => (
                <div key={k} className="tr-small tr-issue">
                  <span className="mono">{i.symbol} {i.timeframe}</span> · <b>{i.kind}</b> · {i.detail} <span className="faint">({ago(i.createdAt)})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead
            title="Prometheus"
            sub={prom.data?.port ? `Scrape http://127.0.0.1:${prom.data.port}/metrics` : 'Endpoint off. Set a port in Risk & rules → LLM & monitoring to expose /metrics on 127.0.0.1.'}
            right={
              <button className="btn btn-sm btn-ghost" onClick={() => { setShowProm((v) => !v); prom.reload(); }}>
                {showProm ? 'Hide' : 'Show'} exposition
              </button>
            }
          />
          {showProm && <pre className="tr-pre tr-scrolly">{prom.data?.text ?? ''}</pre>}
        </div>
        <div className="card biz-card">
          <CardHead title="Operator log" />
          <div className="tr-scrolly">
            {(ops.data?.entries ?? []).map((e) => (
              <div key={e.id} className="tr-small tr-issue">
                <span className="faint">{when(e.createdAt)}</span> <b>{e.action}</b> <span className="faint">by {e.actor}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
