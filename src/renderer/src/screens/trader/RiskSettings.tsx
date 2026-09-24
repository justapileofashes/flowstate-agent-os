// Risk & rules: the versioned TraderConfig (config-as-code: every limit,
// symbol list and threshold) and the strategy composer. Saving writes a new
// config version; the risk engine re-reads it on the next tick.

import { useEffect, useState } from 'react';
import { strategyParamsSchema, type StrategyDto, type TraderConfig } from '@shared/trader/types';
import { CardHead, Empty, Modal, Switch } from '../business/ui';
import { errText, tr, useTr, when } from './api';
import { Pill } from './ui';

type Path = Array<string | number>;

function getAt(o: unknown, path: Path): unknown {
  return path.reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string | number, unknown>)[k] : undefined), o);
}

function setAt<T>(o: T, path: Path, value: unknown): T {
  const copy = structuredClone(o) as Record<string | number, unknown>;
  let cur = copy;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string | number, unknown>;
  cur[path[path.length - 1]!] = value;
  return copy as T;
}

function Num({ label, path, cfg, set, step = 1, hint }: { label: string; path: Path; cfg: TraderConfig; set: (c: TraderConfig) => void; step?: number; hint?: string }): JSX.Element {
  const v = getAt(cfg, path) as number;
  return (
    <label className="tr-field">
      <span className="faint tr-small" title={hint}>
        {label}
      </span>
      <input className="field" type="number" step={step} value={Number.isFinite(v) ? v : ''} onChange={(e) => set(setAt(cfg, path, e.target.value === '' ? 0 : Number(e.target.value)))} />
    </label>
  );
}

function Bool({ label, path, cfg, set }: { label: string; path: Path; cfg: TraderConfig; set: (c: TraderConfig) => void }): JSX.Element {
  return (
    <label className="tr-field row gap-2" style={{ alignItems: 'center' }}>
      <Switch on={Boolean(getAt(cfg, path))} onChange={(on) => set(setAt(cfg, path, on))} label={label} />
      <span className="tr-small">{label}</span>
    </label>
  );
}

function Text({ label, path, cfg, set, placeholder }: { label: string; path: Path; cfg: TraderConfig; set: (c: TraderConfig) => void; placeholder?: string }): JSX.Element {
  return (
    <label className="tr-field">
      <span className="faint tr-small">{label}</span>
      <input className="field" value={String(getAt(cfg, path) ?? '')} placeholder={placeholder} onChange={(e) => set(setAt(cfg, path, e.target.value))} />
    </label>
  );
}

const STRATEGY_TEMPLATE = JSON.stringify(
  { timeframes: [], minConfidence: 0.65, sides: ['long'], regimes: ['trend_up'], featureFilters: [{ feature: 'roc_15', op: '>', value: 0 }], stopAtrMult: 1.5, takeProfitAtrMult: 3, maxHoldBars: null },
  null,
  2,
);

