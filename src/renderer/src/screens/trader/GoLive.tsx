// Brokers & go-live: credential slots (market data, paper, live — kept
// separate), the paper venue (built-in simulator or Alpaca paper), the kill
// switch test, and the go-live checklist with its typed confirmation.

import { useState } from 'react';
import type { CredentialSlot, TraderStatusDto } from '@shared/trader/types';
import { CardHead, Modal } from '../business/ui';
import { ago, errText, money, tr, useTr } from './api';
import { Pill } from './ui';

const SLOT_INFO: Record<CredentialSlot, { title: string; help: string }> = {
  data: { title: 'Market data', help: 'Alpaca key used only to read bars/trades (IEX feed). Without it, the keyless Yahoo feed is used — fine for development and backtests, not for live trading.' },
  paper: { title: 'Alpaca paper trading', help: 'Optional: route paper orders to your Alpaca paper account instead of the built-in simulator.' },
  live: { title: 'Alpaca live trading', help: 'Real money. Only used after every go-live check passes and you confirm. Use a key different from the market-data key.' },
};

function Slot({ slot, configured, hint, verifiedAt, onChange }: { slot: CredentialSlot; configured: boolean; hint: string; verifiedAt: number | null; onChange: () => void }): JSX.Element {
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const act = async (fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<void> => {
    setBusy(true);
    setMsg('');
    try {
      const r = await fn();
      setMsg(r.detail ?? (r.ok ? 'Done.' : 'Failed.'));
      if (r.ok) {
        setKeyId('');
        setSecret('');
      }
      onChange();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tr-slot">
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <b>{SLOT_INFO[slot].title}</b>
        {configured ? <Pill kind={verifiedAt ? 'good' : ''} label={verifiedAt ? `verified ${ago(verifiedAt)}` : 'saved'} /> : <Pill label="not set" />}
        {configured && <span className="mono faint tr-small">{hint}</span>}
      </div>
      <div className="faint tr-small">{SLOT_INFO[slot].help}</div>
      <div className="row gap-2" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        <input className="field" style={{ width: 200 }} placeholder="API key id" value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" />
        <input className="field" style={{ width: 240 }} type="password" placeholder="API secret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
        <button className="btn btn-sm" disabled={busy || keyId.trim().length < 8 || secret.trim().length < 8} onClick={() => void act(() => tr('credentials.save', { slot, keyId: keyId.trim(), secret: secret.trim() }))}>
          {busy ? 'Checking…' : configured ? 'Replace' : 'Verify & save'}
        </button>
        {configured && (
          <>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act(() => tr('credentials.test', { slot }))}>
              Test
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act(async () => ({ ...(await tr('credentials.delete', { slot })), detail: 'Removed.' }))}>
              Remove
            </button>
          </>
        )}
      </div>
      {msg && <div className="tr-small" style={{ marginTop: 4 }}>{msg}</div>}
    </div>
  );
}

export function GoLive({ status, onChange }: { status: TraderStatusDto; onChange: () => void }): JSX.Element {
  const creds = useTr('credentials.status', {});
  const check = useTr('golive.checklist', {});
  const [msg, setMsg] = useState('');
  const [typed, setTyped] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reset, setReset] = useState('');
  const refresh = (): void => {
    creds.reload();
    check.reload();
    onChange();
  };
  const c = check.data;

  return (
    <div className="col gap-4">
      <div className="card biz-card">
        <CardHead title="Broker & data connections" sub="Keys are stored encrypted with your OS keychain and never shown again. Each is checked against Alpaca before saving." />
        <div className="col gap-4">
          {(creds.data?.credentials ?? []).map((x) => (
            <Slot key={x.slot} slot={x.slot} configured={x.configured} hint={x.keyIdHint} verifiedAt={x.verifiedAt} onChange={refresh} />
          ))}
        </div>
      </div>

      <div className="biz-grid">
        <div className="card biz-card">
          <CardHead title="Paper venue" sub="Where paper orders go. Either way no money moves." />
          <div className="col gap-2">
            {(['simulator', 'alpaca_paper'] as const).map((v) => (
              <label key={v} className="row gap-2 tr-small">
                <input
                  type="radio"
                  name="venue"
                  checked={creds.data?.paperVenue === v}
                  onChange={() => void tr('venue.set', { paperVenue: v }).then((r) => { setMsg(r.error ?? ''); refresh(); })}
                />
                {v === 'simulator' ? 'Built-in simulator (fills against real bars, same model as backtests)' : 'Alpaca paper account (needs the paper key)'}
              </label>
            ))}
            {creds.data?.paperVenue === 'simulator' && (
              <div className="row gap-2" style={{ marginTop: 6 }}>
                <input className="field" style={{ width: 160 }} placeholder="Type RESET" value={reset} onChange={(e) => setReset(e.target.value)} />
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={reset !== 'RESET'}
                  onClick={() => void tr('paper.reset', { confirm: 'RESET' }).then((r) => { setMsg(`Simulator reset to ${money(r.cash, 0)}.`); setReset(''); refresh(); }).catch((e: unknown) => setMsg(errText(e)))}
                >
                  Reset simulator account
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="card biz-card">
          <CardHead title="Kill switch test" sub="Engages the halt, verifies every open order is canceled, then resumes. Required within 30 days before going live." />
          <button
            className="btn btn-sm"
            disabled={status.mode !== 'paper'}
            onClick={() =>
              void tr('killswitch.test', {})
                .then((r) => { setMsg(r.ok ? `Kill switch OK: halted and canceled ${r.canceled} order(s) in ${r.ms} ms, then resumed.` : `Kill switch test failed: ${r.error}`); refresh(); })
                .catch((e: unknown) => setMsg(errText(e)))
            }
          >
            Test the kill switch
          </button>
        </div>
      </div>
      {msg && <div className="tr-note">{msg}</div>}

      <div className="card biz-card">
        <CardHead
          title={status.mode === 'live' ? 'LIVE trading is on' : 'Go-live checklist'}
          sub={status.liveBuildEnabled ? 'Every item must pass. The live broker adapter is not even created until they do.' : 'This build has real-money trading compiled out (LIVE_TRADING_BUILD_ENABLED = false).'}
        />
        <div className="col gap-2">
          {(c?.items ?? []).map((i) => (
            <div key={i.key} className="tr-check">
              <span className={i.ok ? 'good' : 'bad'}>{i.ok ? '✓' : '✗'}</span>
              <div>
                <b>{i.label}</b>
                <div className="faint tr-small">{i.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="row gap-2" style={{ marginTop: 12 }}>
          {status.mode === 'live' ? (
            <button className="btn" onClick={() => void tr('golive.disable', {}).then(refresh)}>
              Back to paper
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!c?.ready} onClick={() => setConfirm(true)}>
              Go live…
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <Modal
          title="Trade real money"
          onClose={() => setConfirm(false)}
          foot={
            <button
              className="btn tr-kill"
              disabled={typed !== 'TRADE LIVE'}
              onClick={() =>
                void tr('golive.enable', { confirm: typed }).then((r) => {
                  setMsg(r.live ? 'Live mode enabled. The AI is off until you switch it on.' : r.error ?? 'not enabled');
                  setConfirm(false);
                  setTyped('');
                  refresh();
                })
              }
            >
              Enable live trading
            </button>
          }
        >
          <p>
            Live mode sends orders to your real Alpaca account. Losses are real. The AI stays off until you switch it on, every order still passes the risk engine, and a paper shadow book mirrors each live trade so you can compare fills.
          </p>
          <input className="field" placeholder="Type TRADE LIVE" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
