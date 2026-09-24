// Canonical market-data shapes used everywhere inside the trader. Every
// provider normalizes into these before anything is stored.

import type { Timeframe } from '@shared/trader/types';

/** One OHLCV bar. `ts` = bar OPEN time, epoch ms UTC. */
export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  symbol: string;
  ts: number;
  price: number;
  size: number;
}

export interface BarBatch {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  source: 'alpaca' | 'yahoo';
}

export interface DataIssue {
  symbol: string;
  timeframe: Timeframe;
  ts: number | null;
  kind: 'negative_price' | 'ohlc_inconsistent' | 'future_ts' | 'duplicate_ts' | 'missing_bars' | 'zero_volume' | 'unsorted' | 'fetch_failed' | 'stale';
  detail: string;
}
