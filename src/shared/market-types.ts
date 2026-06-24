// Shared price-data shapes. Pure types, no runtime — imported by every
// stocks unit (indicators, forecast, patterns, signal) and the market-data service.

export interface Bar {
  time: string; // ISO date 'YYYY-MM-DD' (daily) or ISO datetime (intraday)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Range = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max';

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  asOf: string; // ISO timestamp
}

/** Approx calendar days per range — used to slice history. 'max' = Infinity. */
export const RANGE_DAYS: Record<Range, number> = {
  '1m': 31,
  '3m': 93,
  '6m': 186,
  '1y': 372,
  '2y': 744,
  '5y': 1860,
  max: Infinity,
};
