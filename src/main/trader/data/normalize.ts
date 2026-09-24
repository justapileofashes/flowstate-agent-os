// Normalization + validation to the canonical Candle schema. Bad rows are
// dropped (or repaired when the error is tiny) and every problem becomes a
// DataIssue for the alert queue — nothing invalid reaches the store.

import { assetClassOf, TIMEFRAME_MS, type Timeframe } from '@shared/trader/types';
import type { Candle, DataIssue } from './types';
import { barEnd, inSession, sessionFor } from './calendar';

const REPAIR_TOLERANCE = 0.005; // 0.5 % — provider rounding

export interface NormalizeOptions {
  symbol: string;
  timeframe: Timeframe;
  now: number;
  /** Keep only bars that have closed by `now`. */
  closedOnly?: boolean;
  /** Drop equity bars outside the regular session. */
  sessionOnly?: boolean;
}

export function normalizeCandles(raw: Candle[], opts: NormalizeOptions): { candles: Candle[]; issues: DataIssue[] } {
  const { symbol, timeframe, now } = opts;
  const issues: DataIssue[] = [];
  const add = (kind: DataIssue['kind'], ts: number | null, detail: string): void => {
    issues.push({ symbol, timeframe, ts, kind, detail });
  };
  const assetClass = assetClassOf(symbol);
  const tfMs = TIMEFRAME_MS[timeframe];

  let sorted = true;
  for (let i = 1; i < raw.length; i++) if (raw[i]!.ts < raw[i - 1]!.ts) sorted = false;
  if (!sorted) add('unsorted', null, 'provider returned bars out of order; sorted');
  const input = sorted ? raw : [...raw].sort((a, b) => a.ts - b.ts);

  const out: Candle[] = [];
  let lastTs = -Infinity;
  for (const c of input) {
    if (![c.ts, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) {
      add('negative_price', c.ts ?? null, 'non-numeric field');
      continue;
    }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 || c.volume < 0) {
      add('negative_price', c.ts, `non-positive price or negative volume (o=${c.open} h=${c.high} l=${c.low} c=${c.close} v=${c.volume})`);
      continue;
    }
    if (c.ts > now + tfMs) {
      add('future_ts', c.ts, `bar timestamp ${new Date(c.ts).toISOString()} is in the future`);
      continue;
    }
    if (c.ts === lastTs) {
      add('duplicate_ts', c.ts, 'duplicate bar timestamp; kept the first');
      continue;
    }
    let { high, low } = c;
    const top = Math.max(c.open, c.close);
    const bottom = Math.min(c.open, c.close);
    if (high < top || low > bottom || high < low) {
      const err = Math.max((top - high) / top, (low - bottom) / bottom, (low - high) / high, 0);
      if (err > REPAIR_TOLERANCE) {
        add('ohlc_inconsistent', c.ts, `high/low do not bracket open/close by ${(err * 100).toFixed(2)}%`);
        continue;
      }
      high = Math.max(high, top, low);
      low = Math.min(low, bottom, high);
    }
    if (opts.closedOnly && barEnd(c.ts, timeframe, assetClass) > now) continue; // still forming
    if (opts.sessionOnly && assetClass === 'us_equity' && !inSession(c.ts, timeframe)) continue;
    out.push({ ts: c.ts, open: c.open, high, low, close: c.close, volume: c.volume });
    lastTs = c.ts;
  }

  // Missing bars inside one session (equities) or anywhere (crypto).
  if (timeframe !== '1d') {
    for (let i = 1; i < out.length; i++) {
      const gap = out[i]!.ts - out[i - 1]!.ts;
      if (gap <= tfMs * 1.5) continue;
      if (assetClass === 'us_equity') {
        const s = sessionFor(out[i - 1]!.ts);
        if (!s || out[i]!.ts >= s.close) continue; // overnight / weekend
      }
      add('missing_bars', out[i - 1]!.ts, `${Math.round(gap / tfMs) - 1} bar(s) missing before ${new Date(out[i]!.ts).toISOString()}`);
    }
  }
  return { candles: out, issues };
}
