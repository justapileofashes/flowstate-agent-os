import { describe, it, expect } from 'vitest';
import { analyzeSymbol } from '../../../src/main/services/stock-analysis';
import type { Bar, Range } from '../../../src/shared/market-types';

// A fake MarketDataService — only `history` is used by analyzeSymbol.
function fakeMarket(bars: Bar[]): { history: (s: string, r: Range) => Promise<Bar[]> } {
  return { history: async () => bars };
}

function series(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: c - 0.3,
    high: c + 0.6,
    low: c - 0.6,
    close: c,
    volume: 1000 + i,
  }));
}

describe('analyzeSymbol', () => {
  it('calls a steady uptrend a buy and returns a long-side plan + chart', async () => {
    const up = series(Array.from({ length: 60 }, (_, i) => 100 + i)); // monotonic rise
    const a = await analyzeSymbol(fakeMarket(up) as never, 'AAPL', { range: '1y' });
    expect(a.direction).toBe('buy');
    expect(a.stoploss).toBeLessThan(a.entry); // long stop below entry
    expect(a.takeProfit[0]!).toBeGreaterThan(a.entry); // targets above
    expect(a.rewardRisk).toBeGreaterThan(0);
    expect(a.chartHtml).toContain('<svg');
    expect(a.factors.length).toBeGreaterThanOrEqual(6);
  });

  it('calls a steady downtrend a sell with a short-side stop above entry', async () => {
    const down = series(Array.from({ length: 60 }, (_, i) => 160 - i));
    const a = await analyzeSymbol(fakeMarket(down) as never, 'AAPL', { range: '1y' });
    expect(a.direction).toBe('sell');
    expect(a.stoploss).toBeGreaterThan(a.entry);
    expect(a.takeProfit[0]!).toBeLessThan(a.entry);
  });

  it('computes position size when account + risk given', async () => {
    const up = series(Array.from({ length: 60 }, (_, i) => 100 + i));
    const a = await analyzeSymbol(fakeMarket(up) as never, 'AAPL', { account: 10000, riskPct: 1 });
    expect(a.positionShares).toBeGreaterThan(0);
  });

  it('throws on insufficient history', async () => {
    const tiny = series([1, 2, 3]);
    await expect(analyzeSymbol(fakeMarket(tiny) as never, 'AAPL')).rejects.toThrow();
  });
});
