// Fetches OHLCV from Stooq (CSV, no key) with a small disk cache. Optional
// Alpha Vantage path activates when an apiKey is provided. Pure-ish: all IO is
// fetch + fs; injectable cacheDir keeps it testable.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Range, Quote } from '@shared/market-types';
import { RANGE_DAYS } from '@shared/market-types';

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

const HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const QUOTE_TTL_MS = 5 * 60 * 1000; // 5m

interface CacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

export interface MarketDataOptions {
  cacheDir: string;
  alphaVantageKey?: string;
}

export class MarketDataService {
  constructor(private readonly opts: MarketDataOptions) {
    mkdirSync(opts.cacheDir, { recursive: true });
  }

  async history(symbol: string, range: Range): Promise<Bar[]> {
    const sym = normalizeSymbol(symbol);
    const cacheFile = join(this.opts.cacheDir, `stooq-${sym}-${range}.json`);
    const cached = this.readCache<Bar[]>(cacheFile, HISTORY_TTL_MS);
    if (cached) return cached;

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
    const text = await this.fetchText(url);
    const bars = this.parseStooqCsv(text);
    const sliced = this.sliceRange(bars, range);
    this.writeCache(cacheFile, sliced);
    return sliced;
  }

  async quote(symbol: string): Promise<Quote> {
    const sym = normalizeSymbol(symbol);
    const cacheFile = join(this.opts.cacheDir, `quote-${sym}.json`);
    const cached = this.readCache<Quote>(cacheFile, QUOTE_TTL_MS);
    if (cached) return cached;
    const bars = await this.history(symbol, '1m');
    if (bars.length < 1) throw new MarketDataError('unknown-symbol', `no data for ${symbol}`);
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

  private async fetchText(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'flowstate-stocks/0.1' } });
    } catch (err) {
      throw new MarketDataError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 429) throw new MarketDataError('rate-limited', 'provider rate-limited');
    if (!res.ok) throw new MarketDataError('network', `HTTP ${res.status}`);
    return res.text();
  }

  private parseStooqCsv(text: string): Bar[] {
    const trimmed = text.trim();
    if (!/^date,/i.test(trimmed)) {
      throw new MarketDataError('unknown-symbol', 'no data (symbol not found or no history)');
    }
    const lines = trimmed.split(/\r?\n/).slice(1);
    const bars: Bar[] = [];
    for (const line of lines) {
      const [date, open, high, low, close, volume] = line.split(',');
      if (!date || close === undefined) continue;
      const b: Bar = {
        time: date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume ?? 0),
      };
      if ([b.open, b.high, b.low, b.close].some((n) => Number.isNaN(n))) continue;
      bars.push(b);
    }
    if (bars.length === 0) throw new MarketDataError('parse', 'no parseable rows');
    return bars; // Stooq returns oldest->newest already
  }

  private sliceRange(bars: Bar[], range: Range): Bar[] {
    const days = RANGE_DAYS[range];
    if (!Number.isFinite(days)) return bars;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return bars.filter((b) => new Date(b.time).getTime() >= cutoff);
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
