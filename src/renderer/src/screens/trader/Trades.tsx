// Trades & audit: the P&L ledger (every round trip, with the post-mortem of
// each loss) and the full decision trace behind any trade.

import { useState } from 'react';
import type { AccountKind } from '@shared/trader/types';
import { CardHead, Empty } from '../business/ui';
import { money, price, signedMoney, tone, useTr, when } from './api';
import { Pill, Side, tradeLabel } from './ui';
import { AuditModal } from './Audit';

export function Trades(): JSX.Element {
  const [account, setAccount] = useState<AccountKind | 'all'>('all');
  const [audit, setAudit] = useState<string | null>(null);
  const res = useTr('trades.list', { ...(account !== 'all' ? { account } : {}), limit: 300 }, [], ['trade']);
  const trades = res.data?.trades ?? [];
  const closed = trades.filter((t) => t.status === 'closed' && !t.legacy);
  const wins = closed.filter((t) => t.outcome === 'win').length;
  const pnl = closed.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const fees = closed.reduce((a, t) => a + t.fees, 0);
  return (
    <div className="col gap-4">
      <div className="card biz-card">
        <CardHead
          title="Ledger"
          sub={closed.length ? `${closed.length} closed · win rate ${((wins / closed.length) * 100).toFixed(0)}% · P&L ${signedMoney(pnl)} after ${money(fees)} fees` : 'Every round trip, entry to exit.'}
          right={
            <div className="ap-toggle">
              {(['all', 'paper', 'live', 'shadow'] as const).map((a) => (
                <button key={a} className={account === a ? 'on' : ''} onClick={() => setAccount(a)}>
                  {a}
                </button>
              ))}
            </div>
          }
        />
        {res.error && <div className="fc-errline">{res.error}</div>}
        {!trades.length ? (
          <Empty>No trades yet.</Empty>
        ) : (
          <div className="biz-table-wrap">
            <table className="biz-table">
              <thead>
                <tr>
                  <th>Opened</th>
                  <th>Symbol</th>
                  <th>Acct</th>
                  <th>Qty</th>
                  <th>Entry → exit</th>
                  <th>P&L</th>
                  <th>Exit</th>
                  <th>Model</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td>{when(t.openedAt)}</td>
                    <td>
                      <b>{t.symbol}</b> <Side side={t.side} />
                    </td>
                    <td>{t.account}{t.legacy ? ' · legacy' : ''}</td>
                    <td className="mono">{t.qty}</td>
                    <td className="mono">
                      {price(t.entryPrice)} → {price(t.exitPrice)}
                    </td>
                    <td className={`mono ${tone(t.pnl)}`}>{signedMoney(t.pnl)}</td>
                    <td className="faint">{t.exitReason ?? '—'}</td>
                    <td className="mono faint tr-ellip" title={t.modelVersion ?? ''}>
                      {t.modelVersion ?? '—'}
                    </td>
                    <td>
                      <Pill {...tradeLabel(t)} />
                    </td>
                    <td>
                      {!t.legacy && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setAudit(t.id)}>
                          Audit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card biz-card">
        <CardHead title="Lessons from losses" sub="Deterministic post-mortems. They feed strategy retirement and the replay buffer the weekly micro-update trains on." />
        {!res.data?.lessons.length ? (
          <Empty>No losing trades yet.</Empty>
        ) : (
          <ul className="tr-lessons">
            {res.data.lessons.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      {audit && <AuditModal tradeId={audit} onClose={() => setAudit(null)} />}
    </div>
  );
}
