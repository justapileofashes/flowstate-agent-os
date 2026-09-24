// Overview: KPIs, equity curve (live account + shadow mirror in live mode),
// open positions with a close button, the last tick's pipeline, open alerts.

import { useState } from 'react';
import type { TraderStatusDto } from '@shared/trader/types';
import { CardHead, Empty, Stat } from '../business/ui';
import { ago, errText, money, pct, price, signedMoney, signedPct, tone, tr, useTr } from './api';
import { CYCLE_PILL, LineChart, NodeChain, Pill, Side } from './ui';

export function Overview({ status, version, goTab }: { status: TraderStatusDto; version: number; goTab: (t: string) => void }): JSX.Element {
  const [days, setDays] = useState(30);
  const pf = useTr('portfolio', { curveDays: days }, [version], ['equity', 'trade', 'order']);
  const shadow = useTr('portfolio', status.mode === 'live' ? { account: 'shadow', curveDays: days } : null, [version], ['equity']);
  const alerts = useTr('alerts.list', { open: true, limit: 5 }, [version], ['alert']);
  const today = useTr('signals.list', { since: 'today', limit: 200 }, [version], ['signal', 'cycle']);
  const [closing, setClosing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const p = pf.data;
  const sigs = today.data?.signals ?? [];
  const last = status.lastCycle;

  return (
    <div className="col gap-4">
      {p?.error && <div className="fc-errline">Broker: {p.error}</div>}
      <div className="biz-stats">
        <Stat label={`Equity (${p?.account ?? '…'})`} value={money(p?.equity)} sub={p ? `cash ${money(p.cash, 0)}` : undefined} />
        <Stat label="Today" value={<span className={tone(p?.dailyPnl)}>{signedMoney(p?.dailyPnl)}</span>} sub={p ? `realized ${signedMoney(p.realizedToday)} · open ${signedMoney(p.unrealized)}` : undefined} tone={(p?.dailyPnl ?? 0) < 0 ? 'bad' : undefined} />
        <Stat label="Drawdown from peak" value={pct(p?.drawdownPct)} sub={p ? `peak ${money(p.peakEquity, 0)}` : undefined} />
        <Stat label="Gross exposure" value={pct(p?.grossExposurePct)} sub={p ? `${p.positions.length} position(s) · net ${money(p.netExposure, 0)}` : undefined} />
        <Stat
          label="Signals today"
          value={sigs.length}
          sub={`${sigs.filter((x) => ['submitted', 'filled', 'closed'].includes(x.status)).length} traded · ${sigs.filter((x) => x.status === 'rejected' || x.status === 'vetoed').length} rejected`}
        />
      </div>

      <div className="card biz-card">
        <CardHead
          title="Equity curve"
          sub={status.mode === 'live' ? 'Live account (solid) vs the paper shadow of the same signals (dashed).' : 'Paper account, marked every tick.'}
          right={
            <div className="ap-toggle">
              {[7, 30, 90].map((d) => (
                <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                  {d}d
                </button>
              ))}
            </div>
          }
        />
        <LineChart
          label="Account equity over time"
          format={(v) => money(v, 0)}
          baseline={p?.equityCurve[0]?.equity}
          series={[
            { name: status.mode === 'live' ? 'live' : 'paper', points: (p?.equityCurve ?? []).map((e) => ({ ts: e.ts, value: e.equity })) },
            ...(shadow.data ? [{ name: 'shadow', points: shadow.data.equityCurve.map((e) => ({ ts: e.ts, value: e.equity })) }] : []),
          ]}
        />
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Positions" sub="Stops and targets come from the risk engine; the simulator (or Alpaca's bracket) enforces them." />
          {err && <div className="fc-errline">{err}</div>}
          {!p?.positions.length ? (
            <Empty>No open positions.</Empty>
          ) : (
            <div className="biz-table-wrap">
              <table className="biz-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Avg</th>
                    <th>Last</th>
                    <th>P&L</th>
                    <th>Stop / target</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.positions.map((x) => (
                    <tr key={x.symbol}>
                      <td>
                        <b>{x.symbol}</b> <Side side={x.qty >= 0 ? 'long' : 'short'} />
                      </td>
                      <td className="mono">{Math.abs(x.qty)}</td>
                      <td className="mono">{price(x.avgPrice)}</td>
                      <td className="mono">{price(x.lastPrice)}</td>
                      <td className={`mono ${tone(x.unrealizedPnl)}`}>
                        {signedMoney(x.unrealizedPnl)} <span className="faint">{signedPct(x.unrealizedPnlPct, 1)}</span>
                      </td>
                      <td className="mono faint">
                        {price(x.stop)} / {price(x.takeProfit)}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={closing === x.symbol}
                          onClick={() => {
                            setClosing(x.symbol);
                            setErr('');
                            void tr('positions.close', { symbol: x.symbol })
                              .then((r) => {
                                if (!r.ok) setErr(r.error ?? 'close failed');
                                pf.reload();
                              })
                              .catch((e: unknown) => setErr(errText(e)))
                              .finally(() => setClosing(null));
                          }}
                        >
                          {closing === x.symbol ? 'Closing…' : 'Close'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="col gap-4">
          <div className="card biz-card">
            <CardHead title="Last tick" right={last ? <Pill {...CYCLE_PILL[last.status]} /> : undefined} sub={last ? `${ago(last.startedAt)} · ${last.trigger} · ${(last.endedAt ?? last.startedAt) - last.startedAt} ms` : undefined} />
            {last ? (
              <>
                <NodeChain nodes={last.nodes} />
                <div className="faint tr-small" style={{ marginTop: 8 }}>
                  {last.skipReason ?? last.abortReason ?? `${last.signals} signal(s), ${last.orders} order(s), ${last.llmCalls} LLM call(s)`}
                </div>
              </>
            ) : (
              <Empty>No ticks yet. Train a model (Models tab), then scan or turn the AI on.</Empty>
            )}
            <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => goTab('monitor')}>
              All ticks →
            </button>
          </div>
          <div className="card biz-card">
            <CardHead title="Open alerts" right={<button className="btn btn-sm btn-ghost" onClick={() => goTab('monitor')}>Monitor →</button>} />
            {!alerts.data?.alerts.length ? (
              <Empty>All clear.</Empty>
            ) : (
              <div className="col gap-2">
                {alerts.data.alerts.map((a) => (
                  <div key={a.id} className={`tr-alert ${a.severity}`}>
                    <b>{a.title}</b>
                    <div className="faint tr-small">{ago(a.createdAt)} · {a.detail.slice(0, 180)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!status.activeModels.length && (
            <div className="card biz-card">
              <CardHead title="Getting started" />
              <ol className="tr-steps">
                <li>
                  <button className="btn btn-sm btn-ghost" onClick={() => goTab('models')}>Models</button> Backfill data and train a model for 15m / 1h. It is promoted only if it beats the baseline strategies on data it never saw.
                </li>
                <li>
                  <button className="btn btn-sm btn-ghost" onClick={() => goTab('backtests')}>Backtests</button> Run an event-driven backtest and a paper simulation.
                </li>
                <li>Turn the AI on. It trades the paper account until you go live on the Brokers & go-live tab.</li>
              </ol>
            </div>
          )}
        </div>
      </div>
      {(pf.error || today.error) && <div className="fc-errline">{pf.error || today.error}</div>}
    </div>
  );
}
