import { describe, it, expect } from 'vitest';
import { sma, ema, rsi, macd, atr, bollinger, swingLevels, trend } from '../../src/shared/indicators';
import type { Bar } from '../../src/shared/market-types';

function bar(close: number, high = close + 1, low = close - 1, open = close): Bar {
  return { time: '2020-01-01', open, high, low, close, volume: 100 };
}

describe('sma', () => {
  it('nulls until the window fills, then averages', () => {
    expect(sma([2, 4, 6, 8], 2)).toEqual([null, 3, 5, 7]);
  });
});

describe('ema', () => {
  it('seeds from the first value and smooths', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 5); // seed = sma of first 3
    expect(out[3]!).toBeGreaterThan(2);
  });
});

describe('rsi', () => {
  it('is 100 for a monotonic rise', () => {
    const bars = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((c) => bar(c));
    const out = rsi(bars, 14);
    expect(out[14]).toBeCloseTo(100, 5);
  });
  it('warms up with nulls', () => {
    const bars = [10, 11, 12].map((c) => bar(c));
    expect(rsi(bars, 14)[2]).toBeNull();
  });
});

describe('macd', () => {
  it('returns macd/signal/histogram arrays aligned to input length', () => {
    const bars = Array.from({ length: 40 }, (_, i) => bar(10 + i));
    const out = macd(bars, 12, 26, 9);
    expect(out).toHaveLength(40);
    expect(out[39]!.histogram).toBeCloseTo(out[39]!.macd! - out[39]!.signal!, 6);
  });
});

describe('atr', () => {
  it('equals the constant true range when every bar has the same range', () => {
    const bars = Array.from({ length: 20 }, () => bar(10, 11, 9, 10)); // TR = 2 each
    expect(atr(bars, 14)[14]).toBeCloseTo(2, 5);
  });
});

describe('bollinger', () => {
  it('mid equals SMA and bands are symmetric', () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(10 + (i % 2))); // alternating 10/11
    const b = bollinger(bars, 20, 2)[24]!;
    expect(b.upper - b.mid).toBeCloseTo(b.mid - b.lower, 6);
  });
});

describe('swingLevels', () => {
  it('finds a pivot high and low', () => {
    // up to 20, down to 5, back up — 20 is resistance, 5 is support
    const closes = [10, 12, 14, 16, 18, 20, 18, 14, 10, 7, 5, 7, 10, 13, 16];
    const bars = closes.map((c) => bar(c));
    const { supports, resistances } = swingLevels(bars, 3);
    expect(resistances).toContain(20 + 1); // pivot uses highs (close+1)
    expect(supports).toContain(5 - 1); // pivot uses lows (close-1)
  });
});

describe('trend', () => {
  it('reads a steady rise as up and a steady fall as down', () => {
    const up = Array.from({ length: 40 }, (_, i) => bar(10 + i));
    const down = Array.from({ length: 40 }, (_, i) => bar(50 - i));
    expect(trend(up)).toBe('up');
    expect(trend(down)).toBe('down');
  });
});
