// Full decision trace for one signal / trade: features snapshot, model
// version + hash, each node's message (and any LLM prompt/reply), the risk
// decision rule by rule, orders and fills.

import { useState } from 'react';
import type { NodeMessageDto } from '@shared/trader/types';
import { Modal } from '../business/ui';
import { money, price, signedMoney, useTr, when } from './api';
import { ORDER_PILL, Pill, SIGNAL_PILL, tradeLabel } from './ui';

function NodeBlock({ title, msg }: { title: string; msg: NodeMessageDto | null }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!msg) return null;
  return (
    <div className="tr-audit-node">
      <button className="tr-audit-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <b>{title}</b> <span className="faint">{msg.summary}</span>
      </button>
      {open && (
        <div className="tr-audit-body">
          {msg.llm && (
            <div className="tr-llm">
              <div className="faint tr-small">LLM ({msg.llm.model}, {msg.llm.ms} ms)</div>
              <pre className="tr-pre">{msg.llm.prompt}</pre>
              <pre className="tr-pre">{msg.llm.reply}</pre>
            </div>
          )}
          {msg.data !== undefined && <pre className="tr-pre">{JSON.stringify(msg.data, null, 2).slice(0, 6000)}</pre>}
        </div>
      )}
    </div>
  );
}

export function AuditModal({ signalId, tradeId, onClose }: { signalId?: string; tradeId?: string; onClose: () => void }): JSX.Element {
  const res = useTr('audit.get', { ...(signalId ? { signalId } : {}), ...(tradeId ? { tradeId } : {}) });
  const d = res.data;
  const a = d?.audit ?? null;
  const [showFeatures, setShowFeatures] = useState(false);
  return (
    <Modal title="Decision audit" onClose={onClose} wide>
      {res.error && <div className="fc-errline">{res.error}</div>}
      {!d ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="col gap-3">
          {d.signal && (
            <div className="tr-audit-head">
              <div>
                <b>{d.signal.symbol}</b> {d.signal.side} · {d.signal.timeframe} · {(d.signal.confidence * 100).toFixed(0)}% · edge {d.signal.edgePct.toFixed(3)}% ·{' '}
                <Pill {...SIGNAL_PILL[d.signal.status]} />
              </div>
              <div className="faint tr-small">
                {when(d.signal.createdAt)} · source {d.signal.source} · model {d.signal.modelVersion ?? '—'}
                {a?.modelHash ? ` · sha256 ${a.modelHash.slice(0, 12)}…` : ''}
                {d.signal.strategyName ? ` · strategy "${d.signal.strategyName}"` : ''}
              </div>
              <p className="tr-rationale">{d.signal.rationale}</p>
              {d.signal.reason && <div className="tr-small">Reason: {d.signal.reason}</div>}
            </div>
          )}
          {d.trade && (
            <div className="tr-audit-head">
              <b>Trade</b> <Pill {...tradeLabel(d.trade)} /> {d.trade.side} {d.trade.qty} {d.trade.symbol} @ {price(d.trade.entryPrice)}
              {d.trade.exitPrice !== null ? ` → ${price(d.trade.exitPrice)} (${d.trade.exitReason})` : ''} · P&L {signedMoney(d.trade.pnl)} · fees {money(d.trade.fees)}
              {d.trade.review && <div className="faint tr-small">{d.trade.review}</div>}
            </div>
          )}
          {a?.risk && (
            <div>
              <div className="eyebrow">Risk decision · {a.risk.allowed ? 'approved' : 'rejected'}{a.approvalTs ? ` at ${when(a.approvalTs)}` : ''}</div>
              <div className="tr-small" style={{ margin: '4px 0 6px' }}>
                {a.risk.reason}
              </div>
              <table className="biz-table tr-rules">
                <tbody>
                  {a.risk.results.map((r) => (
                    <tr key={r.rule}>
                      <td className={r.passed ? 'good' : 'bad'}>{r.passed ? '✓' : '✗'}</td>
                      <td className="mono">{r.rule}</td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {a && (
            <div className="col gap-2">
              <div className="eyebrow">Agents</div>
              <NodeBlock title="Researcher" msg={a.research} />
              <NodeBlock title="Quant" msg={a.quant} />
              <NodeBlock title="Trader" msg={a.trader} />
            </div>
          )}
          {d.orders.length > 0 && (
            <div>
              <div className="eyebrow">Orders</div>
              <table className="biz-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Account</th>
                    <th>Role</th>
                    <th>Side / qty</th>
                    <th>Fill</th>
                    <th>Slippage</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.orders.map((o) => (
                    <tr key={o.id}>
                      <td>{when(o.createdAt)}</td>
                      <td>{o.account}</td>
                      <td>{o.role}</td>
                      <td className="mono">
                        {o.side} {o.filledQty}/{o.qty}
                      </td>
                      <td className="mono">{price(o.avgFillPrice)}</td>
                      <td className="mono">{o.slippageBps === null ? '—' : `${o.slippageBps.toFixed(1)} bps`}</td>
                      <td>
                        <Pill {...ORDER_PILL[o.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="faint tr-small">client order ids: {d.orders.map((o) => o.clientOrderId).join(', ')}</div>
            </div>
          )}
          {a && (a.fills.length > 0 || Object.keys(a.features).length > 0) && (
            <div>
              {a.fills.length > 0 && (
                <div className="tr-small">
                  Fills: {a.fills.map((f) => `${f.side} ${f.qty} @ ${price(f.price)} (${when(f.ts)})`).join(' · ')}
                </div>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => setShowFeatures((v) => !v)}>
                {showFeatures ? 'Hide' : 'Show'} the feature snapshot ({Object.keys(a.features).length})
              </button>
              {showFeatures && (
                <div className="tr-features">
                  {Object.entries(a.features).map(([k, v]) => (
                    <span key={k} className="mono">
                      {k} <b>{typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3)) : String(v)}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {!a && d.signal && <div className="faint">No risk evaluation recorded yet (advisory or pending).</div>}
        </div>
      )}
    </Modal>
  );
}
