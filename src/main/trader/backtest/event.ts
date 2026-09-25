// Event-driven backtester (faithful). Walks bars in time order across all
// symbols and runs the same pieces as live trading:
//   decide (quant core) → RiskManager → pending order → fill simulator
//   (latency, partial fills, slippage, commission) → protective exits
//   (stop first, then take-profit, then time exit) → daily circuit breaker →
//   carry costs (short borrow, crypto funding).
// Simulation Mode and the shadow backtester are thin wrappers around this.

import {
  assetClassOf,
  type BacktestMetricsDto,
  type BacktestTradeDto,
  type EquityPointDto,
  type Side,
  type Timeframe,
  type TraderConfig,
} from '@shared/trader/types';
import type { Candle } from '../data/types';
import type { HeldPosition, MarketContext, SignalProposal } from '../types';
import { BARS_PER_YEAR } from '../config';
import { maxDrawdownPct, sharpe } from '../model/metrics';
import type { RiskManager } from '../risk/manager';
import { barEnd, etParts, isMarketOpen } from '../data/calendar';
import { carryPerDay, checkExits, costModel, fillOnBar, slip, type SimOrder } from './fills';

export interface EventInput {
  timeframe: Timeframe;
  candles: Map<string, Candle[]>;
  decide: (symbol: string, index: number, ts: number) => { proposal: SignalProposal | null; reason: string };
  config: TraderConfig;
  risk: RiskManager;
  startEquity: number;
  from: number;
  to?: number;
  /** Treat every bar as tradable (e.g. synthetic data in tests). */
  ignoreSessions?: boolean;
}

export interface EventResult {
  metrics: BacktestMetricsDto;
  trades: BacktestTradeDto[];
  equity: EquityPointDto[];
  rejected: Array<{ ts: number; symbol: string; reason: string }>;
  signals: number;
  breakerTrips: number;
}

interface OpenPos {
  side: Side;
  qty: number;
  entryPrice: number;
  entryTs: number;
  stop: number;
  tp: number;
  holdUntilIdx: number;
  fees: number;
  lastPrice: number;
}

interface Pending {
  order: SimOrder;
  side: Side;
  stop: number;
  tp: number;
  holdBars: number;
  expiresIdx: number;
  activeIdx: number;
}

function avgDailyVolume(c: Candle[], i: number, tf: Timeframe): number | null {
  if (tf === '1d') {
    const win = c.slice(Math.max(0, i - 19), i + 1);
    return win.length ? win.reduce((a, b) => a + b.volume, 0) / win.length : null;
  }
  const byDay = new Map<string, number>();
  for (let k = Math.max(0, i - 2000); k <= i; k++) {
    const d = new Date(c[k]!.ts).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + c[k]!.volume);
  }
  const vols = [...byDay.values()].slice(-20);
  return vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
}

