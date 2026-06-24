// Pure chart-pattern detection -> drawable line segments. Built on swing pivots.
// Phase 1 detects double-bottom and support/resistance trendlines; the wider
// catalog is typed for forward-compat.
import type { Bar } from './market-types';
import type { SwingLevels } from './indicators';

export type PatternKind =
  | 'trendline-support'
  | 'trendline-resistance'
  | 'channel'
  | 'triangle-ascending'
  | 'triangle-descending'
  | 'triangle-symmetrical'
  | 'double-top'
  | 'double-bottom'
  | 'head-shoulders'
  | 'wedge';

export interface PatternLine {
  from: { time: string; price: number };
  to: { time: string; price: number };
}

export interface DetectedPattern {
  kind: PatternKind;
  lines: PatternLine[];
  label: string;
  confidence: number; // 0..1
  bias: 'bullish' | 'bearish' | 'neutral';
}

interface Pivot {
  index: number;
  price: number;
}

function pivotLows(bars: Bar[], lookback: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const win = bars.slice(i - lookback, i + lookback + 1);
    if (bars[i]!.low === Math.min(...win.map((b) => b.low))) out.push({ index: i, price: bars[i]!.low });
  }
  return out;
}

function pivotHighs(bars: Bar[], lookback: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const win = bars.slice(i - lookback, i + lookback + 1);
    if (bars[i]!.high === Math.max(...win.map((b) => b.high))) out.push({ index: i, price: bars[i]!.high });
  }
  return out;
}

export function detectPatterns(bars: Bar[], _pivots: SwingLevels, lookback = 2): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  if (bars.length < 5) return out;
  const lows = pivotLows(bars, lookback);
  const highs = pivotHighs(bars, lookback);

  // Double bottom: two lows within 3% of each other, with a higher pivot between them.
  for (let a = 0; a < lows.length; a++) {
    for (let b = a + 1; b < lows.length; b++) {
      const lo1 = lows[a]!;
      const lo2 = lows[b]!;
      const diff = Math.abs(lo1.price - lo2.price) / lo1.price;
      if (diff > 0.03) continue;
      const peakBetween = highs.find((h) => h.index > lo1.index && h.index < lo2.index);
      if (!peakBetween) continue;
      out.push({
        kind: 'double-bottom',
        bias: 'bullish',
        confidence: Math.max(0.4, 1 - diff * 10),
        label: 'Double bottom',
        lines: [
          { from: { time: bars[lo1.index]!.time, price: lo1.price }, to: { time: bars[lo2.index]!.time, price: lo2.price } },
        ],
      });
    }
  }

  // Trendlines through first/last pivot of each kind.
  if (highs.length >= 2) {
    const f = highs[0]!;
    const l = highs[highs.length - 1]!;
    out.push({
      kind: 'trendline-resistance',
      bias: l.price < f.price ? 'bearish' : 'neutral',
      confidence: 0.5,
      label: 'Resistance trendline',
      lines: [{ from: { time: bars[f.index]!.time, price: f.price }, to: { time: bars[l.index]!.time, price: l.price } }],
    });
  }
  if (lows.length >= 2) {
    const f = lows[0]!;
    const l = lows[lows.length - 1]!;
    out.push({
      kind: 'trendline-support',
      bias: l.price > f.price ? 'bullish' : 'neutral',
      confidence: 0.5,
      label: 'Support trendline',
      lines: [{ from: { time: bars[f.index]!.time, price: f.price }, to: { time: bars[l.index]!.time, price: l.price } }],
    });
  }

  return out;
}
