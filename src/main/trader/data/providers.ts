// Market-data providers. Each returns raw (not yet validated) candles in the
// canonical shape; the pipeline normalizes + validates before storing.
//
//  - AlpacaDataProvider: Alpaca Market Data API (stocks v2 IEX feed with a key;
//    crypto v1beta3 needs no key). Multi-symbol requests with pagination.
//  - YahooProvider: Yahoo Finance chart API, keyless. Development and
//    backtests only (spec: "never prod"); intraday history is capped by Yahoo
//    (5m/15m ≈ 60 days, 1h ≈ 730 days).

import { assetClassOf, TIMEFRAME_MS, type Timeframe } from '@shared/trader/types';
import type { Candle, Tick } from './types';
import { dailyTs } from './calendar';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limited' | 'network' | 'not_found' | 'bad_response',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isTransientProviderError(err: unknown): boolean {
  return err instanceof ProviderError ? err.kind === 'rate_limited' || err.kind === 'network' : /fetch failed|timeout|ECONN|429|5\d\d/i.test(String(err));
}

export interface BarProvider {
  readonly name: 'alpaca' | 'yahoo';
  fetchBars(symbols: string[], timeframe: Timeframe, from: number, to: number): Promise<Map<string, Candle[]>>;
  latestTrades?(symbols: string[]): Promise<Tick[]>;
}

async function readJson(res: Response, what: string): Promise<unknown> {
  if (res.status === 401 || res.status === 403) throw new ProviderError('auth', `${what}: HTTP ${res.status} (check the market-data key)`);
  if (res.status === 404) throw new ProviderError('not_found', `${what}: not found`);
  if (res.status === 429) throw new ProviderError('rate_limited', `${what}: rate limited`);
  if (!res.ok) throw new ProviderError('network', `${what}: HTTP ${res.status}`);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new ProviderError('bad_response', `${what}: non-JSON response`);
  }
}

async function safeFetch(fetchFn: FetchFn, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (err) {
    throw new ProviderError('network', err instanceof Error ? err.message : String(err));
  }
}

// ── Alpaca ──────────────────────────────────────────────────────────────────

const ALPACA_TF: Record<Timeframe, string> = { '5m': '5Min', '15m': '15Min', '1h': '1Hour', '1d': '1Day' };

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export class AlpacaDataProvider implements BarProvider {
  readonly name = 'alpaca' as const;

  constructor(
    private readonly creds: () => { keyId: string; secret: string } | null,
    private readonly fetchFn: FetchFn = fetch,
    private readonly base = 'https://data.alpaca.markets',
  ) {}

  private headers(): Record<string, string> {
    const c = this.creds();
    return c ? { 'APCA-API-KEY-ID': c.keyId, 'APCA-API-SECRET-KEY': c.secret, Accept: 'application/json' } : { Accept: 'application/json' };
  }

  async fetchBars(symbols: string[], timeframe: Timeframe, from: number, to: number): Promise<Map<string, Candle[]>> {
    const out = new Map<string, Candle[]>();
    const stocks = symbols.filter((s) => assetClassOf(s) === 'us_equity');
    const crypto = symbols.filter((s) => assetClassOf(s) === 'crypto');
    if (stocks.length) {
      if (!this.creds()) throw new ProviderError('auth', 'Alpaca stock data needs a market-data key');
      await this.page(`${this.base}/v2/stocks/bars`, stocks, timeframe, from, to, { feed: 'iex', adjustment: 'split' }, out);
    }
    if (crypto.length) await this.page(`${this.base}/v1beta3/crypto/us/bars`, crypto, timeframe, from, to, {}, out);
    return out;
  }

  private async page(
    url: string,
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
    extra: Record<string, string>,
    out: Map<string, Candle[]>,
  ): Promise<void> {
    let token: string | null = null;
    for (let page = 0; page < 200; page++) {
      const q = new URLSearchParams({
        symbols: symbols.join(','),
        timeframe: ALPACA_TF[timeframe],
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString(),
        limit: '10000',
        sort: 'asc',
        ...extra,
        ...(token ? { page_token: token } : {}),
      });
      const res = await safeFetch(this.fetchFn, `${url}?${q.toString()}`, { headers: this.headers() });
      const body = (await readJson(res, 'alpaca bars')) as { bars?: Record<string, AlpacaBar[]> | null; next_page_token?: string | null };
      for (const [sym, bars] of Object.entries(body.bars ?? {})) {
        const list = out.get(sym) ?? [];
        for (const b of bars ?? []) {
          const ts = Date.parse(b.t);
          list.push({ ts: timeframe === '1d' ? dailyTs(ts) : ts, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
        }
        out.set(sym, list);
      }
      token = body.next_page_token ?? null;
      if (!token) break;
    }
  }

  async latestTrades(symbols: string[]): Promise<Tick[]> {
    const stocks = symbols.filter((s) => assetClassOf(s) === 'us_equity');
    if (!stocks.length || !this.creds()) return [];
    const res = await safeFetch(this.fetchFn, `${this.base}/v2/stocks/trades/latest?symbols=${encodeURIComponent(stocks.join(','))}&feed=iex`, {
      headers: this.headers(),
    });
    const body = (await readJson(res, 'alpaca latest trades')) as { trades?: Record<string, { t: string; p: number; s: number }> };
    return Object.entries(body.trades ?? {}).map(([symbol, t]) => ({ symbol, ts: Date.parse(t.t), price: t.p, size: t.s }));
  }
}

// ── Yahoo ───────────────────────────────────────────────────────────────────

const YAHOO_INTERVAL: Record<Timeframe, string> = { '5m': '5m', '15m': '15m', '1h': '60m', '1d': '1d' };
/** Yahoo refuses intraday requests older than this. */
const YAHOO_MAX_LOOKBACK_MS: Record<Timeframe, number> = {
  '5m': 59 * 86_400_000,
  '15m': 59 * 86_400_000,
  '1h': 729 * 86_400_000,
  '1d': 50 * 365 * 86_400_000,
};

export function toYahooTicker(symbol: string): string {
  if (symbol.includes('/')) return symbol.replace('/', '-');
  return symbol.replace('.', '-');
}

interface YahooChart {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
    }> | null;
  };
}

