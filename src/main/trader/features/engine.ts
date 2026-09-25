// Feature store engine. compute() turns canonical candles into a causal,
// scale-free feature frame (every value at bar t uses only bars ≤ t);
// wrapFeatures() pairs each row with its forward return at t+h so training
// can never see the future. FEATURE_SET_VERSION pins the schema in the model
// registry.

import { assetClassOf, type Timeframe } from '@shared/trader/types';
import { atr, bollinger, ema, macd, rsi, sma } from '@shared/indicators';
import type { Bar } from '@shared/market-types';
import type { Candle } from '../data/types';
import { sessionFor } from '../data/calendar';

/** Model inputs, in column order. Changing this list requires a FEATURE_SET_VERSION bump. */
export const FEATURE_NAMES = [
  'ret_1',
  'roc_5',
  'roc_15',
  'roc_60',
  'rsi_14',
  'macd_hist',
  'ema_ratio',
  'bb_pctb',
  'bb_width',
  'atr_pct',
  'atr_ratio',
  'sma20_dist',
  'sma50_dist',
  'obv_slope',
  'vol_z',
  'vwap_dev',
  'range_pct',
  'close_pos',
  'dist_high_20',
  'dist_low_20',
  'trend_slope',
  'regime_trend',
  'regime_vol',
  'tod',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const WARMUP_BARS = 61;

export interface FeatureRowOut {
  ts: number;
  close: number;
  atr: number;
  /** One value per FEATURE_NAMES entry. */
  x: number[];
  regime: string;
  /** Display extras (not model inputs). */
  extras: { sma_20: number; macd: number };
}

export interface FeatureFrame {
  symbol: string;
  timeframe: Timeframe;
  rows: FeatureRowOut[];
}

const toBars = (c: Candle[]): Bar[] => c.map((k) => ({ time: '', open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }));

function rolling<T>(arr: T[], i: number, n: number): T[] {
  return arr.slice(Math.max(0, i - n + 1), i + 1);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function regimeLabel(trend: number, vol: number): string {
  const t = trend > 0 ? 'trend_up' : trend < 0 ? 'trend_down' : 'range';
  const v = vol > 0 ? 'high_vol' : vol < 0 ? 'low_vol' : 'normal_vol';
  return `${t}/${v}`;
}

export class FeatureEngine {
  compute(symbol: string, timeframe: Timeframe, candles: Candle[]): FeatureFrame {
    const n = candles.length;
    const frame: FeatureFrame = { symbol, timeframe, rows: [] };
    if (n < WARMUP_BARS) return frame;
    const bars = toBars(candles);
    const close = candles.map((c) => c.close);
    const vol = candles.map((c) => c.volume);
    const rsi14 = rsi(bars, 14);
    const macdS = macd(bars);
    const atr14 = atr(bars, 14);
    const atr50 = atr(bars, 50);
    const bb = bollinger(bars, 20, 2);
    const sma20 = sma(close, 20);
    const sma50 = sma(close, 50);
    const ema12 = ema(close, 12);
    const ema26 = ema(close, 26);
    const ema20 = ema(close, 20);
    const ema50 = ema(close, 50);
    const intraday = timeframe !== '1d';
    const equity = assetClassOf(symbol) === 'us_equity';

    // OBV
    const obv: number[] = [0];
    for (let i = 1; i < n; i++) {
      const d = close[i]! - close[i - 1]!;
      obv.push(obv[i - 1]! + (d > 0 ? vol[i]! : d < 0 ? -vol[i]! : 0));
    }

    // VWAP: session-anchored for intraday equities, rolling 20 otherwise.
    const vwap: number[] = new Array(n).fill(0);
    let pv = 0;
    let vv = 0;
    let sessionOpen = -1;
    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      const typical = (c.high + c.low + c.close) / 3;
      if (intraday && equity) {
        const s = sessionFor(c.ts);
        const so = s?.open ?? -1;
        if (so !== sessionOpen) {
          sessionOpen = so;
          pv = 0;
          vv = 0;
        }
        pv += typical * c.volume;
        vv += c.volume;
        vwap[i] = vv > 0 ? pv / vv : c.close;
      } else {
        const win = rolling(candles, i, 20);
        const v = win.reduce((a, b) => a + b.volume, 0);
        vwap[i] = v > 0 ? win.reduce((a, b) => a + ((b.high + b.low + b.close) / 3) * b.volume, 0) / v : c.close;
      }
    }

    const atrPctSeries: number[] = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const a = atr14[i];
      if (a !== null && a !== undefined) atrPctSeries[i] = (a / close[i]!) * 100;
    }

    for (let i = WARMUP_BARS - 1; i < n; i++) {
      const c = candles[i]!;
      const px = c.close;
      const a14 = atr14[i];
      const a50 = atr50[i];
      const m = macdS[i];
      const b = bb[i];
      const s20 = sma20[i];
      const s50 = sma50[i];
      const e12 = ema12[i];
      const e26 = ema26[i];
      const e20 = ema20[i];
      const e20p = ema20[i - 5];
      const e50 = ema50[i];
      const e50p = ema50[i - 10];
      const r14 = rsi14[i];
      if ([a14, a50, s20, s50, e12, e26, e20, e20p, e50, e50p, r14].some((v) => v === null || v === undefined) || !b || !m || m.histogram === null || m.macd === null) {
        continue;
      }
      const volWin = rolling(vol, i, 20);
      const vz = std(volWin) > 0 ? (vol[i]! - mean(volWin)) / std(volWin) : 0;
      const obvDelta = obv[i]! - obv[i - 20]!;
      const volSum = volWin.reduce((acc, v) => acc + v, 0);
      const hi20 = Math.max(...rolling(candles, i, 20).map((k) => k.high));
      const lo20 = Math.min(...rolling(candles, i, 20).map((k) => k.low));
      const atrPct = (a14! / px) * 100;
      const atrMed = median(rolling(atrPctSeries, i, 100).filter((v) => Number.isFinite(v)));
      const volRegime = atrMed > 0 ? (atrPct > atrMed * 1.3 ? 1 : atrPct < atrMed * 0.7 ? -1 : 0) : 0;
      const slope50 = (e50! - e50p!) / e50p!;
      const trendRegime = slope50 > 0.002 && px > e50! ? 1 : slope50 < -0.002 && px < e50! ? -1 : 0;
      let tod = 0;
      if (intraday && equity) {
        const s = sessionFor(c.ts);
        if (s) tod = Math.min(1, Math.max(0, (c.ts - s.open) / (s.close - s.open)));
      } else if (intraday) {
        tod = (c.ts % 86_400_000) / 86_400_000;
      }
      const range = c.high - c.low;
      const x = [
        Math.log(px / close[i - 1]!) * 100,
        (px / close[i - 5]! - 1) * 100,
        (px / close[i - 15]! - 1) * 100,
        (px / close[i - 60]! - 1) * 100,
        r14!,
        (m.histogram / px) * 100,
        (e12! / e26! - 1) * 100,
        b.upper - b.lower > 0 ? (px - b.lower) / (b.upper - b.lower) : 0.5,
        b.mid > 0 ? ((b.upper - b.lower) / b.mid) * 100 : 0,
        atrPct,
        a50! > 0 ? a14! / a50! : 1,
        (px / s20! - 1) * 100,
        (px / s50! - 1) * 100,
        volSum > 0 ? obvDelta / volSum : 0,
        vz,
        vwap[i]! > 0 ? (px / vwap[i]! - 1) * 100 : 0,
        (range / px) * 100,
        range > 0 ? (px - c.low) / range : 0.5,
        (px / hi20 - 1) * 100,
        (px / lo20 - 1) * 100,
        ((e20! - e20p!) / e20p!) * 100,
        trendRegime,
        volRegime,
        tod,
      ];
      if (!x.every(Number.isFinite)) continue;
      frame.rows.push({
        ts: c.ts,
        close: px,
        atr: a14!,
        x,
        regime: regimeLabel(trendRegime, volRegime),
        extras: { sma_20: s20!, macd: m.macd },
      });
    }
    return frame;
  }

  /** Latest row as a named map (features_latest + audit snapshots). */
  latest(frame: FeatureFrame): { ts: number; close: number; atr: number; regime: string; named: Record<string, number>; x: number[] } | null {
    const r = frame.rows[frame.rows.length - 1];
    if (!r) return null;
    return { ts: r.ts, close: r.close, atr: r.atr, regime: r.regime, named: namedFeatures(r), x: r.x };
  }
}