export function returnsCorrelation(a: Candle[], ai: number, b: Candle[], bi: number, n = 60): number | null {
  if (ai < n || bi < n) return null;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let k = 0; k < n; k++) {
    ra.push(a[ai - k]!.close / a[ai - k - 1]!.close - 1);
    rb.push(b[bi - k]!.close / b[bi - k - 1]!.close - 1);
  }
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let k = 0; k < n; k++) {
    cov += (ra[k]! - ma) * (rb[k]! - mb);
    va += (ra[k]! - ma) ** 2;
    vb += (rb[k]! - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}

export function runEventBacktest(input: EventInput): EventResult {
  const { config, timeframe } = input;
  const costs = costModel(config.execution);
  const exec = config.execution;
  const symbols = [...input.candles.keys()];
  const idxMaps = new Map<string, Map<number, number>>();
  const tsSet = new Set<number>();
  for (const s of symbols) {
    const m = new Map<number, number>();
    input.candles.get(s)!.forEach((c, i) => {
      m.set(c.ts, i);
      if (c.ts >= input.from && (input.to === undefined || c.ts <= input.to)) tsSet.add(c.ts);
    });
    idxMaps.set(s, m);
  }
  const timeline = [...tsSet].sort((a, b) => a - b);

  let cash = input.startEquity;
  const pos = new Map<string, OpenPos>();
  const pending = new Map<string, Pending>();
  const lastIdx = new Map<string, number>();
  const trades: BacktestTradeDto[] = [];
  const rejected: EventResult['rejected'] = [];
  const equity: EquityPointDto[] = [];
  const stepReturns: number[] = [];
  let fees = 0;
  let exposedSteps = 0;
  let signals = 0;
  let breakerTrips = 0;
  let dayKey = '';
  let dayStartEquity = input.startEquity;
  let realizedToday = 0;
  let openedToday = 0;
  let lossStreak = 0;
  let breakerDay = '';
  let peak = input.startEquity;
  let prevEquity = input.startEquity;

  const equityNow = (): number => {
    let e = cash;
    for (const p of pos.values()) e += (p.side === 'long' ? 1 : -1) * p.qty * p.lastPrice;
    return e;
  };

  const close = (symbol: string, p: OpenPos, price: number, ts: number, reason: string): void => {
    const comm = Math.max(costs.commissionMin, p.qty * costs.commissionPerShare);
    fees += comm;
    if (p.side === 'long') cash += p.qty * price - comm;
    else cash -= p.qty * price + comm;
    const gross = (p.side === 'long' ? 1 : -1) * (price - p.entryPrice) * p.qty;
    const pnl = gross - p.fees - comm;
    const riskAmt = Math.abs(p.entryPrice - p.stop) * p.qty;
    trades.push({
      symbol,
      side: p.side,
      qty: p.qty,
      entryTs: p.entryTs,
      entryPrice: p.entryPrice,
      exitTs: ts,
      exitPrice: price,
      pnl,
      r: riskAmt > 0 ? pnl / riskAmt : 0,
      exitReason: reason,
      fees: p.fees + comm,
    });
    realizedToday += pnl;
    lossStreak = pnl < 0 ? lossStreak + 1 : 0;
    pos.delete(symbol);
  };

  for (const ts of timeline) {
    // New trading day (ET): reset daily counters, charge carry.
    const dk = etParts(ts).date;
    if (dk !== dayKey) {
      if (dayKey) {
        for (const [s, p] of pos) {
          const c = carryPerDay(p.qty * p.lastPrice, p.side === 'short', assetClassOf(s) === 'crypto', costs);
          cash -= c;
          fees += c;
        }
      }
      dayKey = dk;
      dayStartEquity = equityNow();
      realizedToday = 0;
      openedToday = 0;
    }

    const barsNow: Array<{ symbol: string; i: number; bar: Candle }> = [];
    for (const s of symbols) {
      const i = idxMaps.get(s)!.get(ts);
      if (i === undefined) continue;
      barsNow.push({ symbol: s, i, bar: input.candles.get(s)![i]! });
      lastIdx.set(s, i);
    }

    // 1) fills, 2) exits, 3) marks
    for (const { symbol, i, bar } of barsNow) {
      const pd = pending.get(symbol);
      if (pd && i >= pd.activeIdx) {
        const f = fillOnBar({ ...pd.order, activeFrom: -Infinity }, bar, costs);
        if (f) {
          pd.order.filledQty += f.qty;
          fees += f.commission;
          const existing = pos.get(symbol);
          if (pd.side === 'long') cash -= f.qty * f.price + f.commission;
          else cash += f.qty * f.price - f.commission;
          if (existing) {
            const q = existing.qty + f.qty;
            existing.entryPrice = (existing.entryPrice * existing.qty + f.price * f.qty) / q;
            existing.qty = q;
            existing.fees += f.commission;
          } else {
            pos.set(symbol, {
              side: pd.side,
              qty: f.qty,
              entryPrice: f.price,
              entryTs: bar.ts,
              stop: pd.stop,
              tp: pd.tp,
              holdUntilIdx: pd.holdBars > 0 ? i + pd.holdBars : Number.POSITIVE_INFINITY,
              fees: f.commission,
              lastPrice: bar.close,
            });
            openedToday += 1;
          }
        }
        if (pd.order.filledQty >= pd.order.qty - 1e-9 || i >= pd.expiresIdx) pending.delete(symbol);
      }
      const p = pos.get(symbol);
      if (p) {
        const ex = checkExits(p.side, p.stop, p.tp, bar, costs);
        if (ex) close(symbol, p, ex.price, bar.ts, ex.reason);
        else if (i >= p.holdUntilIdx) close(symbol, p, slip(bar.close, p.side === 'long' ? 'sell' : 'buy', costs.slippageBps), bar.ts, 'time');
        else p.lastPrice = bar.close;
      }
    }

    const eq = equityNow();
    peak = Math.max(peak, eq);
    equity.push({ ts, equity: eq });
    stepReturns.push(prevEquity > 0 ? eq / prevEquity - 1 : 0);
    prevEquity = eq;
    if (pos.size) exposedSteps += 1;

    if (breakerDay === dayKey) continue;

    // 4) decisions at bar close
    for (const { symbol, i, bar } of barsNow) {
      if (pos.has(symbol) || pending.has(symbol)) continue;
      const assetClass = assetClassOf(symbol);
      const end = barEnd(bar.ts, timeframe, assetClass);
      const tradable = input.ignoreSessions || isMarketOpen(assetClass, end, config.schedule.extendedHours);
      if (!tradable) continue;
      const d = input.decide(symbol, i, ts);
      if (!d.proposal) continue;
      signals += 1;
      const held: HeldPosition[] = [...pos.entries()].map(([s, p]) => ({
        symbol: s,
        qty: (p.side === 'long' ? 1 : -1) * p.qty,
        avgPrice: p.entryPrice,
        lastPrice: p.lastPrice,
      }));
      const unrealized = [...pos.values()].reduce((a, p) => a + (p.side === 'long' ? 1 : -1) * (p.lastPrice - p.entryPrice) * p.qty, 0);
      const market: MarketContext = {
        now: end,
        adv: (s) => {
          const c = input.candles.get(s);
          const k = lastIdx.get(s);
          return c && k !== undefined ? avgDailyVolume(c, k, timeframe) : null;
        },
        correlation: (a, b) => {
          const ca = input.candles.get(a);
          const cb = input.candles.get(b);
          const ka = lastIdx.get(a);
          const kb = lastIdx.get(b);
          return ca && cb && ka !== undefined && kb !== undefined ? returnsCorrelation(ca, ka, cb, kb) : null;
        },
        stale: () => false,
        tradable: () => true,
        sector: (s) => config.sectors[s] ?? 'unknown',
        assetClass: (s) => assetClassOf(s),
      };
      const decision = input.risk.evaluate(d.proposal, {
        config: config.risk,
        minConfidence: config.signals.confidenceThreshold,
        maxTradesPerDay: config.risk.maxTradesPerDay,
        portfolio: {
          equity: eq,
          cash,
          peakEquity: peak,
          dayStartEquity,
          realizedToday,
          unrealized,
          openedToday,
          lossStreak,
          positions: held,
          pendingEntries: [...pending.entries()].map(([s, x]) => ({ symbol: s, side: x.side, qty: x.order.qty - x.order.filledQty, price: bar.close })),
        },
        market,
      });
      if (decision.tripBreaker) {
        breakerDay = dayKey;
        breakerTrips += 1;
      }
      if (!decision.allowed) {
        rejected.push({ ts, symbol, reason: decision.reason });
        if (breakerDay === dayKey) break;
        continue;
      }
      const latency = exec.latencyBars;
      pending.set(symbol, {
        order: { side: d.proposal.side === 'long' ? 'buy' : 'sell', type: 'market', qty: decision.suggestedSize, filledQty: 0, limitPrice: null, activeFrom: -Infinity },
        side: d.proposal.side,
        stop: decision.suggestedStop,
        tp: decision.suggestedTakeProfit,
        holdBars: d.proposal.maxHoldBars,
        activeIdx: i + 1 + latency,
        expiresIdx: i + latency + config.signals.expiryBars,
      });
    }
  }

  // Liquidate at the end so metrics reflect realized results.
  const lastTs = timeline[timeline.length - 1] ?? input.from;
  for (const [s, p] of [...pos]) close(s, p, p.lastPrice, lastTs, 'end');
  if (equity.length) equity[equity.length - 1] = { ts: lastTs, equity: cash };

  const assetClass = symbols.every((s) => assetClassOf(s) === 'crypto') ? 'crypto' : 'us_equity';
  const endEquity = equity.length ? equity[equity.length - 1]!.equity : input.startEquity;
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    equity,
    rejected,
    signals,
    breakerTrips,
    metrics: {
      startEquity: input.startEquity,
      endEquity,
      totalReturnPct: (endEquity / input.startEquity - 1) * 100,
      sharpe: sharpe(stepReturns, BARS_PER_YEAR[assetClass][timeframe]),
      maxDrawdownPct: maxDrawdownPct(equity.map((e) => e.equity)),
      winRate: trades.length ? wins / trades.length : 0,
      avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
      trades: trades.length,
      exposurePct: timeline.length ? (exposedSteps / timeline.length) * 100 : 0,
      fees,
      bars: timeline.length,
    },
  };
}