export class YahooProvider implements BarProvider {
  readonly name = 'yahoo' as const;

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly base = 'https://query1.finance.yahoo.com',
    private readonly concurrency = 4,
  ) {}

  async fetchBars(symbols: string[], timeframe: Timeframe, from: number, to: number): Promise<Map<string, Candle[]>> {
    const out = new Map<string, Candle[]>();
    const earliest = to - YAHOO_MAX_LOOKBACK_MS[timeframe];
    const start = Math.max(from, earliest);
    const errors: string[] = [];
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < symbols.length) {
        const sym = symbols[i++]!;
        try {
          out.set(sym, await this.one(sym, timeframe, start, to));
        } catch (err) {
          if (err instanceof ProviderError && err.kind === 'rate_limited') throw err;
          errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, symbols.length) }, worker));
    if (errors.length && out.size === 0) throw new ProviderError('network', errors.join('; ').slice(0, 500));
    return out;
  }

  private async one(symbol: string, timeframe: Timeframe, from: number, to: number): Promise<Candle[]> {
    const q = new URLSearchParams({
      interval: YAHOO_INTERVAL[timeframe],
      period1: String(Math.floor(from / 1000)),
      period2: String(Math.ceil(to / 1000)),
      includePrePost: 'false',
    });
    const url = `${this.base}/v8/finance/chart/${encodeURIComponent(toYahooTicker(symbol))}?${q.toString()}`;
    const res = await safeFetch(this.fetchFn, url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    const body = (await readJson(res, `yahoo ${symbol}`)) as YahooChart;
    if (body.chart?.error) throw new ProviderError('not_found', body.chart.error.description ?? 'symbol not found');
    const r = body.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q0 = r?.indicators?.quote?.[0];
    const out: Candle[] = [];
    for (let k = 0; k < ts.length; k++) {
      const o = q0?.open?.[k];
      const h = q0?.high?.[k];
      const l = q0?.low?.[k];
      const c = q0?.close?.[k];
      if (o == null || h == null || l == null || c == null) continue;
      const t = ts[k]! * 1000;
      out.push({ ts: timeframe === '1d' ? dailyTs(t) : t, open: o, high: h, low: l, close: c, volume: q0?.volume?.[k] ?? 0 });
    }
    return out;
  }
}

/** Default fetch window for an incremental update: overlap two bars to catch revisions. */
export function incrementalFrom(lastTs: number | null, timeframe: Timeframe, now: number, backfillDays: number): number {
  if (lastTs === null) return now - backfillDays * 86_400_000;
  return lastTs - 2 * TIMEFRAME_MS[timeframe];
}
