// Usage & budget: credits left, month spend vs the cap (80% alert, 100%
// pause), projection, spend per day, spend by role, model table, and the
// ledger. Charts are single-series magnitude views in the app's one accent
// (no hue in this design system): thin marks, 4px rounded data-ends, 2px
// gaps, hairline grid, per-mark hover tooltips; tables are the text view.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { UsageSummaryDto } from '@shared/business/types';
import { biz, errText, fmtCredits, fmtDateTime, fmtUsd, useBiz, useBizLive } from './api';
import { CardHead, Empty, ErrorLine, FieldLabel, Icon, Modal, ROLE_LABEL, Segmented, Stat } from './ui';

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setW(Math.max(240, Math.floor(cw)));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Column with a 4px rounded top and a square baseline. */
function colPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Horizontal bar: square at the baseline, 4px rounded data-end. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h / 2, w);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
  sub?: string;
}

function Tooltip({ tip }: { tip: Tip | null }): JSX.Element | null {
  if (!tip) return null;
  return (
    <div className="biz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="biz-tip-value">{tip.value}</div>
      <div className="biz-tip-label">{tip.label}</div>
      {tip.sub && <div className="biz-tip-label">{tip.sub}</div>}
    </div>
  );
}

function DailyChart({ daily }: { daily: UsageSummaryDto['daily'] }): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const pad = { l: 40, r: 8, t: 18, b: 22 };
  const plotW = width - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(...daily.map((d) => d.credits), 0));
  const band = plotW / Math.max(1, daily.length);
  const barW = Math.max(2, Math.min(24, band - 2));
  const peak = daily.reduce((best, d, i) => (d.credits > (daily[best]?.credits ?? 0) ? i : best), 0);
  const y = (v: number): number => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelDays = daily.length > 1 ? [0, Math.floor((daily.length - 1) / 2), daily.length - 1] : [0];
  const show = (i: number, el: SVGElement | null): void => {
    const d = daily[i]!;
    setHover(i);
    const box = el?.getBoundingClientRect();
    const host = ref.current?.getBoundingClientRect();
    setTip({
      x: box && host ? box.left - host.left + box.width / 2 : pad.l + i * band,
      y: y(d.credits) - 8,
      value: `${fmtCredits(d.credits)} credits`,
      label: new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      sub: d.usd > 0 ? fmtUsd(d.usd) : undefined,
    });
  };
  return (
    <div className="biz-chart" ref={ref} onMouseLeave={() => { setTip(null); setHover(null); }}>
      <svg width={width} height={H} role="img" aria-label="Credits spent per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="biz-grid-line" />
            <text x={pad.l - 6} y={y(t) + 3} className="biz-axis" textAnchor="end">
              {fmtCredits(t)}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = pad.l + i * band + (band - barW) / 2;
          const h = Math.max(0, pad.t + plotH - y(d.credits));
          return (
            <g key={d.day}>
              {h > 0 && <path d={colPath(x, y(d.credits), barW, h)} className={`biz-mark ${hover === i ? 'hot' : ''}`} />}
              <rect
                x={pad.l + i * band}
                y={pad.t}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.day}: ${fmtCredits(d.credits)} credits`}
                onMouseMove={(e) => show(i, e.currentTarget)}
                onFocus={(e) => show(i, e.currentTarget)}
                onBlur={() => setTip(null)}
              />
            </g>
          );
        })}
        {daily[peak] && daily[peak]!.credits > 0 && (
          <text x={pad.l + peak * band + band / 2} y={y(daily[peak]!.credits) - 5} className="biz-axis strong" textAnchor="middle">
            {fmtCredits(daily[peak]!.credits)}
          </text>
        )}
        {labelDays.map((i) => (
          <text key={i} x={pad.l + i * band + band / 2} y={H - 6} className="biz-axis" textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}>
            {daily[i] ? new Date(`${daily[i]!.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
          </text>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function RoleBars({ rows }: { rows: UsageSummaryDto['byRole'] }): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const rowH = 26;
  const barH = 12;
  const labelW = 96;
  const valueW = 56;
  const max = Math.max(...rows.map((r) => r.credits), 0) || 1;
  const trackW = Math.max(40, width - labelW - valueW);
  const H = rows.length * rowH;
  return (
    <div className="biz-chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={H} role="img" aria-label="Credits by role">
        {rows.map((r, i) => {
          const w = (r.credits / max) * trackW;
          const yy = i * rowH + (rowH - barH) / 2;
          const show = (): void =>
            setTip({ x: labelW + w, y: i * rowH, value: `${fmtCredits(r.credits)} credits`, label: ROLE_LABEL[r.role] ?? r.role, sub: `${r.calls} calls · ${fmtUsd(r.usd)}` });
          return (
            <g key={r.role}>
              <text x={0} y={i * rowH + rowH / 2 + 4} className="biz-axis label">
                {ROLE_LABEL[r.role] ?? r.role}
              </text>
              {w > 0 && <path d={barPath(labelW, yy, Math.max(w, 2), barH)} className="biz-mark" />}
              <text x={labelW + w + 6} y={i * rowH + rowH / 2 + 4} className="biz-axis strong">
                {fmtCredits(r.credits)}
              </text>
              <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" tabIndex={0} aria-label={`${r.role}: ${fmtCredits(r.credits)} credits`} onMouseMove={show} onFocus={show} onBlur={() => setTip(null)} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function AddCredits({ onClose }: { onClose: () => void }): JSX.Element {
  const { company } = useBizLive();
  const [credits, setCredits] = useState(1000);
  const [err, setErr] = useState('');
  return (
    <Modal
      title="Add credits"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              try {
                await biz('budgets.addCredits', { companyId: company.id, credits, note: 'manual top-up' });
                onClose();
              } catch (e) {
                setErr(errText(e));
              }
            }}
          >
            Add {fmtCredits(credits)} credits
          </button>
        </>
      }
    >
      <FieldLabel hint="credits are a local budget — nothing is charged">Amount</FieldLabel>
      <input className="field mono" type="number" min={1} value={credits} onChange={(e) => setCredits(Math.max(1, Number(e.target.value) || 1))} />
      <div className="biz-setting-sub" style={{ marginTop: 8 }}>
        1 credit = $0.01 of cloud-model spend, or 4,000 tokens on a local model. Real provider bills come from your own API
        keys; the monthly USD cap in Settings stops cycles before they exceed it.
      </div>
      <ErrorLine error={err} />
    </Modal>
  );
}

export function Usage(): JSX.Element {
  const { company, version } = useBizLive();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { data, error, loading, reload } = useBiz('usage.summary', { companyId: company.id, days: Number(days) }, [version]);
  const [adding, setAdding] = useState(false);
  if (!data) return error ? <ErrorLine error={error} /> : <div className="biz-empty-line muted">Loading…</div>;
  const monthPct = data.monthlyCredits > 0 ? data.monthSpentCredits / data.monthlyCredits : 0;
  const usdPct = data.monthlyUsd > 0 ? data.monthSpentUsd / data.monthlyUsd : 0;
  const pct = Math.max(monthPct, usdPct);

  return (
    <div className={loading ? 'biz-refetch' : ''}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
          ]}
        />
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          {Icon.plus}
          <span>Add credits</span>
        </button>
      </div>
      <ErrorLine error={error} />

      <div className="biz-stats">
        <Stat label="Credits left" value={fmtCredits(data.balance)} tone={data.balance <= 0 ? 'bad' : undefined} />
        <Stat label="Spent this month" value={`${fmtCredits(data.monthSpentCredits)} cr`} sub={`${fmtUsd(data.monthSpentUsd)} cloud spend`} />
        <Stat
          label="Projected month-end"
          value={`${fmtCredits(data.projectedMonthCredits)} cr`}
          sub={`${fmtUsd(data.projectedMonthUsd)} · cap ${fmtCredits(data.monthlyCredits)} cr`}
          tone={data.projectedMonthCredits > data.monthlyCredits ? 'bad' : undefined}
        />
      </div>

      <div className="card biz-card">
        <CardHead title="Monthly budget" sub="Alert at 80%, cycles pause at 100%" />
        <div className="biz-meter big" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
          <div className={`biz-meter-fill ${pct >= 1 ? 'bad' : pct >= 0.8 ? 'warn' : ''}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
          <div className="biz-meter-mark" style={{ left: '80%' }} />
        </div>
        <div className="biz-meter-label mono">
          {Math.round(pct * 100)}% used · {fmtCredits(data.monthSpentCredits)} / {fmtCredits(data.monthlyCredits)} credits
          {data.monthlyUsd > 0 ? ` · ${fmtUsd(data.monthSpentUsd)} / ${fmtUsd(data.monthlyUsd)}` : ''}
        </div>
      </div>

      <div className="biz-grid">
        <div className="biz-col">
          <div className="card biz-card">
            <CardHead title="Credits per day" />
            {data.daily.some((d) => d.credits > 0) ? <DailyChart daily={data.daily} /> : <Empty>No spend in this period.</Empty>}
          </div>
          <div className="card biz-card">
            <CardHead title="By model" sub="Every model call, including failed attempts" />
            {data.byModel.length === 0 ? (
              <Empty>No model calls yet.</Empty>
            ) : (
              <div className="biz-table-wrap">
                <table className="biz-table num">
                  <thead>
                    <tr><th>Model</th><th>Calls</th><th>Errors</th><th>Credits</th><th>USD</th></tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={m.model}>
                        <td className="mono">{m.model}</td>
                        <td>{m.calls}</td>
                        <td className={m.errors ? 'bad' : ''}>{m.errors}</td>
                        <td>{fmtCredits(m.credits)}</td>
                        <td>{fmtUsd(m.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="biz-col">
          <div className="card biz-card">
            <CardHead title="Credits by role" />
            {data.byRole.length ? <RoleBars rows={data.byRole} /> : <Empty>No spend yet.</Empty>}
          </div>
          <div className="card biz-card">
            <CardHead title="Ledger" sub="Grants, spend and automatic refunds" />
            <div className="biz-table-wrap">
              <table className="biz-table num">
                <thead>
                  <tr><th>When</th><th>What</th><th>Δ</th><th>Balance</th></tr>
                </thead>
                <tbody>
                  {data.ledger.slice(0, 25).map((l) => (
                    <tr key={l.id}>
                      <td className="faint">{fmtDateTime(l.createdAt)}</td>
                      <td>{l.reason.replace('_', ' ')}{l.note ? <span className="faint"> · {l.note}</span> : null}</td>
                      <td className={l.delta < 0 ? '' : 'good'}>{l.delta > 0 ? '+' : ''}{fmtCredits(l.delta)}</td>
                      <td>{fmtCredits(l.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {adding && (
        <AddCredits
          onClose={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