export function namedFeatures(r: FeatureRowOut): Record<string, number> {
  const out: Record<string, number> = {};
  FEATURE_NAMES.forEach((name, i) => {
    out[name] = Math.round(r.x[i]! * 1e6) / 1e6;
  });
  out['sma_20'] = r.extras.sma_20;
  out['macd'] = r.extras.macd;
  out['roc_5'] = out['roc_5']!;
  out['close'] = r.close;
  out['atr'] = r.atr;
  return out;
}

export function vectorFromNamed(named: Record<string, number>): number[] | null {
  const x = FEATURE_NAMES.map((n) => named[n]);
  return x.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (x as number[]) : null;
}

// ── training frames ─────────────────────────────────────────────────────────

export interface LabeledSet {
  X: number[][];
  /** 1 = close[t+h] > close[t]. */
  y: number[];
  /** Forward return in % (close[t+h]/close[t] − 1). */
  ret: number[];
  /** ATR% at t — lets magnitudes be expressed in volatility units. */
  atrPct: number[];
  ts: number[];
  /** When the label is known (bar t+h open) — used for purging. */
  labelTs: number[];
  symbol: string[];
  close: number[];
  horizon: number;
}

export function emptySet(horizon: number): LabeledSet {
  return { X: [], y: [], ret: [], atrPct: [], ts: [], labelTs: [], symbol: [], close: [], horizon };
}

