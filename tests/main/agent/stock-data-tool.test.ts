import { describe, it, expect, vi, beforeEach } from 'vitest';

// electron's app.getPath is needed by the lazy service constructor path; stub it.
vi.mock('electron', () => ({ app: { getPath: () => '.' } }));
// Stub the market-data service so no network/disk is touched.
const sampleBars = Array.from({ length: 40 }, (_, i) => ({
  time: `2024-02-${String(i + 1).padStart(2, '0')}`,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volume: 1000,
}));
vi.mock('@main/services/market-data', () => ({
  MarketDataService: class {
    async history(): Promise<typeof sampleBars> {
      return sampleBars;
    }
  },
}));

import { ToolDispatcher } from '../../../src/main/agent/tool-dispatcher';

function makeDispatcher(): ToolDispatcher {
  // Minimal deps — stock_data needs none of the file/approval plumbing.
  // stock_chart writes a file, so give it a no-op fileTools.writeFile.
  const fileTools = { writeFile: async () => ({ ok: true }) } as never;
  return new ToolDispatcher({ fileTools, workspaceRoot: '.' });
}

describe('stock_data tool', () => {
  let d: ToolDispatcher;
  beforeEach(() => {
    d = makeDispatcher();
  });

  it('returns bars + requested indicators as JSON', async () => {
    const res = await d.call('c1', 'stock_data', {
      symbol: 'AAPL',
      range: '1y',
      indicators: ['rsi', 'patterns'],
    });
    expect(res.ok).toBe(true);
    const json = JSON.parse(res.content);
    expect(json.symbol).toBe('AAPL');
    expect(json.bars.length).toBe(40);
    expect(json.indicators.rsi).not.toBeUndefined();
    expect(json.trend).toBe('up');
    expect(Array.isArray(json.patterns)).toBe(true);
  });

  it('rejects an empty symbol with an ERROR string', async () => {
    const res = await d.call('c2', 'stock_data', { symbol: '' });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/^ERROR:/);
  });
});

describe('stock_chart tool', () => {
  it('renders chart html with levels + forecast embedded', async () => {
    const d = makeDispatcher();
    const res = await d.call('c3', 'stock_chart', {
      symbol: 'AAPL',
      range: '6m',
      entry: 130,
      stoploss: 125,
      takeProfit: [140, 150],
      outlook: 'bullish',
      confidence: 0.6,
    });
    expect(res.ok).toBe(true);
    const json = JSON.parse(res.content);
    expect(json.symbol).toBe('AAPL');
    expect(json.html).toContain('<svg');
    expect(json.html).toContain('Entry');
    expect(json.html).toContain('Bull');
    expect(json.html).toContain('not financial advice');
  });
});
