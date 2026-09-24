// Cost model + bar-based fill simulator. Shared by the event-driven
// backtester and the paper broker, so Simulation Mode fills exactly the way
// backtests do.
//
// Rules (conservative by construction):
//  - market orders fill at the next bar's open ± slippage;
//  - limit buys fill when low ≤ limit, at min(open, limit); limit sells mirror;
//  - protective stops trigger when the bar trades through them and fill at the
//    worse of open and stop (gaps fill at the open), minus slippage;
//  - if a bar could hit both the stop and the take-profit, the stop wins;
//  - one order may take at most `participationPct` of a bar's volume (partial
//    fills carry over to the next bar).

import type { ExecutionConfig, OrderSide } from '@shared/trader/types';
import type { Candle } from '../data/types';

export interface CostModel {
  slippageBps: number;
  commissionPerShare: number;
  commissionMin: number;
  borrowBpsPerDay: number;
  cryptoFundingBpsPerDay: number;
  participationPct: number;
}

export function costModel(e: ExecutionConfig): CostModel {
  return {
    slippageBps: e.slippageBps,
    commissionPerShare: e.commissionPerShare,
    commissionMin: e.commissionMin,
    borrowBpsPerDay: e.borrowBpsPerDay,
    cryptoFundingBpsPerDay: e.cryptoFundingBpsPerDay,
    participationPct: e.participationPct,
  };
}

export function slip(price: number, side: OrderSide, bps: number): number {
  return side === 'buy' ? price * (1 + bps / 10_000) : price * (1 - bps / 10_000);
}

export function commission(qty: number, c: CostModel): number {
  if (!(qty > 0)) return 0;
  return Math.max(c.commissionMin, qty * c.commissionPerShare);
}

/** Daily carry: borrow fee on short notional, funding on crypto notional. */
export function carryPerDay(notional: number, short: boolean, crypto: boolean, c: CostModel): number {
  let bps = 0;
  if (short) bps += c.borrowBpsPerDay;
  if (crypto) bps += c.cryptoFundingBpsPerDay;
  return Math.abs(notional) * (bps / 10_000);
}

export interface SimOrder {
  side: OrderSide;
  type: 'market' | 'limit';
  qty: number;
  filledQty: number;
  limitPrice: number | null;
  /** Bars before this timestamp are not eligible (latency). */
  activeFrom: number;
}

export interface SimFill {
  qty: number;
  price: number;
  commission: number;
}

/** Try to fill (part of) an entry/exit order on one bar. */
export function fillOnBar(o: SimOrder, bar: Candle, c: CostModel): SimFill | null {
  if (bar.ts < o.activeFrom) return null;
  const remaining = o.qty - o.filledQty;
  if (!(remaining > 0)) return null;
  let price: number | null = null;
  if (o.type === 'market') {
    price = slip(bar.open, o.side, c.slippageBps);
  } else if (o.limitPrice !== null) {
    if (o.side === 'buy' && bar.low <= o.limitPrice) price = Math.min(bar.open, o.limitPrice);
    if (o.side === 'sell' && bar.high >= o.limitPrice) price = Math.max(bar.open, o.limitPrice);
  }
  if (price === null) return null;
  const cap = bar.volume > 0 ? Math.max(1, Math.floor(bar.volume * (c.participationPct / 100))) : remaining;
  const qty = Math.min(remaining, cap);
  return { qty, price, commission: commission(qty, c) };
}

export interface ExitCheck {
  reason: 'stop' | 'take_profit';
  price: number;
}

/** Protective exits for an open position on one bar (stop checked first). */
export function checkExits(side: 'long' | 'short', stop: number | null, tp: number | null, bar: Candle, c: CostModel): ExitCheck | null {
  if (side === 'long') {
    if (stop !== null && bar.low <= stop) return { reason: 'stop', price: slip(Math.min(bar.open, stop), 'sell', c.slippageBps) };
    if (tp !== null && bar.high >= tp) return { reason: 'take_profit', price: Math.max(bar.open, tp) };
  } else {
    if (stop !== null && bar.high >= stop) return { reason: 'stop', price: slip(Math.max(bar.open, stop), 'buy', c.slippageBps) };
    if (tp !== null && bar.low <= tp) return { reason: 'take_profit', price: Math.min(bar.open, tp) };
  }
  return null;
}
