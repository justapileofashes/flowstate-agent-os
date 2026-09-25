// Orders & fills: the OMS view — idempotent client ids, working / filled /
// rejected orders per account, actual-vs-assumed slippage, and raw fills.

import { useState } from 'react';
import type { AccountKind } from '@shared/trader/types';
import { CardHead, Empty } from '../business/ui';
import { price, useTr, when } from './api';
import { ORDER_PILL, Pill, Side } from './ui';

export function Orders(): JSX.Element {
  const [account, setAccount] = useState<AccountKind | 'all'>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const orders = useTr('orders.list', { ...(account !== 'all' ? { account } : {}), ...(openOnly ? { open: true } : {}), limit: 300 }, [], ['order']);
  const fills = useTr('fills.list', { ...(account !== 'all' ? { account } : {}), limit: 200 }, [], ['order']);
  const withSlip = (orders.data?.orders ?? []).filter((o) => o.slippageBps !== null && o.role === 'entry');
  const avgSlip = withSlip.length ? withSlip.reduce((a, o) => a + (o.slippageBps ?? 0), 0) / withSlip.length : null;
  return (
    <div className="col gap-4">
      <div className="card biz-card">
        <CardHead
          title="Orders"
          sub={avgSlip !== null ? `Average entry slippage vs decision price: ${avgSlip.toFixed(1)} bps over ${withSlip.length} fill(s)` : 'Every order carries an idempotent client id; retries never double-submit.'}
          right={
            <>
              <label className="row gap-1 tr-small">
                <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> working only
              </label>
              <div className="ap-toggle">
                {(['all', 'paper', 'live', 'shadow'] as const).map((a) => (
                  <button key={a} className={account === a ? 'on' : ''} onClick={() => setAccount(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </>
          }
        />
        {orders.error && <div className="fc-errline">{orders.error}</div>}
        {!orders.data?.orders.length ? (
          <Empty>No orders.</Empty>
        ) : (
          <div className="biz-table-wrap">
            <table className="biz-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Account</th>
                  <th>Symbol</th>
                  <th>Role</th>
                  <th>Type</th>
                  <th>Filled</th>
                  <th>Assumed → fill</th>
                  <th>Slippage</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.orders.map((o) => (
                  <tr key={o.id} title={`client id ${o.clientOrderId}${o.brokerOrderId ? ` · broker id ${o.brokerOrderId}` : ''}`}>
                    <td>{when(o.createdAt)}</td>
                    <td>{o.account}</td>
                    <td>
                      <b>{o.symbol}</b> <Side side={o.side} />
                    </td>
                    <td>{o.role}</td>
                    <td>{o.type}</td>
                    <td className="mono">
                      {o.filledQty}/{o.qty}
                    </td>
                    <td className="mono">
                      {price(o.assumedPrice)} → {price(o.avgFillPrice)}
                    </td>
                    <td className="mono">{o.slippageBps === null ? '—' : `${o.slippageBps.toFixed(1)} bps`}</td>
                    <td>
                      <Pill {...ORDER_PILL[o.status]} />
                      {o.error && <div className="faint tr-small tr-ellip" title={o.error}>{o.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card biz-card">
        <CardHead title="Fills" />
        {!fills.data?.fills.length ? (
          <Empty>No fills.</Empty>
        ) : (
          <div className="biz-table-wrap">
            <table className="biz-table num">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Commission</th>
                </tr>
              </thead>
              <tbody>
                {fills.data.fills.map((f) => (
                  <tr key={f.id}>
                    <td>{when(f.ts)}</td>
                    <td>{f.symbol}</td>
                    <td>{f.side}</td>
                    <td>{f.qty}</td>
                    <td>{price(f.price)}</td>
                    <td>{f.commission.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
