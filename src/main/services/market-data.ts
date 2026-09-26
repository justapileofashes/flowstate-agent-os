// Fetches daily OHLCV from Yahoo Finance's keyless chart API (the same
// provider the AI Trader ingests from) with a small disk cache. Stooq, the
// original source, now answers with an anti-bot page / HTTP 403. All IO is
// fetch + fs; the injectable cacheDir and fetch keep it testable.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Range, Quote } from '@shared/market-types';
import { RANGE_DAYS } from '@shared/market-types';
import { ProviderError, YahooProvider, type FetchFn } from '@main/trader/data/providers';

export type MarketErrorKind = 'unknown-symbol' | 'rate-limited' | 'network' | 'parse';

export class MarketDataError extends Error {
  constructor(
    public readonly kind: MarketErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

/** Bare US tickers get `.us`; symbols with a suffix, index (^) or forex/crypto pass through. */
export function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  if (s.startsWith('^')) return s;
  if (s.includes('.')) return s;
  if (/^[a-z]{6}$/.test(s)) return s; // forex like eurusd / crypto like btcusd
  return `${s}.us`;
}

const CRYPTO_BASES = new Set([
  'btc', 'eth', 'sol', 'xrp', 'ada', 'doge', 'ltc', 'bnb', 'dot', 'avax',
  'link', 'trx', 'bch', 'xlm', 'etc', 'atom', 'uni', 'shib', 'matic', 'ton',
]);

/**
 * Map a user-entered symbol to Yahoo's ticker syntax: `aapl`/`aapl.us` →
 * `AAPL`, `btcusd` → `BTC-USD`, `eurusd` → `EURUSD=X`, `brk.b` → `BRK-B`,
 * `sap.de` → `SAP.DE`, `^spx` → `^SPX`.
 */
export function toYahooSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  if (s.startsWith('^')) return s.toUpperCase();
  const pair = /^([a-z]{3,5})(usd|usdt|eur|gbp|jpy)$/.exec(s);
  if (pair && CRYPTO_BASES.has(pair[1]!)) return `${pair[1]}-${pair[2]}`.toUpperCase();
  if (/^[a-z]{6}$/.test(s)) return `${s.toUpperCase()}=X`;
  const bare = s.endsWith('.us') ? s.slice(0, -3) : s;
  // One-letter class suffixes (BRK.B) use a dash on Yahoo; exchange suffixes stay.
  return (/^[a-z]+\.[a-z]$/.test(bare) ? bare.replace('.', '-') : bare).toUpperCase();
}

const HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const QUOTE_TTL_MS = 5 * 60 * 1000; // 5m
const DAY_MS = 86_400_000;

interface CacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

export interface MarketDataOptions {
  cacheDir: string;
  fetchFn?: FetchFn;
}

export class MarketDataService {
  private readonly yahoo: YahooProvider;

  constructor(private readonly opts: MarketDataOptions) {
    mkdirSync(opts.cacheDir, { recursive: true });
    this.yahoo = new YahooProvider(opts.fetchFn ?? ((url, init) => fetch(url, init)));
  }

  async history(symbol: string, range: Range): Promise<Bar[]> {
    const sym = normalizeSymbol(symbol);
    const cacheFile = join(this.opts.cacheDir, `yahoo-${sym}-${range}.json`);
    const cached = this.readCache<Bar[]>(cacheFile, HISTORY_TTL_MS);
    if (cached) return cached;

    const ticker = toYahooSymbol(symbol);
    const to = Date.now();
    const days = RANGE_DAYS[range];
    const from = Number.isFinite(days) ? to - days * DAY_MS : 0;
    let candles;
    try {
      candles = (await this.yahoo.fetchBars([ticker], '1d', from, to)).get(ticker) ?? [];
    } catch (err) {
      throw toMarketError(err, symbol);
    }
    const bars: Bar[] = candles.map((c) => ({
      time: new Date(c.ts).toISOString().slice(0, 10),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    if (bars.length === 0) {
      throw new MarketDataError('unknown-symbol', `no data for ${symbol} (symbol not found or no history)`);
    }
    this.writeCache(cacheFile, bars);
    return bars;
  }

  async quote(symbol: string): Promise<Quote> {
    const sym = normalizeSymbol(symbol);
    const cacheFile = join(this.opts.cacheDir, `quote-${sym}.json`);
    const cached = this.readCache<Quote>(cacheFile, QUOTE_TTL_MS);
    if (cached) return cached;
    const bars = await this.history(symbol, '1m');
    const last = bars[bars.length - 1]!;
    const prev = bars[bars.length - 2] ?? last;
    const change = last.close - prev.close;
    const quote: Quote = {
      symbol: sym,
      price: last.close,
      change,
      changePct: prev.close === 0 ? 0 : (change / prev.close) * 100,
      asOf: new Date().toISOString(),
    };
    this.writeCache(cacheFile, quote);
    return quote;
  }

  private readCache<T>(file: string, ttl: number): T | null {
    if (!existsSync(file)) return null;
    try {
      const env = JSON.parse(readFileSync(file, 'utf8')) as CacheEnvelope<T>;
      if (Date.now() - env.fetchedAt > ttl) return null;
      return env.data;
    } catch {
      return null;
    }
  }

  private writeCache<T>(file: string, data: T): void {
    try {
      writeFileSync(
        file,
        JSON.stringify({ fetchedAt: Date.now(), data } satisfies CacheEnvelope<T>),
      );
    } catch {
      // cache write is best-effort
    }
  }
}

function toMarketError(err: unknown, symbol: string): MarketDataError {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof ProviderError && err.kind === 'rate_limited') {
    return new MarketDataError('rate-limited', 'market data provider rate-limited — try again in a minute');
  }
  if (/not found|no data/i.test(msg)) {
    return new MarketDataError('unknown-symbol', `unknown symbol ${symbol}`);
  }
  if (err instanceof ProviderError && err.kind === 'bad_response') return new MarketDataError('parse', msg);
  return new MarketDataError('network', msg);
}