/**
 * Lagged X/y: row t gets target(t) = return over the next h bars. The last h
 * rows of each symbol have no target and are dropped. Returns one set per
 * horizon, rows sorted by time across symbols.
 */
export function wrapFeatures(frames: FeatureFrame[], candlesBySymbol: Map<string, Candle[]>, horizons: number[]): Map<number, LabeledSet> {
  const out = new Map<number, LabeledSet>();
  const atrIdx = FEATURE_NAMES.indexOf('atr_pct');
  for (const h of horizons) {
    const set = emptySet(h);
    const tmp: Array<{ ts: number; i: number; row: FeatureRowOut; symbol: string; fwd: number; labelTs: number }> = [];
    for (const f of frames) {
      const candles = candlesBySymbol.get(f.symbol) ?? [];
      const idxByTs = new Map<number, number>();
      candles.forEach((c, i) => idxByTs.set(c.ts, i));
      for (const row of f.rows) {
        const i = idxByTs.get(row.ts);
        if (i === undefined || i + h >= candles.length) continue;
        const future = candles[i + h]!;
        tmp.push({ ts: row.ts, i, row, symbol: f.symbol, fwd: (future.close / row.close - 1) * 100, labelTs: future.ts });
      }
    }
    tmp.sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
    for (const t of tmp) {
      set.X.push(t.row.x);
      set.y.push(t.fwd > 0 ? 1 : 0);
      set.ret.push(t.fwd);
      set.atrPct.push(t.row.x[atrIdx]!);
      set.ts.push(t.ts);
      set.labelTs.push(t.labelTs);
      set.symbol.push(t.symbol);
      set.close.push(t.row.close);
    }
    out.set(h, set);
  }
  return out;
}

export function sliceSet(s: LabeledSet, idx: number[]): LabeledSet {
  const pick = <T>(arr: T[]): T[] => idx.map((i) => arr[i]!);
  return {
    X: pick(s.X),
    y: pick(s.y),
    ret: pick(s.ret),
    atrPct: pick(s.atrPct),
    ts: pick(s.ts),
    labelTs: pick(s.labelTs),
    symbol: pick(s.symbol),
    close: pick(s.close),
    horizon: s.horizon,
  };
}
