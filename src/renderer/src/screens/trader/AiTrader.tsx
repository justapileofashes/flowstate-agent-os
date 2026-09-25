// AI Trader — the Trading screen's automated-trading view. Shell: risk
// disclosure gate, header (mode badge, AI on/off switch, scan now, the kill
// switch front and centre), banners (kill switch / circuit breaker / alerts),
// and tabs.

import { useCallback, useState } from 'react';
import type { TraderStatusDto } from '@shared/trader/types';
import { Icon, Modal, Switch } from '../business/ui';
import { ago, errText, tr, useTr, useTraderEvents } from './api';
import { Pill } from './ui';
import { Overview } from './Overview';
import { Signals } from './Signals';
import { Trades } from './Trades';
import { Orders } from './Orders';
import { Models } from './Models';
import { Backtests } from './Backtests';
import { RiskSettings } from './RiskSettings';
import { Monitor } from './Monitor';
import { GoLive } from './GoLive';

type Tab = 'overview' | 'signals' | 'trades' | 'orders' | 'models' | 'backtests' | 'risk' | 'monitor' | 'golive';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'signals', label: 'Signals' },
  { id: 'trades', label: 'Trades & audit' },
  { id: 'orders', label: 'Orders & fills' },
  { id: 'models', label: 'Models' },
  { id: 'backtests', label: 'Backtests' },
  { id: 'risk', label: 'Risk & rules' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'golive', label: 'Brokers & go-live' },
];

const CONSENT_PHRASE = 'I UNDERSTAND';

function Consent({ onDone }: { onDone: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="tr-consent card">
      <div className="eyebrow">AI Trader · risk disclosure</div>
      <h3 className="section-title" style={{ marginTop: 6 }}>Before the AI trades anything</h3>
      <ul className="tr-consent-list">
        <li>Automated trading can lose money quickly. Models trained on past prices can stop working without warning. Nothing here is financial advice.</li>
        <li>Everything starts in <b>paper mode</b>: a simulated account with virtual cash that fills orders against real market bars. No money moves.</li>
        <li>The AI only proposes and explains. Deterministic code sizes, checks and places every order, and every decision is recorded in the audit trail.</li>
        <li>Real-money trading is compiled out of this build. Turning it on takes a code change, 14+ days of paper results, a tested kill switch, and a typed confirmation.</li>
        <li>Real-money automated trading may need your broker's permission and has regulatory implications where you live. Check before going live.</li>
      </ul>
      <div className="row gap-2" style={{ marginTop: 12 }}>
        <input className="field" style={{ maxWidth: 260 }} placeholder={`Type ${CONSENT_PHRASE}`} value={text} onChange={(e) => setText(e.target.value)} aria-label="Consent phrase" />
        <button
          className="btn btn-primary"
          disabled={text.trim().toUpperCase() !== CONSENT_PHRASE}
          onClick={() => {
            void tr('consent.accept', { text })
              .then((r) => (r.accepted ? onDone() : setError(r.error ?? 'not accepted')))
              .catch((e: unknown) => setError(errText(e)));
          }}
        >
          Accept and continue
        </button>
      </div>
      {error && <div className="fc-errline">{error}</div>}
    </div>
  );
}

