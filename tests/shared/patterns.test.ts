import { describe, it, expect } from 'vitest';
import { detectPatterns } from '../../src/shared/patterns';
import { swingLevels } from '../../src/shared/indicators';
import type { Bar } from '../../src/shared/market-types';

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: `2020-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 100,
  }));
}

describe('detectPatterns', () => {
  it('flags a double-bottom (two similar lows with a peak between) as bullish', () => {
    const b = bars([20, 15, 10, 14, 18, 14, 10, 14, 19, 22]);
    const found = detectPatterns(b, swingLevels(b, 2));
    const db = found.find((p) => p.kind === 'double-bottom');
    expect(db).toBeDefined();
    expect(db!.bias).toBe('bullish');
    expect(db!.lines.length).toBeGreaterThan(0);
  });
  it('returns a falling resistance trendline for descending highs', () => {
    const b = bars([30, 25, 28, 22, 26, 19, 24, 16]);
    const found = detectPatterns(b, swingLevels(b, 1), 1);
    const tl = found.find((p) => p.kind === 'trendline-resistance');
    expect(tl).toBeDefined();
    expect(tl!.lines[0]!.from.price).toBeGreaterThan(tl!.lines[0]!.to.price);
  });
  it('returns an empty array when there is no structure', () => {
    const b = bars([10, 10, 10, 10, 10]);
    expect(detectPatterns(b, swingLevels(b, 1))).toEqual([]);
  });
});
