// Vectorized backtester (fast): signals become per-bar position arrays, fills
// at the next bar's open, time-based exits after `holdBars`, slippage and
// commission charged on every entry/exit, capital split into fixed slots of
// `positionPct` of equity. No intrabar stops (use the event-driven engine for
// sign-off). Used for model evaluation and quick strategy checks.

import type { BacktestMetricsDto, BacktestTradeDto, EquityPointDto, Side } from '@shared/trader/types';
import type { Candle } from '../data/types';
import { maxDrawdownPct, sharpe } from '../model/metrics';
import type { CostModel } from './fills';

export interface VecSignal {
  /** Index of the bar on whose close the signal fired. */
  i: number;
  side: Side;
  holdBars: number;
  /** Stop distance in % of price (for R multiples); optional. */
  stopPct?: number;
}

export interface VecSeries {
  symbol: string;
  candles: Candle[];
  signals: VecSignal[];
}

export interface VecInput {
  series: VecSeries[];
  startEquity: number;
  /** Capital per position, % of equity at entry. */
  positionPct: number;
  costs: CostModel;
  periodsPerYear: number;
  /** Only evaluate bars with ts ≥ from. */
  from?: number;
}

export interface BacktestResult {
  metrics: BacktestMetricsDto;
  trades: BacktestTradeDto[];
  equity: EquityPointDto[];
  returns: number[];
}

export function runVectorized(input: VecInput): BacktestResult {
  const from = input.from ?? -Infinity;
  const tsSet = new Set<number>();
  for (const s of input.series) for (const c of s.candles) if (c.ts >= from) tsSet.add(c.ts);
  const timeline = [...tsSet].sort((a, b) => a - b);
  const tIndex = new Map<number, number>();
  timeline.forEach((t, k) => tIndex.set(t, k));
  const weight = input.positionPct / 100;
  const slipFrac = input.costs.slippageBps / 10_000;

  // Per-timeline-step portfolio return contributions.
  const stepRet = new Array<number>(timeline.length).fill(0);
  const exposed = new Array<number>(timeline.length).fill(0);
  const trades: BacktestTradeDto[] = [];
  let fees = 0;

  for (const s of input.series) {
    const c = s.candles;
    const sigs = [...s.signals].sort((a, b) => a.i - b.i);
    let busyUntil = -1;
    for (const sig of sigs) {
      if (sig.i <= busyUntil) continue; // one position per symbol at a time
      const entryIdx = sig.i + 1;
      const exitIdx = Math.min(c.length - 1, sig.i + Math.max(1, sig.holdBars));
      if (entryIdx >= c.length || exitIdx < entryIdx) continue;
      if (c[entryIdx]!.ts < from) continue;
      const dir = sig.side === 'long' ? 1 : -1;
      const entryPx = c[entryIdx]!.open * (1 + dir * slipFrac);
      const exitPx = c[exitIdx]!.close * (1 - dir * slipFrac);
      // Bar-by-bar returns while held (entry bar: open→close).
      for (let k = entryIdx; k <= exitIdx; k++) {
        const t = tIndex.get(c[k]!.ts);
        if (t === undefined) continue;
        const prev = k === entryIdx ? entryPx : c[k - 1]!.close;
        const cur = k === exitIdx ? exitPx : c[k]!.close;
        stepRet[t]! += weight * dir * (cur / prev - 1);
        exposed[t]! += weight;
      }
      const notional = input.startEquity * weight; // per-trade bookkeeping (approx.)
      const qty = notional / entryPx;
      const comm = 2 * Math.max(input.costs.commissionMin, qty * input.costs.commissionPerShare);
      fees += comm;
      const tEntry = tIndex.get(c[entryIdx]!.ts);
      if (tEntry !== undefined) stepRet[tEntry]! -= comm / input.startEquity;
      const ret = dir * (exitPx / entryPx - 1);
      trades.push({
        symbol: s.symbol,
        side: sig.side,
        qty,
        entryTs: c[entryIdx]!.ts,
        entryPrice: entryPx,
        exitTs: c[exitIdx]!.ts,
        exitPrice: exitPx,
        pnl: notional * ret - comm,
        r: sig.stopPct && sig.stopPct > 0 ? (ret * 100) / sig.stopPct : ret * 100,
        exitReason: 'time',
        fees: comm,
      });
      busyUntil = exitIdx;
    }
  }

  let eq = input.startEquity;
  const equity: EquityPointDto[] = [];
  const returns: number[] = [];
  for (let k = 0; k < timeline.length; k++) {
    const r = stepRet[k]!;
    eq *= 1 + r;
    returns.push(r);
    equity.push({ ts: timeline[k]!, equity: eq });
  }
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    equity,
    returns,
    metrics: {
      startEquity: input.startEquity,
      endEquity: eq,
      totalReturnPct: (eq / input.startEquity - 1) * 100,
      sharpe: sharpe(returns, input.periodsPerYear),
      maxDrawdownPct: maxDrawdownPct(equity.map((e) => e.equity)),
      winRate: trades.length ? wins / trades.length : 0,
      avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
      trades: trades.length,
      exposurePct: timeline.length ? (exposed.reduce((a, b) => a + Math.min(1, b), 0) / timeline.length) * 100 : 0,
      fees,
      bars: timeline.length,
    },
  };
}
