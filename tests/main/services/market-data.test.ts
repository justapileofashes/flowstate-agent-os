import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MarketDataService,
  MarketDataError,
  normalizeSymbol,
  toYahooSymbol,
} from '../../../src/main/services/market-data';

// Three recent daily bars (UTC 14:30 opens) in Yahoo chart-API shape.
const now = Date.now();
const day = 86_400_000;
const ts = [now - 3 * day, now - 2 * day, now - day].map((t) => Math.floor(t / 1000));
function chart(): unknown {
  return {
    chart: {
      error: null,
      result: [
        {
          timestamp: ts,
          indicators: {
            quote: [
              {
                open: [10, 10.5, 11.5],
                high: [11, 12, 12.5],
                low: [9, 10, 11],
                close: [10.5, 11.5, 12],
                volume: [1000, 1200, 900],
              },
            ],
          },
        },
      ],
    },
  };
}
const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

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

describe('toYahooSymbol', () => {
  it('maps user symbols to Yahoo ticker syntax', () => {
    expect(toYahooSymbol('aapl')).toBe('AAPL');
    expect(toYahooSymbol('AAPL.US')).toBe('AAPL');
    expect(toYahooSymbol('BTCUSD')).toBe('BTC-USD');
    expect(toYahooSymbol('ethusdt')).toBe('ETH-USDT');
    expect(toYahooSymbol('eurusd')).toBe('EURUSD=X');
    expect(toYahooSymbol('brk.b')).toBe('BRK-B');
    expect(toYahooSymbol('sap.de')).toBe('SAP.DE');
    expect(toYahooSymbol('^spx')).toBe('^SPX');
  });
});

describe('MarketDataService.history', () => {
  it('parses the Yahoo chart into oldest->newest daily bars', async () => {
    const fetchFn = vi.fn(async (_url: string) => ok(chart()));
    const svc = new MarketDataService({ cacheDir: dir, fetchFn });
    const bars = await svc.history('AAPL', 'max');
    expect(bars).toHaveLength(3);
    expect(bars[0]!.close).toBe(10.5);
    expect(bars[2]!.high).toBe(12.5);
    expect(bars[0]!.time).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(fetchFn.mock.calls[0]![0])).toContain('/v8/finance/chart/AAPL?');
  });

  it('requests the Yahoo ticker for crypto pairs', async () => {
    const fetchFn = vi.fn(async (_url: string) => ok(chart()));
    const svc = new MarketDataService({ cacheDir: dir, fetchFn });
    await svc.history('BTCUSD', '1m');
    expect(String(fetchFn.mock.calls[0]![0])).toContain('/chart/BTC-USD?');
  });

  it('serves the second call from cache (fetch called once)', async () => {
    const fetchFn = vi.fn(async () => ok(chart()));
    const svc = new MarketDataService({ cacheDir: dir, fetchFn });
    await svc.history('AAPL', 'max');
    await svc.history('AAPL', 'max');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws unknown-symbol when Yahoo reports no such ticker', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }), { status: 404 }),
    );
    const svc = new MarketDataService({ cacheDir: dir, fetchFn });
    const err = await svc.history('NOPE', 'max').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MarketDataError);
    expect((err as MarketDataError).kind).toBe('unknown-symbol');
  });

  it('throws unknown-symbol on an empty result', async () => {
    const fetchFn = vi.fn(async () => ok({ chart: { error: null, result: [{ timestamp: [], indicators: { quote: [{}] } }] } }));
    const svc = new MarketDataService({ cacheDir: dir, fetchFn });
    await expect(svc.history('EMPTY', '1m')).rejects.toBeInstanceOf(MarketDataError);
  });

  it('maps network failures to a network MarketDataError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const svc = new MarketDataService({ cacheDir: dir, fetchFn });
    const err = await svc.history('AAPL', '1m').catch((e: unknown) => e);
    expect((err as MarketDataError).kind).toBe('network');
  });
});

describe('MarketDataService.quote', () => {
  it('derives price + change from the last two bars', async () => {
    const svc = new MarketDataService({ cacheDir: dir, fetchFn: vi.fn(async () => ok(chart())) });
    const q = await svc.quote('AAPL');
    expect(q.price).toBe(12);
    expect(q.change).toBeCloseTo(0.5);
  });
});
