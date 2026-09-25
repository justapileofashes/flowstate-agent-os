// Signals: every model / agent proposal with confidence, expected edge, the
// risk verdict and human-readable rationale. Proposed signals (advisory scans,
// agent proposals while the AI is off) can be executed or dismissed here.

import { Fragment, useState } from 'react';
import type { SignalDto, SignalStatus, TraderStatusDto } from '@shared/trader/types';
import { CardHead, Empty } from '../business/ui';
import { errText, price, tr, useTr, when } from './api';
import { ConfidenceMeter, Pill, Side, SIGNAL_PILL } from './ui';
import { AuditModal } from './Audit';

type Filter = 'all' | 'traded' | 'rejected' | 'proposed';

const FILTER_STATUSES: Record<Filter, SignalStatus[] | undefined> = {
  all: undefined,
  traded: ['approved', 'submitted', 'filled', 'closed'],
  rejected: ['rejected', 'vetoed', 'failed'],
  proposed: ['proposed'],
};

export function Signals({ status }: { status: TraderStatusDto }): JSX.Element {
  const [since, setSince] = useState<'today' | 'week' | 'all'>('today');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const statuses = FILTER_STATUSES[filter];
  const res = useTr('signals.list', { since, ...(statuses ? { status: statuses } : {}), limit: 500 }, [], ['signal', 'cycle', 'order']);
  const cfg = useTr('config.get', {});
  const threshold = cfg.data?.config.signals.confidenceThreshold;
  const signals = res.data?.signals ?? [];

  const act = async (s: SignalDto, action: 'execute' | 'dismiss'): Promise<void> => {
    setBusy(s.id);
    setMsg('');
    try {
      if (action === 'execute') {
        const r = await tr('signals.execute', { signalId: s.id });
        setMsg(r.ok ? `Order submitted for ${s.symbol} (${r.order?.status}).` : `Not executed: ${r.reason}`);
      } else {
        await tr('signals.dismiss', { signalId: s.id });
      }
      res.reload();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card biz-card">
      <CardHead
        title="Signals"
        sub={status.autopilot ? 'Approved signals are executed automatically by the trader node.' : 'The AI is off: scans produce proposals only. Execute one to send it through the risk engine and order manager.'}
        right={
          <>
            <div className="ap-toggle">
              {(['all', 'traded', 'rejected', 'proposed'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <div className="ap-toggle">
              {(['today', 'week', 'all'] as const).map((f) => (
                <button key={f} className={since === f ? 'on' : ''} onClick={() => setSince(f)}>
                  {f}
                </button>
              ))}
            </div>
          </>
        }
      />
      {msg && <div className="tr-note">{msg}</div>}
      {res.error && <div className="fc-errline">{res.error}</div>}
      {!signals.length ? (
        <Empty>{res.loading ? 'Loading…' : 'No signals in this window. Signals appear when a model scores a closed bar above the confidence threshold.'}</Empty>
      ) : (
        <div className="biz-table-wrap">
          <table className="biz-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Symbol</th>
                <th>TF</th>
                <th>Confidence</th>
                <th>Edge</th>
                <th>Size</th>
                <th>Entry / stop / target</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <Fragment key={s.id}>
                  <tr className="tr-row" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <td>{when(s.createdAt)}</td>
                    <td>
                      <b>{s.symbol}</b> <Side side={s.side} />
                      {s.source !== 'model' && <span className="faint tr-small"> · {s.source}</span>}
                    </td>
                    <td className="mono">{s.timeframe}</td>
                    <td>
                      <ConfidenceMeter value={s.confidence} {...(threshold !== undefined ? { threshold } : {})} />
                    </td>
                    <td className="mono">{s.edgePct ? `${s.edgePct.toFixed(2)}%` : '—'}</td>
                    <td className="mono">{s.size || '—'}</td>
                    <td className="mono faint">
                      {price(s.entry)} / {price(s.stop)} / {price(s.takeProfit)}
                    </td>
                    <td>
                      <Pill {...SIGNAL_PILL[s.status]} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row gap-1">
                        {s.status === 'proposed' && (
                          <>
                            <button className="btn btn-sm" disabled={busy === s.id} onClick={() => void act(s, 'execute')}>
                              Execute
                            </button>
                            <button className="btn btn-sm btn-ghost" disabled={busy === s.id} onClick={() => void act(s, 'dismiss')}>
                              Dismiss
                            </button>
                          </>
                        )}
                        <button className="btn btn-sm btn-ghost" onClick={() => setAudit(s.id)}>
                          Audit
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr key={`${s.id}-x`} className="tr-expand">
                      <td colSpan={9}>
                        <p className="tr-rationale">{s.rationale}</p>
                        {s.reason && <div className="tr-small">{s.status === 'rejected' ? 'Rejected: ' : ''}{s.reason}</div>}
                        {s.perTimeframe.length > 0 && (
                          <div className="faint tr-small">
                            {s.perTimeframe.map((p) => `${p.timeframe}: ${(p.probUp * 100).toFixed(1)}% up (${p.modelVersion})`).join(' · ')}
                          </div>
                        )}
                        {s.strategyName && <div className="faint tr-small">Strategy: {s.strategyName}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {audit && <AuditModal signalId={audit} onClose={() => setAudit(null)} />}
    </div>
  );
}
