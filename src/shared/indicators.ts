// Pure technical-analysis math over Bar[] / number[]. No IO. Leading values are
// null until the period warms up — callers must handle nulls.
import type { Bar } from './market-types';

type N = number | null;

export function sma(values: number[], period: number): N[] {
  const out: N[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): N[] {
  const out: N[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period; // seed = SMA
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(bars: Bar[], period = 14): N[] {
  const out: N[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i]!.close - bars[i - 1]!.close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i]!.close - bars[i - 1]!.close;
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdPoint {
  macd: N;
  signal: N;
  histogram: N;
}

export function macd(bars: Bar[], fast = 12, slow = 26, signal = 9): MacdPoint[] {
  const closes = bars.map((b) => b.close);
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const macdLine: N[] = closes.map((_, i) =>
    ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null,
  );
  // signal EMA over the defined portion of macdLine
  const defined = macdLine.map((v) => (v === null ? 0 : v));
  const firstIdx = macdLine.findIndex((v) => v !== null);
  const sigRaw = firstIdx < 0 ? [] : ema(defined.slice(firstIdx), signal);
  const sig: N[] = new Array(bars.length).fill(null);
  for (let i = 0; i < sigRaw.length; i++) sig[firstIdx + i] = sigRaw[i]!;
  return macdLine.map((m, i) => ({
    macd: m,
    signal: sig[i]!,
    histogram: m !== null && sig[i] !== null ? m - (sig[i] as number) : null,
  }));
}

export function atr(bars: Bar[], period = 14): N[] {
  const out: N[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export interface BollingerPoint {
  upper: number;
  mid: number;
  lower: number;
}

export function bollinger(bars: Bar[], period = 20, mult = 2): (BollingerPoint | null)[] {
  const closes = bars.map((b) => b.close);
  const mids = sma(closes, period);
  return mids.map((mid, i) => {
    if (mid === null) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((a, c) => a + (c - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
  });
}

export interface SwingLevels {
  supports: number[];
  resistances: number[];
}

/** Pivot highs/lows: a bar whose high (low) is the max (min) of +/-lookback neighbors. */
export function swingLevels(bars: Bar[], lookback = 10): SwingLevels {
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const win = bars.slice(i - lookback, i + lookback + 1);
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    if (h === Math.max(...win.map((b) => b.high))) resistances.push(h);
    if (l === Math.min(...win.map((b) => b.low))) supports.push(l);
  }
  return { supports, resistances };
}

export type Trend = 'up' | 'down' | 'sideways';

/** EMA(slow) slope over the last quarter of bars decides the trend. */
export function trend(bars: Bar[], period = 20): Trend {
  const closes = bars.map((b) => b.close);
  const e = ema(closes, period).filter((v): v is number => v !== null);
  if (e.length < 2) return 'sideways';
  const recent = e.slice(-Math.max(2, Math.floor(e.length / 4)));
  const slope = (recent[recent.length - 1]! - recent[0]!) / recent[0]!;
  if (slope > 0.01) return 'up';
  if (slope < -0.01) return 'down';
  return 'sideways';
}
