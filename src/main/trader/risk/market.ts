// Live MarketContext for the risk engine, built from stored bars: average
// daily volume (liquidity cap), return correlation (correlation cap), stale
// symbols, trading hours and sector map.

import { assetClassOf, type Timeframe, type TraderConfig } from '@shared/trader/types';
import type { TraderDb } from '../db';
import type { Candle } from '../data/types';
import type { MarketContext } from '../types';
import { isMarketOpen } from '../data/calendar';

/** Pearson correlation of bar returns over the last n common timestamps. */
export function correlationFromBars(a: Candle[], b: Candle[], n = 60): number | null {
  const bByTs = new Map(b.map((c) => [c.ts, c.close]));
  const pairs: Array<[number, number]> = [];
  for (const c of a) {
    const v = bByTs.get(c.ts);
    if (v !== undefined) pairs.push([c.close, v]);
  }
  if (pairs.length < 21) return null;
  const tail = pairs.slice(-(n + 1));
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    ra.push(tail[i]![0] / tail[i - 1]![0] - 1);
    rb.push(tail[i]![1] / tail[i - 1]![1] - 1);
  }
  const m = (xs: number[]): number => xs.reduce((x, y) => x + y, 0) / xs.length;
  const ma = m(ra);
  const mb = m(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i]! - ma) * (rb[i]! - mb);
    va += (ra[i]! - ma) ** 2;
    vb += (rb[i]! - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}

export function averageDailyVolume(db: TraderDb, symbol: string, intradayTf: Timeframe, now: number): number | null {
  const daily = db.market.bars(symbol, '1d', { limit: 20 });
  if (daily.length >= 5) return daily.reduce((a, c) => a + c.volume, 0) / daily.length;
  const bars = db.market.bars(symbol, intradayTf, { from: now - 30 * 86_400_000 });
  if (!bars.length) return null;
  const byDay = new Map<string, number>();
  for (const c of bars) {
    const d = new Date(c.ts).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + c.volume);
  }
  const vols = [...byDay.values()].slice(-20);
  return vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
}

export function liveMarketContext(opts: {
  db: TraderDb;
  config: TraderConfig;
  timeframe: Timeframe;
  now: number;
  stale: Set<string>;
  /** Broker clock for equities when available. */
  equityOpen?: boolean | null;
}): MarketContext {
  const { db, config, timeframe, now } = opts;
  const barCache = new Map<string, Candle[]>();
  const bars = (s: string): Candle[] => {
    let c = barCache.get(s);
    if (!c) {
      c = db.market.bars(s, timeframe, { limit: 80 });
      barCache.set(s, c);
    }
    return c;
  };
  const advCache = new Map<string, number | null>();
  return {
    now,
    adv: (s) => {
      if (!advCache.has(s)) advCache.set(s, averageDailyVolume(db, s, timeframe, now));
      return advCache.get(s) ?? null;
    },
    correlation: (a, b) => correlationFromBars(bars(a), bars(b)),
    stale: (s) => opts.stale.has(s),
    tradable: (s) => {
      const cls = assetClassOf(s);
      if (cls === 'us_equity' && opts.equityOpen !== undefined && opts.equityOpen !== null) return opts.equityOpen;
      return isMarketOpen(cls, now, config.schedule.extendedHours);
    },
    sector: (s) => config.sectors[s] ?? 'unknown',
    assetClass: (s) => assetClassOf(s),
  };
}