function StrategyEditor({ s, onClose }: { s: StrategyDto | null; onClose: (saved: boolean) => void }): JSX.Element {
  const [name, setName] = useState(s?.name ?? '');
  const [description, setDescription] = useState(s?.description ?? '');
  const [inspiration, setInspiration] = useState(s?.inspiration ?? '');
  const [params, setParams] = useState(s ? JSON.stringify(s.params, null, 2) : STRATEGY_TEMPLATE);
  const [err, setErr] = useState('');
  const save = async (): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params);
    } catch {
      setErr('Params must be valid JSON.');
      return;
    }
    const check = strategyParamsSchema.safeParse(parsed);
    if (!check.success) {
      setErr(check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    try {
      await tr('strategies.save', { ...(s ? { id: s.id } : {}), name, description, inspiration, params: check.data });
      onClose(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title={s ? `Edit "${s.name}"` : 'New strategy'}
      onClose={() => onClose(false)}
      wide
      foot={
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
          Save
        </button>
      }
    >
      <div className="col gap-2">
        <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="field" rows={2} placeholder="Entry / exit logic in plain language" value={description} onChange={(e) => setDescription(e.target.value)} />
        <textarea className="field" rows={2} placeholder="Inspiration (traders, principles, sources)" value={inspiration} onChange={(e) => setInspiration(e.target.value)} />
        <div className="faint tr-small">
          Filters on model signals. Regimes: trend_up, trend_down, range, high_vol, normal_vol, low_vol. Feature filters use any feature name (rsi_14, roc_15, vol_z, bb_pctb, atr_pct, vwap_dev…). Null stop/target multiples fall back to the risk config.
        </div>
        <textarea className="field mono" rows={12} value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} />
        {err && <div className="fc-errline">{err}</div>}
      </div>
    </Modal>
  );
}

export function RiskSettings({ onSaved }: { onSaved: () => void }): JSX.Element {
  const cfg = useTr('config.get', {});
  const history = useTr('config.history', { limit: 10 });
  const strategies = useTr('strategies.list', {});
  const [draft, setDraft] = useState<TraderConfig | null>(null);
  const [note, setNote] = useState('');
  const [raw, setRaw] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<StrategyDto | null | 'new'>(null);
  useEffect(() => {
    if (cfg.data) setDraft(structuredClone(cfg.data.config));
  }, [cfg.data]);
  if (!draft || !cfg.data) return <div className="muted">{cfg.error || 'Loading…'}</div>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg.data.config);
  const set = (c: TraderConfig): void => setDraft(c);

  const save = async (config: TraderConfig): Promise<void> => {
    setErr('');
    setMsg('');
    try {
      const r = await tr('config.update', { config, note: note || 'edited in Risk & rules' });
      setMsg(`Saved as version ${r.version}.`);
      setNote('');
      setRaw(null);
      cfg.reload();
      history.reload();
      onSaved();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="col gap-4">
      <div className="card biz-card tr-sticky">
        <CardHead
          title={`Configuration · version ${cfg.data.version}`}
          sub="Every limit is enforced by deterministic code before any order. Out-of-range values are rejected on save."
          right={
            <>
              <input className="field" style={{ width: 220 }} placeholder="Change note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-sm btn-ghost" disabled={!dirty} onClick={() => setDraft(structuredClone(cfg.data!.config))}>
                Revert
              </button>
              <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => void save(draft)}>
                Save
              </button>
            </>
          }
        />
        {msg && <div className="tr-note">{msg}</div>}
        {err && <div className="fc-errline">{err}</div>}
      </div>

      <div className="card biz-card">
        <CardHead title="Symbols" sub="Enable/disable groups; symbols like AAPL, BRK.B or BTC/USD (crypto trades 24/7)." />
        <div className="col gap-3">
          {draft.symbolGroups.map((g, i) => (
            <div key={g.id} className="tr-group">
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <Switch on={g.enabled} onChange={(on) => set(setAt(draft, ['symbolGroups', i, 'enabled'], on))} label={g.name} />
                <b>{g.name}</b>
                <span className="faint tr-small">{g.symbols.length} symbols</span>
              </div>
              <input
                className="field mono"
                value={g.symbols.join(', ')}
                onChange={(e) =>
                  set(
                    setAt(
                      draft,
                      ['symbolGroups', i, 'symbols'],
                      e.target.value
                        .split(/[,\s]+/)
                        .map((x) => x.trim().toUpperCase())
                        .filter(Boolean),
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card biz-card">
        <CardHead title="Risk limits" sub="Fixed-fractional sizing via ATR stops; hard caps; the daily-loss circuit breaker halts new entries for the rest of the day." />
        <div className="tr-grid">
          <Num label="Risk per trade (% equity)" path={['risk', 'riskPerTradePct']} cfg={draft} set={set} step={0.05} />
          <Num label="Max single position (%)" path={['risk', 'maxPositionPct']} cfg={draft} set={set} />
          <Num label="Max gross exposure (%)" path={['risk', 'maxGrossExposurePct']} cfg={draft} set={set} />
          <Num label="Max open positions" path={['risk', 'maxPositions']} cfg={draft} set={set} />
          <Num label="Max new trades / day" path={['risk', 'maxTradesPerDay']} cfg={draft} set={set} />
          <Num label="Daily loss limit (%)" path={['risk', 'dailyLossLimitPct']} cfg={draft} set={set} step={0.1} />
          <Num label="Max drawdown from peak (%)" path={['risk', 'maxOpenDrawdownPct']} cfg={draft} set={set} step={0.5} />
          <Num label="Max per sector (%)" path={['risk', 'maxSectorPct']} cfg={draft} set={set} />
          <Num label="Correlation threshold" path={['risk', 'correlationThreshold']} cfg={draft} set={set} step={0.05} />
          <Num label="Max correlated positions" path={['risk', 'maxCorrelatedPositions']} cfg={draft} set={set} />
          <Num label="Max % of daily volume" path={['risk', 'maxAdvPct']} cfg={draft} set={set} step={0.1} />
          <Num label="Stop (× ATR)" path={['risk', 'stopAtrMult']} cfg={draft} set={set} step={0.1} />
          <Num label="Take-profit (× ATR)" path={['risk', 'takeProfitAtrMult']} cfg={draft} set={set} step={0.1} />
          <Num label="Min stop distance (%)" path={['risk', 'minStopPct']} cfg={draft} set={set} step={0.05} />
          <Num label="Max stop distance (%)" path={['risk', 'maxStopPct']} cfg={draft} set={set} step={0.5} />
          <Num label="Cash reserve (%)" path={['risk', 'cashReservePct']} cfg={draft} set={set} />
          <Num label="Pause after N losses" path={['risk', 'lossStreakPause']} cfg={draft} set={set} />
          <Bool label="Allow short selling" path={['risk', 'allowShort']} cfg={draft} set={set} />
        </div>
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Signal gates" />
          <div className="tr-grid two">
            <Num label="Confidence threshold" path={['signals', 'confidenceThreshold']} cfg={draft} set={set} step={0.01} />
            <Num label="Min expected edge (%)" path={['signals', 'minEdgePct']} cfg={draft} set={set} step={0.01} />
            <Num label="Max signals / tick" path={['signals', 'maxSignalsPerTick']} cfg={draft} set={set} />
            <Num label="Entry expiry (bars)" path={['signals', 'expiryBars']} cfg={draft} set={set} />
            <Bool label="Timeframes must agree" path={['signals', 'requireAgreement']} cfg={draft} set={set} />
          </div>
        </div>
        <div className="card biz-card">
          <CardHead title="Models" />
          <div className="col gap-2">
            {draft.models.specs.map((s, i) => (
              <div key={s.timeframe} className="row gap-2" style={{ alignItems: 'center' }}>
                <Switch on={s.enabled} onChange={(on) => set(setAt(draft, ['models', 'specs', i, 'enabled'], on))} label={s.timeframe} />
                <span className="mono" style={{ width: 36 }}>{s.timeframe}</span>
                <span className="faint tr-small">horizon</span>
                <input className="field" style={{ width: 70 }} type="number" min={1} value={s.horizonBars} onChange={(e) => set(setAt(draft, ['models', 'specs', i, 'horizonBars'], Number(e.target.value) || 1))} />
                <span className="faint tr-small">bars</span>
              </div>
            ))}
          </div>
          <div className="tr-grid two" style={{ marginTop: 8 }}>
            <Num label="Training lookback (days)" path={['models', 'lookbackDays']} cfg={draft} set={set} />
            <Num label="Min test AUC" path={['models', 'minAuc']} cfg={draft} set={set} step={0.01} />
            <Num label="Shadow days to promote" path={['models', 'shadowDays']} cfg={draft} set={set} />
            <Bool label="Auto-promote" path={['models', 'autoPromote']} cfg={draft} set={set} />
            <Text label="Nightly update (cron)" path={['models', 'nightlyRetrainCron']} cfg={draft} set={set} />
            <Text label="Weekly full retrain (cron)" path={['models', 'weeklyRetrainCron']} cfg={draft} set={set} />
          </div>
        </div>
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Execution & costs" />
          <div className="tr-grid two">
            <label className="tr-field">
              <span className="faint tr-small">Entry order type</span>
              <select className="field" value={draft.execution.orderType} onChange={(e) => set(setAt(draft, ['execution', 'orderType'], e.target.value))}>
                <option value="market">market</option>
                <option value="limit">limit</option>
              </select>
            </label>
            <Num label="Limit offset (bps)" path={['execution', 'limitOffsetBps']} cfg={draft} set={set} />
            <Num label="Slippage (bps)" path={['execution', 'slippageBps']} cfg={draft} set={set} />
            <Num label="Commission / share" path={['execution', 'commissionPerShare']} cfg={draft} set={set} step={0.001} />
            <Num label="Short borrow (bps/day)" path={['execution', 'borrowBpsPerDay']} cfg={draft} set={set} step={0.1} />
            <Num label="Crypto funding (bps/day)" path={['execution', 'cryptoFundingBpsPerDay']} cfg={draft} set={set} step={0.1} />
            <Num label="Max % of bar volume" path={['execution', 'participationPct']} cfg={draft} set={set} />
            <Num label="Latency (bars)" path={['execution', 'latencyBars']} cfg={draft} set={set} />
            <Num label="Max hold (× horizon)" path={['execution', 'maxHoldBarsMult']} cfg={draft} set={set} step={0.5} />
            <Num label="Paper starting cash" path={['execution', 'paperStartingCash']} cfg={draft} set={set} step={1000} />
          </div>
        </div>
        <div className="card biz-card">
          <CardHead title="LLM & monitoring" sub="The LLM writes rationale and may veto; it never sizes or places orders." />
          <div className="tr-grid two">
            <Bool label="LLM enabled" path={['llm', 'enabled']} cfg={draft} set={set} />
            <Text label="Model (blank = app default)" path={['llm', 'model']} cfg={draft} set={set} placeholder="e.g. claude-haiku-4-5" />
            <Num label="Max LLM calls / tick" path={['llm', 'maxCallsPerTick']} cfg={draft} set={set} />
            <Bool label="Write rationale" path={['llm', 'rationale']} cfg={draft} set={set} />
            <Bool label="LLM risk veto (slower)" path={['llm', 'riskReview']} cfg={draft} set={set} />
            <Bool label="News headlines" path={['llm', 'news']} cfg={draft} set={set} />
            <Text label="Alert webhook URL" path={['monitor', 'webhookUrl']} cfg={draft} set={set} placeholder="https://…" />
            <Num label="Fill-failure streak alert" path={['monitor', 'fillFailureStreak']} cfg={draft} set={set} />
            <Num label="Drift alert (% shift)" path={['monitor', 'driftThresholdPct']} cfg={draft} set={set} />
            <Num label="Data gap alert (ms)" path={['monitor', 'dataGapMs']} cfg={draft} set={set} step={1000} />
            <Num label="Prometheus port (0 = off)" path={['monitor', 'metricsHttpPort']} cfg={draft} set={set} />
            <Num label="Tick delay after bar close (s)" path={['schedule', 'tickDelaySec']} cfg={draft} set={set} />
          </div>
        </div>
      </div>

      <div className="card biz-card">
        <CardHead
          title="Strategies"
          sub="The composer: each strategy filters model signals and sets stop/target/holding rules. A signal is traded by the first active strategy it matches. Losing strategies retire automatically."
          right={
            <button className="btn btn-sm" onClick={() => setEditing('new')}>
              New strategy
            </button>
          }
        />
        {!strategies.data?.strategies.length ? (
          <Empty>No strategies.</Empty>
        ) : (
          <table className="biz-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Filters</th>
                <th>Record</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {strategies.data.strategies.map((s) => {
                const p = s.params;
                const total = s.wins + s.losses;
                return (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                      {s.legacy && <span className="faint tr-small"> · imported</span>}
                      <div className="faint tr-small">{s.description}</div>
                      {s.lessons.length > 0 && <div className="tr-small">Latest lesson: {s.lessons[s.lessons.length - 1]}</div>}
                    </td>
                    <td className="tr-small">
                      ≥ {Math.round(p.minConfidence * 100)}% · {p.sides.join('/')}
                      {p.timeframes.length ? ` · ${p.timeframes.join(',')}` : ''}
                      {p.regimes.length ? ` · ${p.regimes.join(',')}` : ''}
                      {p.featureFilters.map((f) => ` · ${f.feature} ${f.op} ${f.value}`).join('')}
                      {p.stopAtrMult !== null ? ` · stop ${p.stopAtrMult}×ATR` : ''}
                      {p.takeProfitAtrMult !== null ? ` · target ${p.takeProfitAtrMult}×ATR` : ''}
                    </td>
                    <td className="mono">
                      {s.wins}W/{s.losses}L{total ? ` · ${Math.round((s.wins / total) * 100)}%` : ''} · {s.totalPnl >= 0 ? '+' : ''}
                      {s.totalPnl.toFixed(2)}
                    </td>
                    <td>
                      <Pill kind={s.status === 'active' ? 'good' : ''} label={s.status} />
                    </td>
                    <td>
                      <div className="row gap-1">
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => void tr('strategies.setStatus', { id: s.id, status: s.status === 'active' ? 'retired' : 'active' }).then(() => strategies.reload())}
                        >
                          {s.status === 'active' ? 'Retire' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead
            title="Advanced (JSON)"
            sub="Sectors, earnings blackout dates, net-exposure bands, retention — everything in one versioned document."
            right={
              raw === null ? (
                <button className="btn btn-sm btn-ghost" onClick={() => setRaw(JSON.stringify(draft, null, 2))}>
                  Edit JSON
                </button>
              ) : (
                <>
                  <button className="btn btn-sm btn-ghost" onClick={() => setRaw(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      try {
                        void save(JSON.parse(raw) as TraderConfig);
                      } catch {
                        setErr('Invalid JSON.');
                      }
                    }}
                  >
                    Save JSON
                  </button>
                </>
              )
            }
          />
          {raw !== null && <textarea className="field mono" rows={18} value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />}
        </div>
        <div className="card biz-card">
          <CardHead title="Version history" />
          {(history.data?.versions ?? []).map((v) => (
            <div key={v.version} className="tr-hist">
              <span className="mono">v{v.version}</span> <span className="faint">{when(v.createdAt)} · {v.editedBy}</span>
              <div className="tr-small">{v.note || '—'}</div>
            </div>
          ))}
        </div>
      </div>
      {editing && (
        <StrategyEditor
          s={editing === 'new' ? null : editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) strategies.reload();
          }}
        />
      )}
    </div>
  );
}
