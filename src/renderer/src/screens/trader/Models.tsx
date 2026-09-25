// Models: backfill history, train per timeframe (full or incremental), and
// the registry — out-of-sample metrics vs baselines and the incumbent,
// walk-forward folds, feature importances, shadow comparison, promotion.

import { useState } from 'react';
import type { BacktestReportDto, ModelDto, Timeframe } from '@shared/trader/types';
import { CardHead, Empty, Modal } from '../business/ui';
import { errText, pct, tr, useTr, useTraderEvents, when } from './api';
import { MODEL_PILL, Pill } from './ui';

function MetricsView({ m }: { m: ModelDto }): JSX.Element {
  const x = m.metrics;
  return (
    <div className="col gap-3">
      <div className="tr-kv">
        <span>Test AUC <b>{x.auc.toFixed(3)}</b></span>
        <span>Log-loss <b>{x.logLoss.toFixed(3)}</b></span>
        <span>Top-decile hit rate <b>{pct(x.hitRateTopDecile * 100)}</b> (base {pct(x.baseRate * 100)})</span>
        <span>Strategy Sharpe <b>{x.sharpe.toFixed(2)}</b></span>
        <span>Max drawdown <b>{pct(x.maxDrawdownPct)}</b></span>
        <span>Return <b>{pct(x.totalReturnPct, 2)}</b> over {x.trades} trades, win {pct(x.winRate * 100)}</span>
        <span>Rows train/val/test <b>{x.rows.train}/{x.rows.validation}/{x.rows.test}</b></span>
      </div>
      <div className={`tr-verdict ${x.passed ? 'good' : 'bad'}`}>{x.passed ? '✓ ' : '✗ '}{x.reasons.join(' · ')}</div>
      <div>
        <div className="eyebrow">Baselines on the same test window</div>
        <table className="biz-table num">
          <tbody>
            <tr>
              <td>This model</td>
              <td>Sharpe {x.sharpe.toFixed(2)}</td>
              <td>{pct(x.totalReturnPct, 2)}</td>
            </tr>
            {x.baselines.map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td>Sharpe {b.sharpe.toFixed(2)}</td>
                <td>{pct(b.totalReturnPct, 2)}</td>
              </tr>
            ))}
            {x.incumbent && (
              <tr>
                <td>Incumbent {x.incumbent.version}</td>
                <td>Sharpe {x.incumbent.sharpe.toFixed(2)}</td>
                <td>AUC {x.incumbent.auc.toFixed(3)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {x.walkForward.length > 0 && (
        <div>
          <div className="eyebrow">Purged walk-forward folds</div>
          <table className="biz-table num">
            <thead>
              <tr>
                <th>Fold</th>
                <th>Window</th>
                <th>AUC</th>
                <th>Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {x.walkForward.map((f) => (
                <tr key={f.fold}>
                  <td>{f.fold}</td>
                  <td>
                    {new Date(f.from).toLocaleDateString()} – {new Date(f.to).toLocaleDateString()}
                  </td>
                  <td>{f.auc.toFixed(3)}</td>
                  <td>{f.sharpe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <div className="eyebrow">Feature importance (gain)</div>
        <div className="tr-imp">
          {x.importances.map((i) => (
            <div key={i.feature} className="tr-imp-row">
              <span className="mono">{i.feature}</span>
              <span className="tr-imp-bar" style={{ width: `${Math.max(2, i.gain * 100 * 2.5)}%` }} />
              <span className="mono faint">{(i.gain * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="faint tr-small">
        version {m.version} · {m.kind}{m.parentVersion ? ` of ${m.parentVersion}` : ''} · dataset {m.datasetId} · feature set {m.featureSet} · sha256 {m.hash}
      </div>
    </div>
  );
}

function CompareView({ candidate, production }: { candidate: BacktestReportDto | null; production: BacktestReportDto | null }): JSX.Element {
  const row = (label: string, r: BacktestReportDto | null): JSX.Element => (
    <tr>
      <td>{label}</td>
      <td>{r?.metrics ? r.metrics.sharpe.toFixed(2) : '—'}</td>
      <td>{r?.metrics ? pct(r.metrics.totalReturnPct, 2) : '—'}</td>
      <td>{r?.metrics ? pct(r.metrics.maxDrawdownPct) : '—'}</td>
      <td>{r?.metrics ? r.metrics.trades : '—'}</td>
      <td>{r?.metrics ? pct(r.metrics.winRate * 100) : '—'}</td>
    </tr>
  );
  return (
    <table className="biz-table num">
      <thead>
        <tr>
          <th>Event-driven backtest</th>
          <th>Sharpe</th>
          <th>Return</th>
          <th>Max DD</th>
          <th>Trades</th>
          <th>Win</th>
        </tr>
      </thead>
      <tbody>
        {row('Candidate', candidate)}
        {row('Production', production)}
      </tbody>
    </table>
  );
}

export function Models(): JSX.Element {
  const models = useTr('models.list', {}, [], ['status', 'train']);
  const cfg = useTr('config.get', {});
  const coverage = useTr('data.coverage', {}, [], ['cycle']);
  const evals = useTr('models.shadowEvals', {}, [], ['status']);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState<ModelDto | null>(null);
  const [promote, setPromote] = useState<ModelDto | null>(null);
  const [typed, setTyped] = useState('');
  const [compare, setCompare] = useState<{ version: string; candidate: BacktestReportDto | null; production: BacktestReportDto | null; error?: string } | null>(null);
  useTraderEvents((ev) => {
    if (ev.type === 'train') setProgress((p) => ({ ...p, [ev.timeframe]: ev.message }));
  });
  const specs = cfg.data?.config.models.specs ?? [];
  const lookback = cfg.data?.config.models.lookbackDays ?? 180;

  const run = async (key: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(key);
    setMsg('');
    try {
      setMsg(await fn());
      models.reload();
      coverage.reload();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const barsFor = (tf: Timeframe): { symbols: number; bars: number; last: number | null } => {
    const rows = (coverage.data?.coverage ?? []).filter((c) => c.timeframe === tf);
    return { symbols: rows.length, bars: rows.reduce((a, c) => a + c.bars, 0), last: rows.reduce<number | null>((a, c) => (c.lastTs && (!a || c.lastTs > a) ? c.lastTs : a), null) };
  };

  return (
    <div className="col gap-4">
      <div className="card biz-card">
        <CardHead title="Timeframes" sub={`Each enabled timeframe has its own gradient-boosted model. Training uses ${lookback} days of history, split by time (train / validation / test) with purging, plus walk-forward folds.`} />
        {msg && <div className="tr-note">{msg}</div>}
        <div className="biz-table-wrap">
          <table className="biz-table">
            <thead>
              <tr>
                <th>Timeframe</th>
                <th>Horizon</th>
                <th>History</th>
                <th>Active model</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {specs.map((s) => {
                const cov = barsFor(s.timeframe);
                const active = models.data?.models.find((m) => m.timeframe === s.timeframe && m.status === 'active');
                const training = models.data?.training.includes(s.timeframe) || busy === `train-${s.timeframe}` || busy === `inc-${s.timeframe}`;
                return (
                  <tr key={s.timeframe} className={s.enabled ? '' : 'faint'}>
                    <td>
                      <b>{s.timeframe}</b> {s.enabled ? '' : '(disabled)'}
                    </td>
                    <td>{s.horizonBars} bars</td>
                    <td>
                      {cov.bars.toLocaleString()} bars · {cov.symbols} symbols{cov.last ? ` · last ${when(cov.last)}` : ''}
                    </td>
                    <td className="mono">{active ? active.version : '—'}</td>
                    <td>
                      <div className="row gap-1">
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`fill-${s.timeframe}`, async () => {
                              const r = await tr('data.ingest', { timeframe: s.timeframe, days: lookback });
                              return `${s.timeframe}: stored ${r.stored} bars from ${r.source} in ${(r.ms / 1000).toFixed(1)} s${r.issues ? `, ${r.issues} validation issue(s)` : ''}${r.errors.length ? `. Errors: ${r.errors.join('; ')}` : ''}`;
                            })
                          }
                        >
                          {busy === `fill-${s.timeframe}` ? 'Backfilling…' : 'Backfill'}
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={busy !== null || !cov.bars}
                          onClick={() =>
                            void run(`train-${s.timeframe}`, async () => {
                              const r = await tr('models.train', { timeframe: s.timeframe });
                              return r.error ? `${s.timeframe}: ${r.error}` : `${s.timeframe}: ${r.model?.version} → ${r.action}. ${r.model?.metrics.reasons.join('; ')}`;
                            })
                          }
                        >
                          {training && busy === `train-${s.timeframe}` ? 'Training…' : 'Train'}
                        </button>
                        {active && (
                          <button
                            className="btn btn-sm btn-ghost"
                            disabled={busy !== null}
                            title="Warm-start the active model on recent bars + the replay buffer"
                            onClick={() =>
                              void run(`inc-${s.timeframe}`, async () => {
                                const r = await tr('models.train', { timeframe: s.timeframe, kind: 'incremental' });
                                return r.error ? `${s.timeframe}: ${r.error}` : `${s.timeframe}: ${r.model?.version} → ${r.action}`;
                              })
                            }
                          >
                            Update
                          </button>
                        )}
                      </div>
                      {training && progress[s.timeframe] && <div className="faint tr-small">{progress[s.timeframe]}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card biz-card">
        <CardHead
          title="Registry"
          sub="The first model per timeframe goes live only if it beats the baselines out-of-sample. Later ones shadow the incumbent and are promoted after 3 winning shadow days."
        />
        {models.error && <div className="fc-errline">{models.error}</div>}
        {!models.data?.models.length ? (
          <Empty>No models yet. Backfill a timeframe, then Train.</Empty>
        ) : (
          <div className="biz-table-wrap">
            <table className="biz-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Trained</th>
                  <th>AUC</th>
                  <th>Sharpe (best baseline)</th>
                  <th>Max DD</th>
                  <th>Shadow</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.data.models.map((m) => {
                  const best = m.metrics.baselines?.length ? Math.max(...m.metrics.baselines.map((b) => b.sharpe)) : null;
                  return (
                    <tr key={m.id}>
                      <td className="mono">
                        {m.version}
                        <div className="faint tr-small">{m.kind}</div>
                      </td>
                      <td>{when(m.trainedAt)}</td>
                      <td className="mono">{m.auc.toFixed(3)}</td>
                      <td className="mono">
                        {m.sharpe.toFixed(2)} <span className="faint">({best === null ? '—' : best.toFixed(2)})</span>
                      </td>
                      <td className="mono">{pct(m.maxDrawdownPct)}</td>
                      <td className="mono">{m.status === 'shadow' ? `${m.shadowPassDays}/3 days` : '—'}</td>
                      <td>
                        <Pill {...MODEL_PILL[m.status]} />
                      </td>
                      <td>
                        <div className="row gap-1">
                          <button className="btn btn-sm btn-ghost" onClick={() => setDetail(m)}>
                            Details
                          </button>
                          {m.status !== 'active' && m.status !== 'retired' && (
                            <>
                              <button
                                className="btn btn-sm btn-ghost"
                                disabled={busy !== null}
                                onClick={() =>
                                  void run(`cmp-${m.version}`, async () => {
                                    const r = await tr('models.shadowCompare', { version: m.version });
                                    setCompare({ version: m.version, candidate: r.candidate, production: r.production, ...(r.error ? { error: r.error } : {}) });
                                    return r.error ?? '';
                                  })
                                }
                              >
                                {busy === `cmp-${m.version}` ? 'Comparing…' : 'Compare'}
                              </button>
                              <button className="btn btn-sm btn-ghost" onClick={() => { setTyped(''); setPromote(m); }}>
                                Promote…
                              </button>
                            </>
                          )}
                          {m.status === 'active' && (
                            <button className="btn btn-sm btn-ghost" onClick={() => void run(`ret-${m.version}`, async () => { await tr('models.retire', { version: m.version }); return `${m.version} retired — no active ${m.timeframe} model now.`; })}>
                              Retire
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {evals.data?.evals.length ? (
        <div className="card biz-card">
          <CardHead title="Daily shadow comparisons" sub="Candidate vs incumbent log-loss on the day's realized outcomes (≥ 20 samples to count)." />
          <table className="biz-table num">
            <thead>
              <tr>
                <th>Day</th>
                <th>Candidate</th>
                <th>Score</th>
                <th>Incumbent score</th>
                <th>Samples</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {evals.data.evals.map((e) => (
                <tr key={`${e.modelVersion}-${e.day}`}>
                  <td>{e.day}</td>
                  <td className="mono">{e.modelVersion}</td>
                  <td>{e.candidateScore.toFixed(4)}</td>
                  <td>{e.activeScore.toFixed(4)}</td>
                  <td>{e.samples}</td>
                  <td className={e.passed ? 'good' : 'bad'}>{e.passed ? 'won' : 'lost'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail && (
        <Modal title={`Model ${detail.version}`} onClose={() => setDetail(null)} wide>
          <MetricsView m={detail} />
        </Modal>
      )}
      {compare && (
        <Modal title={`Shadow compare · ${compare.version}`} onClose={() => setCompare(null)} wide>
          {compare.error ? <div className="fc-errline">{compare.error}</div> : <CompareView candidate={compare.candidate} production={compare.production} />}
          <p className="faint tr-small">Both models run through the same event-driven backtester, with the same risk rules, costs and window. No orders are placed.</p>
        </Modal>
      )}
      {promote && (
        <Modal
          title={`Promote ${promote.version} manually`}
          onClose={() => setPromote(null)}
          foot={
            <button
              className="btn btn-primary"
              disabled={typed.trim().toUpperCase() !== 'PROMOTE'}
              onClick={() =>
                void run(`prom-${promote.version}`, async () => {
                  const r = await tr('models.promote', { version: promote.version, confirm: typed });
                  setPromote(null);
                  return r.error ?? `${r.model?.version} is now the active ${r.model?.timeframe} model.`;
                })
              }
            >
              Promote
            </button>
          }
        >
          <p>
            This skips the automatic promotion gate{promote.metrics.passed ? '' : <b> — and this model did not pass it: {promote.metrics.reasons.join('; ')}</b>}. Manual promotion is only possible in paper mode.
          </p>
          <input className="field" placeholder="Type PROMOTE" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
