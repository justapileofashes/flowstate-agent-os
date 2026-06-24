import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MarketDataService,
  MarketDataError,
  normalizeSymbol,
} from '../../../src/main/services/market-data';

const CSV = `Date,Open,High,Low,Close,Volume
2024-01-02,10,11,9,10.5,1000
2024-01-03,10.5,12,10,11.5,1200
2024-01-04,11.5,12.5,11,12,900`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mkt-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('normalizeSymbol', () => {
  it('appends .us to a bare US ticker, passes through suffixed/index/forex', () => {
    expect(normalizeSymbol('AAPL')).toBe('aapl.us');
    expect(normalizeSymbol('^spx')).toBe('^spx');
    expect(normalizeSymbol('eurusd')).toBe('eurusd');
    expect(normalizeSymbol('aapl.us')).toBe('aapl.us');
  });
});

describe('MarketDataService.history', () => {
  it('parses Stooq CSV into oldest->newest bars', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(CSV, { status: 200 })));
    const svc = new MarketDataService({ cacheDir: dir });
    const bars = await svc.history('AAPL', 'max');
    expect(bars).toHaveLength(3);
    expect(bars[0]!.close).toBe(10.5);
    expect(bars[2]!.high).toBe(12.5);
  });

  it('serves the second call from cache (fetch called once)', async () => {
    const spy = vi.fn(async () => new Response(CSV, { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const svc = new MarketDataService({ cacheDir: dir });
    await svc.history('AAPL', 'max');
    await svc.history('AAPL', 'max');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws unknown-symbol when Stooq returns the no-data marker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('No data', { status: 200 })));
    const svc = new MarketDataService({ cacheDir: dir });
    await expect(svc.history('NOPE', 'max')).rejects.toBeInstanceOf(MarketDataError);
  });
});
