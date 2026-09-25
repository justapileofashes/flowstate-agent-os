// Backtests: vectorized (fast) or event-driven (faithful: latency, partial
// fills, stops/targets, the full risk engine) runs over stored bars with the
// active models, plus Simulation Mode — today's strategy replayed on today's
// bars. Every run writes a JSON report + equity CSV.

import { useEffect, useState } from 'react';
import type { BacktestReportDto, Timeframe } from '@shared/trader/types';
import { CardHead, Empty, Stat } from '../business/ui';
import { errText, money, pct, price, signedMoney, tone, tr, useTr, when } from './api';
import { LineChart, Pill, Side } from './ui';

function Report({ r }: { r: BacktestReportDto }): JSX.Element {
  const m = r.metrics;
  return (
    <div className="col gap-3">
      {m && (
        <div className="biz-stats">
          <Stat label="Return" value={<span className={tone(m.totalReturnPct)}>{pct(m.totalReturnPct, 2)}</span>} sub={`${money(m.startEquity, 0)} → ${money(m.endEquity, 0)}`} />
          <Stat label="Sharpe (annualized)" value={m.sharpe.toFixed(2)} />
          <Stat label="Max drawdown" value={pct(m.maxDrawdownPct)} />
          <Stat label="Trades" value={m.trades} sub={`win ${pct(m.winRate * 100)} · avg ${m.avgR.toFixed(2)}R`} />
          <Stat label="Exposure / fees" value={pct(m.exposurePct)} sub={`fees ${money(m.fees)} · ${m.bars} bars`} />
        </div>
      )}
      <LineChart label="Backtest equity" format={(v) => money(v, 0)} baseline={m?.startEquity} series={[{ name: 'equity', points: r.equity.map((e) => ({ ts: e.ts, value: e.equity })) }]} />
      {r.trades.length > 0 && (
        <div className="biz-table-wrap tr-scrolly">
          <table className="biz-table">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Entry → exit</th>
                <th>P&L</th>
                <th>R</th>
                <th>Exit</th>
              </tr>
            </thead>
            <tbody>
              {r.trades.slice(0, 300).map((t, i) => (
                <tr key={i}>
                  <td>{when(t.entryTs)}</td>
                  <td>
                    {t.symbol} <Side side={t.side} />
                  </td>
                  <td className="mono">{Number(t.qty.toFixed(4))}</td>
                  <td className="mono">
                    {price(t.entryPrice)} → {price(t.exitPrice)}
                  </td>
                  <td className={`mono ${tone(t.pnl)}`}>{signedMoney(t.pnl)}</td>
                  <td className="mono">{t.r.toFixed(2)}</td>
                  <td className="faint">{t.exitReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.rejected.length > 0 && (
        <details>
          <summary className="faint tr-small">{r.rejected.length} proposal(s) rejected by the risk engine</summary>
          <ul className="tr-lessons">
            {r.rejected.slice(0, 40).map((x, i) => (
              <li key={i}>
                {when(x.ts)} {x.symbol}: {x.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="faint tr-small">
        Report: {r.reportPath ?? 'not written'}
        {r.equityPath ? ` · equity CSV: ${r.equityPath}` : ''}
      </div>
    </div>
  );
}

export function Backtests(): JSX.Element {
  const list = useTr('backtests.list', { limit: 50 });
  const [kind, setKind] = useState<'event' | 'vectorized'>('event');
  const [tf, setTf] = useState<Timeframe>('1h');
  const [days, setDays] = useState(60);
  const [simDays, setSimDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState<BacktestReportDto | null>(null);
  const status = useTr('status', {});
  const firstActive = status.data?.activeModels[0]?.timeframe;
  useEffect(() => {
    if (firstActive) setTf(firstActive); /* default to a timeframe that has a model */
  }, [firstActive]);

  const go = async (fn: () => Promise<{ report: BacktestReportDto | null; error?: string }>): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const r = await fn();
      if (r.error) setErr(r.error);
      if (r.report) setReport(r.report);
      list.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col gap-4">
      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Backtest" sub="Uses the active models, the current risk rules and the cost model (slippage, commission, borrow, funding)." />
          <div className="tr-form">
            <label>
              <span className="faint tr-small">Engine</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as 'event' | 'vectorized')}>
                <option value="event">Event-driven (faithful)</option>
                <option value="vectorized">Vectorized (fast)</option>
              </select>
            </label>
            <label>
              <span className="faint tr-small">Timeframe</span>
              <select className="field" value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
                {(['5m', '15m', '1h', '1d'] as Timeframe[]).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="faint tr-small">Days</span>
              <input className="field" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={() => void go(() => tr('backtests.run', { kind, timeframe: tf, days }))}>
              {busy ? 'Running…' : 'Run backtest'}
            </button>
          </div>
        </div>
        <div className="card biz-card">
          <CardHead title="Simulation Mode" sub="Replays the last session(s) through the exact live logic — features, models, strategies, risk engine, fill simulator — with virtual capital." />
          <div className="tr-form">
            <label>
              <span className="faint tr-small">Sessions</span>
              <input className="field" type="number" min={1} max={30} value={simDays} onChange={(e) => setSimDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
            </label>
            <button className="btn" disabled={busy} onClick={() => void go(() => tr('paperSimulate', { days: simDays }))}>
              {busy ? 'Simulating…' : 'Simulate'}
            </button>
          </div>
        </div>
      </div>
      {err && <div className="fc-errline">{err}</div>}
      {report && (
        <div className="card biz-card">
          <CardHead title={report.label} sub={`${report.kind} · ${when(report.createdAt)}`} right={<button className="btn btn-sm btn-ghost" onClick={() => setReport(null)}>Close</button>} />
          <Report r={report} />
        </div>
      )}
      <div className="card biz-card">
        <CardHead title="Runs" />
        {!list.data?.backtests.length ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <table className="biz-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Run</th>
                <th>Return</th>
                <th>Sharpe</th>
                <th>Max DD</th>
                <th>Trades</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.backtests.map((b) => (
                <tr key={b.id}>
                  <td>{when(b.createdAt)}</td>
                  <td>
                    {b.label}
                    <div className="faint tr-small">{b.kind}</div>
                  </td>
                  <td className={`mono ${tone(b.metrics?.totalReturnPct)}`}>{b.metrics ? pct(b.metrics.totalReturnPct, 2) : '—'}</td>
                  <td className="mono">{b.metrics ? b.metrics.sharpe.toFixed(2) : '—'}</td>
                  <td className="mono">{b.metrics ? pct(b.metrics.maxDrawdownPct) : '—'}</td>
                  <td className="mono">{b.metrics?.trades ?? '—'}</td>
                  <td>
                    <Pill kind={b.status === 'done' ? 'good' : b.status === 'failed' ? 'bad' : 'streaming'} label={b.status} />
                    {b.error && <div className="faint tr-small tr-ellip" title={b.error}>{b.error}</div>}
                  </td>
                  <td>
                    {b.status === 'done' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => void tr('report.get', { id: b.id }).then((r) => setReport(r.report)).catch((e: unknown) => setErr(errText(e)))}>
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
