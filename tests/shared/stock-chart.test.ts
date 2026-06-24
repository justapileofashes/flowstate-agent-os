import { describe, it, expect } from 'vitest';
import { buildStockChart } from '../../src/shared/stock-chart';
import { forecastCone } from '../../src/shared/forecast';
import type { Bar } from '../../src/shared/market-types';
import type { DetectedPattern } from '../../src/shared/patterns';

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: `2024-03-${String(i + 1).padStart(2, '0')}`,
    open: c - 0.5,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 100,
  }));
}

describe('buildStockChart', () => {
  const b = bars([10, 11, 12, 11, 13, 14, 13, 15]);

  it('returns a self-contained html doc with an svg and candle rects', () => {
    const html = buildStockChart({ symbol: 'AAPL', bars: b });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<svg');
    expect(html).toContain('<rect'); // candle bodies
    expect(html).toContain('AAPL');
  });

  it('always carries the not-advice disclaimer', () => {
    const html = buildStockChart({ symbol: 'AAPL', bars: b });
    expect(html).toContain('not financial advice');
  });

  it('draws entry/SL/TP labels when levels are given', () => {
    const html = buildStockChart({
      symbol: 'AAPL',
      bars: b,
      entry: 15,
      stoploss: 13,
      takeProfit: [17, 19],
    });
    expect(html).toContain('Entry');
    expect(html).toContain('SL');
    expect(html).toContain('TP1');
    expect(html).toContain('TP2');
  });

  it('draws the three forecast scenario lines with end labels', () => {
    const forecast = forecastCone({ lastClose: 15, atr: 1, drift: 0.2, horizon: 6, confidence: 0.6 });
    const html = buildStockChart({ symbol: 'AAPL', bars: b, forecast, confidence: 0.6 });
    expect(html).toContain('Bull');
    expect(html).toContain('Base');
    expect(html).toContain('Bear');
    expect(html).toContain('confidence 60%');
    expect(html).toContain('<polygon'); // shaded cone
  });

  it('draws pattern lines with their label', () => {
    const patterns: DetectedPattern[] = [
      {
        kind: 'double-bottom',
        bias: 'bullish',
        confidence: 0.7,
        label: 'Double bottom',
        lines: [{ from: { time: b[2]!.time, price: 11 }, to: { time: b[6]!.time, price: 11 } }],
      },
    ];
    const html = buildStockChart({ symbol: 'AAPL', bars: b, patterns });
    expect(html).toContain('Double bottom');
  });
});