function KillMenu({ status, onDone }: { status: TraderStatusDto; onDone: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const kill = async (mode: 'halt' | 'flatten'): Promise<void> => {
    setBusy(true);
    try {
      const r = await tr('kill', { mode, reason: mode === 'halt' ? 'halted from the header' : 'flatten from the header' });
      setResult(`${mode === 'halt' ? 'Halted' : 'Flattened'} in ${r.ms} ms: ${r.canceled} order(s) canceled${r.flattened.length ? `, ${r.flattened.length} position(s) closed` : ''}${r.errors.length ? `. Errors: ${r.errors.join('; ')}` : ''}`);
      setOpen(false);
      setConfirmFlatten(false);
      onDone();
    } catch (e) {
      setResult(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (status.kill.active) {
    return (
      <button className="btn btn-sm" onClick={() => void tr('resume', {}).then(onDone)}>
        Resume trading
      </button>
    );
  }
  return (
    <div className="tr-kill-wrap">
      <button className="btn btn-sm tr-kill" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={busy}>
        {Icon.stop}
        <span>Kill switch</span>
      </button>
      {open && (
        <div className="tr-kill-menu card" role="menu">
          <button className="tr-kill-item" role="menuitem" onClick={() => void kill('halt')} disabled={busy}>
            <b>Halt</b>
            <span>Cancel every open order and block new entries. Positions stay open.</span>
          </button>
          {!confirmFlatten ? (
            <button className="tr-kill-item" role="menuitem" onClick={() => setConfirmFlatten(true)} disabled={busy}>
              <b>Flatten</b>
              <span>Halt and close every position at market now.</span>
            </button>
          ) : (
            <button className="tr-kill-item danger" role="menuitem" onClick={() => void kill('flatten')} disabled={busy}>
              <b>Confirm: close all {status.mode === 'live' ? 'LIVE ' : ''}positions</b>
              <span>Market orders for every open position.</span>
            </button>
          )}
        </div>
      )}
      {result && <div className="tr-kill-result faint">{result}</div>}
    </div>
  );
}

export function AiTrader(): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const status = useTr('status', {}, [version], ['status', 'cycle', 'alert']);
  const [scan, setScan] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' });
  const [autoErr, setAutoErr] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  useTraderEvents((ev) => {
    if (ev.type === 'cycle') status.reload();
  });

  if (!status.data) {
    return <div className="muted tr-pad">{status.error || 'Loading the AI Trader…'}</div>;
  }
  const s = status.data;
  if (!s.consentAccepted) {
    return (
      <div className="tr-pad">
        <Consent onDone={bump} />
      </div>
    );
  }
  const runScan = async (): Promise<void> => {
    setScan({ busy: true, msg: '' });
    try {
      const r = await tr('cycles.run', {});
      const c = r.cycle;
      setScan({ busy: false, msg: r.error ?? (c ? `${c.status}${c.skipReason ? `: ${c.skipReason}` : c.abortReason ? `: ${c.abortReason}` : ''} · ${c.signals} signal(s), ${c.orders} order(s)` : '') });
      bump();
    } catch (e) {
      setScan({ busy: false, msg: errText(e) });
    }
  };

  return (
    <div className="tr-root">
      <div className="biz-header tr-header">
        <div>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <h3 className="section-title" style={{ margin: 0 }}>AI Trader</h3>
            <span className={`tr-mode ${s.mode}`}>{s.mode === 'live' ? 'LIVE' : 'PAPER'}</span>
            {s.running && <Pill kind="streaming" label="tick running" />}
            {s.activeModels.length === 0 && <Pill label="no active model" />}
          </div>
          <div className="faint tr-sub">
            {s.market.open ? 'Market open' : `Market closed${s.market.nextOpen ? ` · opens ${ago(s.market.nextOpen)}` : ''}`} · data via {s.dataSource === 'alpaca' ? 'Alpaca' : 'Yahoo (keyless, dev)'} ·{' '}
            {s.lastCycle ? `last tick ${ago(s.lastCycle.startedAt)}` : 'no ticks yet'}
            {s.nextTickAt ? ` · next ${ago(s.nextTickAt)}` : ''}
            <button className="btn btn-sm btn-ghost tr-help" onClick={() => setHelpOpen(true)} aria-label="How it works">
              {Icon.help}
            </button>
          </div>
        </div>
        <div className="tr-actions">
          <label className="tr-auto">
            <Switch
              on={s.autopilot}
              label="Autopilot"
              disabled={s.kill.active}
              onChange={(on) => {
                setAutoErr('');
                void tr('autopilot.set', { enabled: on })
                  .then((r) => {
                    if (r.error) setAutoErr(r.error);
                    bump();
                  })
                  .catch((e: unknown) => setAutoErr(errText(e)));
              }}
            />
            <span>{s.autopilot ? 'AI trading on' : 'AI trading off'}</span>
          </label>
          <button className="btn btn-sm" disabled={scan.busy || s.running} onClick={() => void runScan()} title={s.autopilot ? 'Run a full tick now' : 'Advisory scan: signals only, no orders'}>
            {Icon.play}
            <span>{scan.busy ? 'Scanning…' : s.autopilot ? 'Run tick now' : 'Scan now'}</span>
          </button>
          <KillMenu status={s} onDone={bump} />
        </div>
      </div>
      {autoErr && <div className="fc-errline">{autoErr}</div>}
      {scan.msg && <div className="faint tr-scanmsg">Last manual run: {scan.msg}</div>}
      {s.kill.active && (
        <div className="tr-banner bad">
          {Icon.stop}
          <span>
            Kill switch engaged ({s.kill.mode}) {ago(s.kill.at)}{s.kill.reason ? ` — ${s.kill.reason}` : ''}. No orders will be placed until you resume.
          </span>
        </div>
      )}
      {s.breaker.tripped && (
        <div className="tr-banner warn">
          {Icon.alert}
          <span>Circuit breaker tripped today: {s.breaker.reason}. New entries are halted until the next session.</span>
        </div>
      )}
      <div className="biz-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`biz-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'monitor' && s.openAlerts > 0 && <span className="tr-badge">{s.openAlerts}</span>}
          </button>
        ))}
      </div>
      <div className="biz-tabpanel" role="tabpanel">
        {tab === 'overview' && <Overview status={s} version={version} goTab={(t) => setTab(t as Tab)} />}
        {tab === 'signals' && <Signals status={s} />}
        {tab === 'trades' && <Trades />}
        {tab === 'orders' && <Orders />}
        {tab === 'models' && <Models />}
        {tab === 'backtests' && <Backtests />}
        {tab === 'risk' && <RiskSettings onSaved={bump} />}
        {tab === 'monitor' && <Monitor onChange={bump} />}
        {tab === 'golive' && <GoLive status={s} onChange={bump} />}
      </div>
      <p className="faint tr-foot">
        Paper trading is the default. The AI never sends orders itself; deterministic risk checks and the order manager do. Automated trading can lose money and is not financial advice.
      </p>
      {helpOpen && (
        <Modal title="How the AI Trader decides" onClose={() => setHelpOpen(false)} wide>
          <ol className="tr-howto">
            <li><b>Data.</b> Every closed bar is fetched from Alpaca (with a market-data key) or Yahoo (keyless, dev), validated, stored, and appended to the bar lake.</li>
            <li><b>Researcher.</b> Computes 24 features per symbol (RSI, ATR, MACD, Bollinger, OBV, momentum, VWAP deviation, volume z-score, regime) and the market regime.</li>
            <li><b>Quant.</b> The active model for each timeframe scores the latest bar. Timeframes are fused, then signals need ≥ the confidence threshold and a positive expected edge, and must match a strategy.</li>
            <li><b>Risk officer.</b> Deterministic rules (fixed-fractional sizing, ATR stops, exposure/sector/correlation/liquidity caps, daily-loss circuit breaker, stale-data and trading-hours checks) approve, shrink or reject. An optional LLM reviewer can only veto.</li>
            <li><b>Trader.</b> Validates every number, then the order manager submits with an idempotent client id. Paper orders fill against real bars in the simulator.</li>
            <li><b>Logger.</b> Stores the features snapshot, model version + hash, every node's output, the risk decision, order ids and fills, and writes the rationale.</li>
          </ol>
          <p className="faint">If any step fails, the tick aborts and nothing after it runs, so no order is placed on a half-built decision.</p>
        </Modal>
      )}
    </div>
  );
}
