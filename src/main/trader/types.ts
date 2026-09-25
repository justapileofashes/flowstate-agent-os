// Main-process domain types shared by signals, risk, backtests and execution.

import type { AssetClass, RiskDecisionDto, Side, SignalDto, Timeframe } from '@shared/trader/types';

/** A candidate trade before risk. Produced by the quant core (or an agent). */
export interface SignalProposal {
  symbol: string;
  side: Side;
  timeframe: Timeframe | 'fused';
  /** Timeframe used for ATR, holding period and bar math. */
  baseTimeframe: Timeframe;
  entry: number;
  stop: number;
  takeProfit: number;
  confidence: number;
  edgePct: number;
  horizonBars: number;
  horizonMin: number;
  /** Exit after this many base-timeframe bars (0 = no time exit). */
  maxHoldBars: number;
  atr: number;
  regime: string;
  barTs: number;
  modelVersion: string | null;
  modelHash: string | null;
  strategyId: string | null;
  strategyName: string | null;
  perTimeframe: SignalDto['perTimeframe'];
  features: Record<string, number | string | null>;
  source: 'model' | 'agent' | 'manual';
  /** Agents/users may ask for a size; the risk engine only ever shrinks it. */
  requestedSize?: number;
  /** Deterministic drivers text (template rationale). */
  drivers: string;
}

export interface HeldPosition {
  symbol: string;
  /** Signed quantity (< 0 = short). */
  qty: number;
  avgPrice: number;
  lastPrice: number;
}

export interface PortfolioState {
  equity: number;
  cash: number;
  peakEquity: number;
  dayStartEquity: number;
  realizedToday: number;
  unrealized: number;
  openedToday: number;
  lossStreak: number;
  positions: HeldPosition[];
  /** Entry orders not yet filled (count toward exposure and position caps). */
  pendingEntries: Array<{ symbol: string; side: Side; qty: number; price: number }>;
}

export interface MarketContext {
  now: number;
  /** Average daily share volume (null = unknown → liquidity rule passes with a note). */
  adv(symbol: string): number | null;
  /** Return correlation between two symbols (null = unknown). */
  correlation(a: string, b: string): number | null;
  /** True when the symbol's data is stale — never trade on stale features. */
  stale(symbol: string): boolean;
  /** True when the symbol's market is open for new entries. */
  tradable(symbol: string): boolean;
  sector(symbol: string): string;
  assetClass(symbol: string): AssetClass;
}

export type RiskDecision = RiskDecisionDto;
