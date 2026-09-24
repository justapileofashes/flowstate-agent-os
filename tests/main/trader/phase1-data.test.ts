// Phase 1 DoD — data ingestion + feature store.
//   "fetch-and-store AAPL 1h → query confirms bars present;
//    compute_features('AAPL') returns non-null RSI/ATR/ROC columns"

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCandles } from '@main/trader/data/normalize';
import { barEnd, etParts, etToUtc, inSession, isMarketOpen, sessionFor } from '@main/trader/data/calendar';
import { AlpacaDataProvider, YahooProvider, toYahooTicker } from '@main/trader/data/providers';
import { BarLake } from '@main/trader/data/lake';
import { FeatureEngine, FEATURE_NAMES, WARMUP_BARS, wrapFeatures } from '@main/trader/features/engine';
import type { Candle } from '@main/trader/data/types';
import { backfill, FakeFetch, json, makeDb, makeTrader, marketData, sessionOpens, syntheticBars, type DbEnv, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
let dbEnv: DbEnv | null = null;
afterEach(() => {
  env?.cleanup();
  dbEnv?.cleanup();
  env = null;
  dbEnv = null;
});

describe('market calendar', () => {
  it('knows the regular session, DST and holidays', () => {
    const open = etToUtc(2026, 9, 23, 9, 30);
    expect(new Date(open).toISOString()).toBe('2026-09-23T13:30:00.000Z'); // EDT
    expect(new Date(etToUtc(2026, 12, 2, 9, 30)).toISOString()).toBe('2026-12-02T14:30:00.000Z'); // EST
    expect(isMarketOpen('us_equity', open + 60_000)).toBe(true);
    expect(isMarketOpen('us_equity', open - 60_000)).toBe(false);
    expect(sessionFor(etToUtc(2026, 11, 26, 12, 0))).toBeNull(); // Thanksgiving
    expect(sessionFor(etToUtc(2026, 9, 26, 12, 0))).toBeNull(); // Saturday
    expect(isMarketOpen('crypto', etToUtc(2026, 9, 26, 3, 0))).toBe(true);
    const early = sessionFor(etToUtc(2026, 11, 27, 10, 0))!;
    expect(etParts(early.close).hh).toBe(13);
  });

  it('cuts intraday equity bars at the session close and filters extended hours', () => {
    const last = etToUtc(2026, 9, 23, 15, 30);
    expect(barEnd(last, '1h', 'us_equity')).toBe(etToUtc(2026, 9, 23, 16, 0));
    expect(barEnd(last, '1h', 'crypto')).toBe(last + 3_600_000);
    expect(inSession(etToUtc(2026, 9, 23, 9, 0), '1h')).toBe(true); // overlaps the open
    expect(inSession(etToUtc(2026, 9, 23, 7, 0), '1h')).toBe(false);
  });
});

describe('normalization + validation', () => {
  const now = etToUtc(2026, 9, 23, 12, 0);
  const good = (ts: number, px = 100): Candle => ({ ts, open: px, high: px + 1, low: px - 1, close: px + 0.5, volume: 1000 });

  it('drops invalid rows and reports every problem', () => {
    const t0 = etToUtc(2026, 9, 23, 9, 30);
    const raw: Candle[] = [
      good(t0),
      good(t0), // duplicate
      { ts: t0 + 900_000, open: -1, high: 1, low: 1, close: 1, volume: 1 }, // negative
      { ts: t0 + 1_800_000, open: 100, high: 90, low: 80, close: 100, volume: 1 }, // high below close
      good(t0 + 2_700_000),
      { ts: now + 5 * 86_400_000, open: 1, high: 1, low: 1, close: 1, volume: 1 }, // future
    ];
    const { candles, issues } = normalizeCandles(raw, { symbol: 'AAPL', timeframe: '15m', now });
    expect(candles.map((c) => c.ts)).toEqual([t0, t0 + 2_700_000]);
    expect(issues.map((i) => i.kind).sort()).toEqual(['duplicate_ts', 'future_ts', 'missing_bars', 'negative_price', 'ohlc_inconsistent']);
  });

  it('repairs tiny OHLC rounding errors instead of dropping', () => {
    const t0 = etToUtc(2026, 9, 23, 9, 30);
    const { candles, issues } = normalizeCandles([{ ts: t0, open: 100, high: 99.99, low: 99, close: 100, volume: 5 }], { symbol: 'AAPL', timeframe: '15m', now });
    expect(candles[0]!.high).toBe(100);
    expect(issues).toHaveLength(0);
  });

  it('keeps only closed bars when asked', () => {
    const forming = etToUtc(2026, 9, 23, 11, 30); // 1h bar closing 12:30
    const { candles } = normalizeCandles([good(etToUtc(2026, 9, 23, 10, 30)), good(forming)], { symbol: 'AAPL', timeframe: '1h', now, closedOnly: true });
    expect(candles).toHaveLength(1);
  });
});

describe('providers', () => {
  it('Yahoo: builds the chart URL and parses bars', async () => {
    const http = new FakeFetch();
    const t = Math.floor(etToUtc(2026, 9, 22, 9, 30) / 1000);
    http.on('https://query1.finance.yahoo.com/v8/finance/chart/BRK-B', () =>
      json({ chart: { result: [{ timestamp: [t, t + 3600], indicators: { quote: [{ open: [1, 2], high: [2, 3], low: [0.5, 1.5], close: [1.5, null], volume: [10, 20] }] } }] } }),
    );
    const bars = await new YahooProvider(http.fn).fetchBars(['BRK.B'], '1h', t * 1000 - 1, t * 1000 + 86_400_000);
    expect(bars.get('BRK.B')).toEqual([{ ts: t * 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
    expect(http.calls[0]!.url).toContain('interval=60m');
    expect(toYahooTicker('BTC/USD')).toBe('BTC-USD');
  });

  it('Alpaca: multi-symbol request with pagination and key headers', async () => {
    const http = new FakeFetch();
    let page = 0;
    http.on('https://data.alpaca.markets/v2/stocks/bars', (c) => {
      page += 1;
      expect(c.headers['apca-api-key-id']).toBe('KEYID123');
      return page === 1
        ? json({ bars: { AAPL: [{ t: '2026-09-22T13:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }] }, next_page_token: 'p2' })
        : json({ bars: { AAPL: [{ t: '2026-09-22T14:30:00Z', o: 1.5, h: 2, l: 1, c: 1.8, v: 50 }], MSFT: [] }, next_page_token: null });
    });
    const p = new AlpacaDataProvider(() => ({ keyId: 'KEYID123', secret: 'SECRET123' }), http.fn);
    const bars = await p.fetchBars(['AAPL', 'MSFT'], '1h', 0, Date.now());
    expect(bars.get('AAPL')).toHaveLength(2);
    expect(http.calls[1]!.url).toContain('page_token=p2');
    expect(http.calls[0]!.url).toContain('feed=iex');
  });
});

describe('Phase 1 DoD', () => {
  it('fetch-and-store AAPL 1h → bars present in the store and the lake', async () => {
    env = await makeTrader({ withDataDir: true });
    const r = await env.service.handle('data.ingest', { timeframe: '1h', days: 200, symbols: ['AAPL'] });
    expect(r.stored).toBeGreaterThan(500);
    expect(r.source).toBe('yahoo'); // no market-data key → keyless dev source
    const bars = env.service.db.market.bars('AAPL', '1h');
    expect(bars.length).toBe(r.stored);
    expect(bars.every((b, i) => i === 0 || b.ts > bars[i - 1]!.ts)).toBe(true);
    const lakeDir = join(env.dir, 'trader', 'lake', 'bars', '1h', 'AAPL');
    expect(existsSync(lakeDir)).toBe(true);
    expect(readdirSync(lakeDir).length).toBeGreaterThan(100);

    // Incremental: a second run re-fetches only the overlap and writes nothing new to the lake.
    env.yahoo.calls.length = 0;
    const again = await env.service.handle('data.ingest', { timeframe: '1h', days: 200, symbols: ['AAPL'] });
    expect(again.stored).toBe(r.stored); // upsert, no duplicates
    expect(env.service.db.market.bars('AAPL', '1h').length).toBe(r.stored);
    const cov = await env.service.handle('data.coverage', {});
    expect(cov.coverage.find((c) => c.symbol === 'AAPL')?.bars).toBe(r.stored);
  });

  it('switches to Alpaca when a market-data key exists, and retries transient failures', async () => {
    env = await makeTrader({ settings: { trader_data_key_id: 'DATAKEY1', trader_data_secret_key: 'DATASECRET1' } });
    env.alpacaData.fail = new Error('fetch failed: ECONNRESET');
    const r = await env.service.handle('data.ingest', { timeframe: '1h', days: 30, symbols: ['AAPL'] });
    expect(r.source).toBe('alpaca');
    expect(env.alpacaData.calls.length).toBe(3); // 3 attempts with backoff
    expect(r.errors[0]).toMatch(/ECONNRESET/);
    const issues = await env.service.handle('data.issues', {});
    expect(issues.issues[0]!.kind).toBe('fetch_failed');
  });

  it('compute_features(AAPL) returns non-null RSI / ATR / ROC columns', async () => {
    env = await makeTrader();
    await backfill(env);
    const bars = env.service.db.market.bars('AAPL', '1h');
    const frame = new FeatureEngine().compute('AAPL', '1h', bars);
    expect(frame.rows.length).toBe(bars.length - (WARMUP_BARS - 1));
    const idx = (n: string): number => FEATURE_NAMES.indexOf(n as (typeof FEATURE_NAMES)[number]);
    for (const row of frame.rows) {
      for (const f of ['rsi_14', 'atr_pct', 'roc_5', 'roc_15', 'roc_60']) expect(Number.isFinite(row.x[idx(f)])).toBe(true);
      expect(row.x[idx('rsi_14')]).toBeGreaterThanOrEqual(0);
      expect(row.x[idx('rsi_14')]).toBeLessThanOrEqual(100);
      expect(row.x[idx('atr_pct')]).toBeGreaterThan(0);
    }
  });

  it('features are causal: changing future bars never changes past rows', () => {
    const opens = sessionOpens(etToUtc(2026, 3, 2, 12, 0), 60, '1h');
    const bars = syntheticBars({ opens, seed: 5 });
    const cut = 250;
    const past = new FeatureEngine().compute('AAPL', '1h', bars.slice(0, cut));
    const tampered = [...bars.slice(0, cut), ...syntheticBars({ opens: opens.slice(cut), seed: 999, start: 10 })];
    const full = new FeatureEngine().compute('AAPL', '1h', tampered);
    for (const row of past.rows) expect(full.rows.find((r) => r.ts === row.ts)!.x).toEqual(row.x);
  });

  it('wrapFeatures pairs row t with the return at t+h and drops the tail', () => {
    const opens = sessionOpens(etToUtc(2026, 3, 2, 12, 0), 40, '1h');
    const bars = syntheticBars({ opens, seed: 9 });
    const frame = new FeatureEngine().compute('AAPL', '1h', bars);
    const sets = wrapFeatures([frame], new Map([['AAPL', bars]]), [1, 5]);
    const s5 = sets.get(5)!;
    expect(s5.X.length).toBe(frame.rows.length - 5);
    const i = bars.findIndex((b) => b.ts === s5.ts[10]);
    expect(s5.ret[10]).toBeCloseTo((bars[i + 5]!.close / bars[i]!.close - 1) * 100, 9);
    expect(s5.labelTs[10]).toBe(bars[i + 5]!.ts);
    expect(s5.y[10]).toBe(bars[i + 5]!.close > bars[i]!.close ? 1 : 0);
    expect(sets.get(1)!.X.length).toBe(frame.rows.length - 1);
  });

  it('lake is append-only with content-addressed dataset manifests', () => {
    dbEnv = makeDb();
    const wm = new Map<string, number>();
    const lake = new BarLake(join(dbEnv.dir, 'lake'), { get: (k) => wm.get(k) ?? null, set: (k, v) => void wm.set(k, v) });
    const bars = marketData(etToUtc(2026, 9, 23, 12, 0), ['AAPL'], '1h', 20).get('AAPL')!.get('1h')!;
    expect(lake.append('AAPL', '1h', bars)).toBe(bars.length);
    expect(lake.append('AAPL', '1h', bars)).toBe(0); // idempotent
    expect(lake.read('AAPL', '1h')).toEqual(bars);
    const m = { timeframe: '1h' as const, featureSet: 'fs', horizonBars: 2, symbols: [{ symbol: 'AAPL', from: 0, to: 1, bars: 2, sha256: 'x' }] };
    const id = lake.writeManifest(m);
    expect(lake.writeManifest(m)).toBe(id);
    expect(lake.readManifest(id)?.symbols[0]?.symbol).toBe('AAPL');
  });
});
