// Autopilot trading panel (Stocks screen tab). Connects an Alpaca account
// (paper by default), shows the guarded autonomous loop: account + positions,
// risk guardrails, the strategy library with per-strategy records, and the
// trade journal with post-mortem lessons. Live (real-money) mode requires a
// typed acknowledgement on top of connecting live keys.
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import type {
  TradingAccountResponse,
  TradingCycleReportDto,
  TradingGuardrailsDto,
  TradingStatusResponse,
  TradingStrategyDto,
  TradingTradeDto,
} from '@shared/ipc-channels';

const fmt = (n: number | null | undefined, digits = 2): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits);

const pnlClass = (n: number | null | undefined): string =>
  n === null || n === undefined || n === 0 ? 'flat' : n > 0 ? 'up' : 'down';

function ConnectCard({ onDone }: { onDone: () => void }): JSX.Element {
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [paper, setPaper] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await ipc.trading.connect(keyId.trim(), secret.trim(), paper);
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error ?? 'connection failed');
  };

  return (
    <div className="card" style={{ padding: 18, maxWidth: 560 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Connect Alpaca</div>
      <p className="muted text-sm" style={{ marginBottom: 12 }}>
        Create a free account at alpaca.markets, generate <b>paper trading</b> API keys, and paste
        them here. The autopilot trades the paper account — no real money — until you explicitly
        switch to live keys <i>and</i> confirm live trading.
      </p>
      <div className="col gap-2">
        <input
          className="field"
          placeholder="API Key ID"
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
        />
        <input
          className="field"
          placeholder="API Secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <label className="row gap-2 text-sm" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} />
          Paper trading (recommended)
        </label>
        {!paper && (
          <div className="text-xs" style={{ color: 'var(--bad)' }}>
            Live keys trade real money. You will still need to confirm live trading after
            connecting.
          </div>
        )}
        {error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{error}</div>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !keyId.trim() || !secret.trim()}
          onClick={() => void connect()}
        >
          {busy ? 'Verifying…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

function LiveAckCard({ onAck }: { onAck: () => void }): JSX.Element {
  const [text, setText] = useState('');
  return (
    <div className="card" style={{ padding: 18, borderColor: 'var(--bad)' }}>
      <div className="eyebrow" style={{ color: 'var(--bad)', marginBottom: 8 }}>
        Live account connected — real money
      </div>
      <p className="muted text-sm" style={{ marginBottom: 10 }}>
        The autopilot will NOT trade this account until you type <b>TRADE LIVE</b> below. Losses
        are real. Consider paper keys instead.
      </p>
      <div className="row gap-2">
        <input
          className="field"
          placeholder="Type TRADE LIVE to confirm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={text !== 'TRADE LIVE'}
          onClick={() => {
            void ipc.trading.setLiveAck(true).then(onAck);
          }}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

const RAIL_FIELDS: Array<{ key: keyof TradingGuardrailsDto; label: string; step: number }> = [
  { key: 'maxPositionPct', label: 'Max position (% equity)', step: 1 },
  { key: 'riskPctPerTrade', label: 'Risk per trade (%)', step: 0.1 },
  { key: 'maxDailyLossPct', label: 'Daily loss halt (%)', step: 0.5 },
  { key: 'maxOpenPositions', label: 'Max open positions', step: 1 },
  { key: 'maxTradesPerDay', label: 'Max trades / day', step: 1 },
  { key: 'cashReservePct', label: 'Cash reserve (%)', step: 5 },
  { key: 'lossStreakPause', label: 'Pause after N losses', step: 1 },
  { key: 'minConfidence', label: 'Min signal confidence', step: 0.05 },
];

function GuardrailsCard({
  guardrails,
  onSaved,
}: {
  guardrails: TradingGuardrailsDto;
  onSaved: (g: TradingGuardrailsDto) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<TradingGuardrailsDto>(guardrails);
  useEffect(() => setDraft(guardrails), [guardrails]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(guardrails);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="eyebrow">Risk guardrails</div>
        {dirty && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              void ipc.trading.setGuardrails(draft).then((r) => onSaved(r.guardrails));
            }}
          >
            Save
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {RAIL_FIELDS.map((f) => (
          <label key={f.key} className="col text-xs muted" style={{ gap: 3 }}>
            {f.label}
            <input
              className="field"
              type="number"
              step={f.step}
              value={draft[f.key]}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
      </div>
      <p className="muted text-xs" style={{ marginTop: 8 }}>
        Every order — autopilot or agent — passes these rules. Out-of-range values are clamped.
      </p>
    </div>
  );
}

function CycleReportCard({ report }: { report: TradingCycleReportDto }): JSX.Element {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Last cycle · {new Date(report.ranAt).toLocaleTimeString()} ·{' '}
        {report.marketOpen ? 'market open' : 'market closed'}
      </div>
      {report.halted && <div className="text-sm" style={{ color: 'var(--warn, #d97706)' }}>⏸ {report.halted}</div>}
      {report.opened.map((o) => (
        <div key={`o-${o.symbol}`} className="text-sm">
          ▲ opened {o.symbol} ×{o.qty} @ {fmt(o.entry)} <span className="muted">({o.strategy})</span>
        </div>
      ))}
      {report.closed.map((c) => (
        <div key={`c-${c.symbol}`} className="text-sm">
          <span className={pnlClass(c.pnl)}>■ closed {c.symbol} {c.pnl >= 0 ? '+' : ''}{fmt(c.pnl)}</span>
          <div className="muted text-xs">{c.review}</div>
        </div>
      ))}
      {report.skipped.slice(0, 6).map((s) => (
        <div key={`s-${s.symbol}`} className="muted text-xs">
          · {s.symbol}: {s.reason}
        </div>
      ))}
      {report.errors.map((e) => (
        <div key={e} className="text-xs" style={{ color: 'var(--bad)' }}>! {e}</div>
      ))}
    </div>
  );
}

function StrategiesCard({
  strategies,
  onToggle,
}: {
  strategies: TradingStrategyDto[];
  onToggle: (s: TradingStrategyDto) => void;
}): JSX.Element {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Strategies</div>
      <div className="col gap-3">
        {strategies.map((s) => {
          const total = s.wins + s.losses;
          return (
            <div key={s.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <b className="text-sm">{s.name}</b>
                  <span className={s.status === 'active' ? 'pill good' : 'pill'}>{s.status}</span>
                </div>
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <span className="mono text-xs">
                    {s.wins}W/{s.losses}L{total > 0 ? ` · ${Math.round((s.wins / total) * 100)}%` : ''}
                  </span>
                  <span className={`mono text-xs ${pnlClass(s.totalPnl)}`}>
                    {s.totalPnl >= 0 ? '+' : ''}{fmt(s.totalPnl)}
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onToggle(s)}>
                    {s.status === 'active' ? 'Retire' : 'Reactivate'}
                  </button>
                </div>
              </div>
              <div className="muted text-xs" style={{ marginTop: 2 }}>{s.description}</div>
              <div className="text-xs" style={{ marginTop: 2, color: 'var(--ink-faint)' }}>
                Inspired by: {s.inspiration}
              </div>
              {s.lessons.length > 0 && (
                <div className="text-xs" style={{ marginTop: 4 }}>
                  <span className="muted">Latest lesson:</span> {s.lessons[s.lessons.length - 1]}
                </div>
              )}
            </div>
          );
        })}
        {strategies.length === 0 && (
          <div className="muted text-sm">Seeded on the first autopilot cycle.</div>
        )}
      </div>
    </div>
  );
}

function JournalCard({ trades, lessons }: { trades: TradingTradeDto[]; lessons: string[] }): JSX.Element {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Trade journal</div>
      {lessons.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="text-xs muted" style={{ marginBottom: 4 }}>Lessons from losses (fed back into the loop):</div>
          {lessons.slice(0, 5).map((l, i) => (
            <div key={i} className="text-xs" style={{ marginBottom: 2 }}>• {l}</div>
          ))}
        </div>
      )}
      <div className="col gap-2">
        {trades.slice(0, 30).map((t) => (
          <div key={t.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="mono text-sm">
                {t.side === 'buy' ? '▲' : '▼'} {t.symbol} ×{t.qty} @ {fmt(t.entryPrice)}
                {t.paper ? '' : ' · LIVE'}
              </span>
              <span className={`mono text-sm ${pnlClass(t.pnl)}`}>
                {t.status === 'open'
                  ? 'open'
                  : t.status === 'canceled'
                    ? 'canceled'
                    : `${(t.pnl ?? 0) >= 0 ? '+' : ''}${fmt(t.pnl)}`}
              </span>
            </div>
            <div className="muted text-xs">
              stop {fmt(t.stoploss)} · target {fmt(t.takeProfit)} ·{' '}
              {new Date(t.openedAt).toLocaleString()}
            </div>
            {t.review && <div className="text-xs" style={{ marginTop: 2 }}>{t.review}</div>}
          </div>
        ))}
        {trades.length === 0 && <div className="muted text-sm">No trades yet.</div>}
      </div>
    </div>
  );
}

export function TradingPanel(): JSX.Element {
  const [status, setStatus] = useState<TradingStatusResponse | null>(null);
  const [account, setAccount] = useState<TradingAccountResponse | null>(null);
  const [trades, setTrades] = useState<TradingTradeDto[]>([]);
  const [lessons, setLessons] = useState<string[]>([]);
  const [strategies, setStrategies] = useState<TradingStrategyDto[]>([]);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const st = await ipc.trading.status();
    setStatus(st);
    if (!st.configured) return;
    const [j, sg] = await Promise.all([ipc.trading.trades(100), ipc.trading.strategies()]);
    setTrades(j.trades);
    setLessons(j.lessons);
    setStrategies(sg.strategies);
    try {
      setAccount(await ipc.trading.account());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status) return <div className="muted text-sm" style={{ padding: 24 }}>Loading…</div>;
  if (!status.configured) {
    return (
      <div style={{ padding: 24 }}>
        <ConnectCard onDone={() => void refresh()} />
      </div>
    );
  }

  const runCycle = async (): Promise<void> => {
    setCycleBusy(true);
    const res = await ipc.trading.runCycle();
    setCycleBusy(false);
    if (!res.ok) setError(res.error ?? 'cycle failed');
    await refresh();
  };

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <h3 className="section-title" style={{ margin: 0 }}>Autopilot</h3>
          <span className={status.paper ? 'pill good' : 'pill'} style={status.paper ? {} : { background: 'var(--bad)', color: '#fff' }}>
            {status.paper ? 'PAPER' : 'LIVE'}
          </span>
          {status.autopilot && <span className="pill good">running</span>}
        </div>
        <div className="row gap-2">
          <button type="button" className="btn btn-sm" disabled={cycleBusy} onClick={() => void runCycle()}>
            {cycleBusy ? 'Running…' : 'Run cycle now'}
          </button>
          <button
            type="button"
            className={status.autopilot ? 'btn btn-sm' : 'btn btn-sm btn-primary'}
            onClick={() => {
              void ipc.trading.setAutopilot(!status.autopilot).then(() => void refresh());
            }}
          >
            {status.autopilot ? 'Stop autopilot' : 'Start autopilot'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              void ipc.trading.disconnect().then(() => void refresh());
            }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {!status.paper && !status.liveAck && (
        <div style={{ marginBottom: 16 }}>
          <LiveAckCard onAck={() => void refresh()} />
        </div>
      )}
      {error && (
        <div className="text-xs" style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="col gap-4">
          {account && (
            <div className="card" style={{ padding: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Account</div>
              <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
                <div><div className="muted text-xs">Equity</div><div className="mono">${fmt(account.equity)}</div></div>
                <div><div className="muted text-xs">Cash</div><div className="mono">${fmt(account.cash)}</div></div>
                <div>
                  <div className="muted text-xs">Today P&L</div>
                  <div className={`mono ${pnlClass(account.dayStats.realizedPnlToday)}`}>
                    {account.dayStats.realizedPnlToday >= 0 ? '+' : ''}${fmt(account.dayStats.realizedPnlToday)}
                  </div>
                </div>
                <div><div className="muted text-xs">Loss streak</div><div className="mono">{account.dayStats.consecutiveLosses}</div></div>
              </div>
              {account.positions.length > 0 && (
                <div className="col gap-1" style={{ marginTop: 10 }}>
                  {account.positions.map((p) => (
                    <div key={p.symbol} className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="mono text-sm">{p.symbol} ×{p.qty} @ {fmt(p.avgEntryPrice)}</span>
                      <span className={`mono text-sm ${pnlClass(p.unrealizedPl)}`}>
                        {p.unrealizedPl >= 0 ? '+' : ''}{fmt(p.unrealizedPl)} ({fmt(p.unrealizedPlPct, 1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {status.lastCycle && <CycleReportCard report={status.lastCycle} />}
          <GuardrailsCard
            guardrails={status.guardrails}
            onSaved={(g) => setStatus((s) => (s ? { ...s, guardrails: g } : s))}
          />
        </div>
        <div className="col gap-4">
          <StrategiesCard
            strategies={strategies}
            onToggle={(s) => {
              void ipc.trading
                .setStrategyStatus(s.id, s.status === 'active' ? 'retired' : 'active')
                .then(() => void refresh());
            }}
          />
          <JournalCard trades={trades} lessons={lessons} />
        </div>
      </div>
      <p className="muted text-xs" style={{ marginTop: 16 }}>
        Autonomous trading is experimental and not financial advice. The autopilot is long-only,
        risk-capped, and paper-mode by default. Past performance never guarantees future results.
      </p>
    </div>
  );
}
