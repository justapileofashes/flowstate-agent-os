// AI Trader building blocks: equity/metric line chart with a crosshair
// tooltip, confidence meter, status pills, and the per-tick pipeline chips.
// Reuses the Business screens' tokens (card, biz-chart, biz-tip, pills).

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CycleDto, ModelStatus, NodeMessageDto, OrderStatus, SignalStatus, TradeDto } from '@shared/trader/types';
import { Pill, type PillKind } from '../business/ui';
import { when } from './api';

export { Pill };

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

export interface LinePoint {
  ts: number;
  value: number;
}

/**
 * Single- or two-series line chart (2px lines, hairline grid, crosshair +
 * tooltip). The second series is drawn dashed in the muted ink — identity is
 * carried by the legend and the line style, never by color alone.
 */
export function LineChart({
  series,
  height = 190,
  format,
  label,
  baseline,
}: {
  series: Array<{ name: string; points: LinePoint[] }>;
  height?: number;
  format: (v: number) => string;
  label: string;
  baseline?: number;
}): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return (
      <div className="tr-chart-empty muted" ref={ref}>
        Not enough data yet — the curve fills in as the account is marked each tick.
      </div>
    );
  }
  const pad = { l: 64, r: 10, t: 12, b: 22 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const t0 = Math.min(...all.map((p) => p.ts));
  const t1 = Math.max(...all.map((p) => p.ts));
  let lo = Math.min(...all.map((p) => p.value), baseline ?? Infinity);
  let hi = Math.max(...all.map((p) => p.value), baseline ?? -Infinity);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const padV = (hi - lo) * 0.08;
  lo -= padV;
  hi += padV;
  const x = (ts: number): number => pad.l + ((ts - t0) / Math.max(1, t1 - t0)) * plotW;
  const y = (v: number): number => pad.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const path = (pts: LinePoint[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const primary = series[0]!.points;
  const idx = hover !== null ? Math.min(primary.length - 1, Math.max(0, hover)) : null;
  const hp = idx !== null ? primary[idx]! : null;
  const ticks = [lo + padV, (lo + hi) / 2, hi - padV];
  return (
    <div className="biz-chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ts = t0 + ((e.clientX - r.left - pad.l) / plotW) * (t1 - t0);
          let best = 0;
          for (let i = 1; i < primary.length; i++) if (Math.abs(primary[i]!.ts - ts) < Math.abs(primary[best]!.ts - ts)) best = i;
          setHover(best);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="biz-grid-line" />
            <text x={pad.l - 6} y={y(t) + 3} className="biz-axis" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {baseline !== undefined && <line x1={pad.l} x2={width - pad.r} y1={y(baseline)} y2={y(baseline)} className="tr-baseline" />}
        {series.map((s, i) => (
          <path key={s.name} d={path(s.points)} className={i === 0 ? 'tr-line' : 'tr-line alt'} />
        ))}
        <text x={pad.l} y={height - 6} className="biz-axis">
          {when(t0)}
        </text>
        <text x={width - pad.r} y={height - 6} className="biz-axis" textAnchor="end">
          {when(t1)}
        </text>
        {hp && (
          <g>
            <line x1={x(hp.ts)} x2={x(hp.ts)} y1={pad.t} y2={pad.t + plotH} className="tr-crosshair" />
            <circle cx={x(hp.ts)} cy={y(hp.value)} r={4} className="tr-dot" />
          </g>
        )}
      </svg>
      {series.length > 1 && (
        <div className="tr-legend">
          {series.map((s, i) => (
            <span key={s.name} className={i === 0 ? 'tr-key' : 'tr-key alt'}>
              {s.name}
            </span>
          ))}
        </div>
      )}
      {hp && (
        <div className="biz-tip" style={{ left: Math.min(width - 90, Math.max(60, x(hp.ts))), top: y(hp.value) - 8 }} role="status">
          <div className="biz-tip-value">{format(hp.value)}</div>
          <div className="biz-tip-label">{new Date(hp.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
          {series.slice(1).map((s) => {
            const q = s.points.reduce((b, p) => (Math.abs(p.ts - hp.ts) < Math.abs(b.ts - hp.ts) ? p : b), s.points[0]!);
            return q ? (
              <div key={s.name} className="biz-tip-label">
                {s.name}: {format(q.value)}
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

export function ConfidenceMeter({ value, threshold }: { value: number; threshold?: number }): JSX.Element {
  const pctVal = Math.round(value * 100);
  return (
    <span className="tr-conf" title={`${pctVal}% confidence${threshold ? ` (threshold ${Math.round(threshold * 100)}%)` : ''}`}>
      <span className="tr-conf-track">
        <span className="tr-conf-fill" style={{ width: `${Math.max(0, Math.min(100, (value - 0.5) * 200))}%` }} />
        {threshold !== undefined && <span className="tr-conf-mark" style={{ left: `${(threshold - 0.5) * 200}%` }} />}
      </span>
      <span className="mono">{pctVal}%</span>
    </span>
  );
}

export const SIGNAL_PILL: Record<SignalStatus, { kind: PillKind; label: string }> = {
  proposed: { kind: '', label: 'proposed' },
  rejected: { kind: 'bad', label: 'rejected' },
  vetoed: { kind: 'bad', label: 'vetoed' },
  approved: { kind: 'streaming', label: 'approved' },
  submitted: { kind: 'streaming', label: 'submitted' },
  filled: { kind: 'good', label: 'in position' },
  closed: { kind: 'good', label: 'closed' },
  expired: { kind: '', label: 'expired' },
  failed: { kind: 'bad', label: 'failed' },
};

export const ORDER_PILL: Record<OrderStatus, { kind: PillKind; label: string }> = {
  new: { kind: '', label: 'new' },
  submitted: { kind: 'streaming', label: 'working' },
  partially_filled: { kind: 'streaming', label: 'partial' },
  filled: { kind: 'good', label: 'filled' },
  canceled: { kind: '', label: 'canceled' },
  rejected: { kind: 'bad', label: 'rejected' },
  expired: { kind: '', label: 'expired' },
  failed: { kind: 'bad', label: 'failed' },
};

export const MODEL_PILL: Record<ModelStatus, { kind: PillKind; label: string }> = {
  candidate: { kind: '', label: 'candidate' },
  shadow: { kind: 'streaming', label: 'shadow' },
  active: { kind: 'good', label: 'active' },
  retired: { kind: '', label: 'retired' },
  rejected: { kind: 'bad', label: 'rejected' },
};

export const CYCLE_PILL: Record<CycleDto['status'], { kind: PillKind; label: string }> = {
  running: { kind: 'streaming', label: 'running' },
  done: { kind: 'good', label: 'done' },
  aborted: { kind: 'bad', label: 'aborted' },
  skipped: { kind: '', label: 'skipped' },
};

export function tradeLabel(t: TradeDto): { kind: PillKind; label: string } {
  if (t.status === 'open') return { kind: 'streaming', label: 'open' };
  if (t.status === 'canceled') return { kind: '', label: 'canceled' };
  return t.outcome === 'win' ? { kind: 'good', label: 'win' } : t.outcome === 'loss' ? { kind: 'bad', label: 'loss' } : { kind: '', label: 'flat' };
}

const NODE_LABEL: Record<NodeMessageDto['node'], string> = {
  data: 'Data',
  reconcile: 'Reconcile',
  guard: 'Guard',
  researcher: 'Researcher',
  quant: 'Quant',
  risk: 'Risk officer',
  trader: 'Trader',
  logger: 'Logger',
};

/** The tick's graph as chips: node, time, and its one-line summary on hover. */
export function NodeChain({ nodes }: { nodes: NodeMessageDto[] }): JSX.Element {
  return (
    <div className="tr-chain">
      {nodes.map((n, i) => (
        <span key={`${n.node}-${i}`} className={`tr-chip ${n.ok ? '' : 'bad'}`} title={n.summary}>
          <span className="tr-chip-name">{NODE_LABEL[n.node] ?? n.node}</span>
          <span className="tr-chip-ms">{n.ms}ms</span>
        </span>
      ))}
    </div>
  );
}

export function Side({ side }: { side: 'long' | 'short' | 'buy' | 'sell' }): JSX.Element {
  const up = side === 'long' || side === 'buy';
  return <span className={`tr-side ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {side}</span>;
}
