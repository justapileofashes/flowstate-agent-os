// Data pipeline: fetch → normalize/validate → store (SQLite + lake) → report.
// Incremental by default (from the last stored bar, overlapping two bars so
// provider revisions land); backfills when a symbol has no history. Transient
// provider failures retry with exponential backoff; everything that goes
// wrong becomes a DataIssue so the monitor can alert on it.

import { assetClassOf, TIMEFRAME_MS, type Timeframe, type TraderConfig } from '@shared/trader/types';
import type { TraderDb } from '../db';
import type { DataIssue } from './types';
import { normalizeCandles } from './normalize';
import { incrementalFrom, isTransientProviderError, type BarProvider } from './providers';
import type { BarLake } from './lake';
import { barEnd, isMarketOpen, sessionFor } from './calendar';

export interface IngestResult {
  source: 'alpaca' | 'yahoo';
  timeframe: Timeframe;
  stored: number;
  lakeWritten: number;
  perSymbol: Record<string, { stored: number; lastTs: number | null }>;
  issues: DataIssue[];
  errors: string[];
  ms: number;
}

export interface PipelineDeps {
  db: TraderDb;
  alpaca: BarProvider;
  yahoo: BarProvider;
  lake: BarLake | null;
  config: () => TraderConfig;
  hasDataKey: () => boolean;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class DataPipeline {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: PipelineDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  source(): 'alpaca' | 'yahoo' {
    const s = this.deps.config().data.source;
    if (s === 'alpaca') return 'alpaca';
    if (s === 'yahoo') return 'yahoo';
    return this.deps.hasDataKey() ? 'alpaca' : 'yahoo';
  }

  private provider(): BarProvider {
    return this.source() === 'alpaca' ? this.deps.alpaca : this.deps.yahoo;
  }

  async ingest(input: { symbols: string[]; timeframe: Timeframe; from?: number; to?: number; days?: number }): Promise<IngestResult> {
    const started = this.deps.now();
    const cfg = this.deps.config();
    const { timeframe } = input;
    const now = this.deps.now();
    const to = input.to ?? now;
    const provider = this.provider();
    const result: IngestResult = {
      source: provider.name,
      timeframe,
      stored: 0,
      lakeWritten: 0,
      perSymbol: {},
      issues: [],
      errors: [],
      ms: 0,
    };
    if (!input.symbols.length) return result;

    // Group symbols by fetch start so one multi-symbol request covers most.
    const groups = new Map<number, string[]>();
    for (const sym of input.symbols) {
      const from =
        input.from ??
        (input.days !== undefined ? now - input.days * 86_400_000 : incrementalFrom(this.deps.db.market.lastTs(sym, timeframe), timeframe, now, cfg.data.backfillDays));
      const key = Math.floor(from / TIMEFRAME_MS[timeframe]) * TIMEFRAME_MS[timeframe];
      const list = groups.get(key) ?? [];
      list.push(sym);
      groups.set(key, list);
    }

    for (const [from, symbols] of groups) {
      let fetched: Map<string, import('./types').Candle[]> | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          fetched = await provider.fetchBars(symbols, timeframe, from, to);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < 3 && isTransientProviderError(err)) {
            await this.sleep(500 * 4 ** (attempt - 1));
            continue;
          }
          result.errors.push(`${provider.name} ${timeframe} [${symbols.join(',')}]: ${msg}`);
          for (const s of symbols) result.issues.push({ symbol: s, timeframe, ts: null, kind: 'fetch_failed', detail: msg.slice(0, 300) });
        }
      }
      if (!fetched) continue;
      for (const sym of symbols) {
        const raw = fetched.get(sym) ?? [];
        const { candles, issues } = normalizeCandles(raw, {
          symbol: sym,
          timeframe,
          now,
          closedOnly: true,
          sessionOnly: !cfg.schedule.extendedHours,
        });
        result.issues.push(...issues);
        const n = this.deps.db.market.upsertBars(sym, timeframe, candles, provider.name);
        result.stored += n;
        if (this.deps.lake && cfg.data.writeLake) {
          try {
            result.lakeWritten += this.deps.lake.append(sym, timeframe, candles);
          } catch (err) {
            result.errors.push(`lake ${sym}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        result.perSymbol[sym] = { stored: n, lastTs: this.deps.db.market.lastTs(sym, timeframe) };
      }
    }
    this.deps.db.market.addIssues(result.issues, now);
    result.ms = this.deps.now() - started;
    return result;
  }

  /** Latest trade prices (Alpaca only) for tighter paper fills / marks. */
  async ingestTicks(symbols: string[]): Promise<number> {
    if (this.source() !== 'alpaca' || !this.deps.alpaca.latestTrades) return 0;
    const ticks = await this.deps.alpaca.latestTrades(symbols);
    for (const t of ticks) if (t.price > 0) this.deps.db.market.insertTick(t, 'alpaca');
    return ticks.length;
  }

  /**
   * How long past due the next bar is (ms), or null when no bar is expected
   * (market closed / never ingested). > dataGapMs means stale: do not trade.
   */
  staleness(symbol: string, timeframe: Timeframe, now: number): number | null {
    const last = this.deps.db.market.lastTs(symbol, timeframe);
    if (last === null) return null;
    const assetClass = assetClassOf(symbol);
    const tf = TIMEFRAME_MS[timeframe];
    // The bar after `last` is expected to be complete at barEnd(last + tf).
    const nextStart = last + tf;
    if (assetClass === 'us_equity') {
      if (!isMarketOpen('us_equity', now)) return null;
      const s = sessionFor(now);
      if (!s) return null;
      // If the last bar is from a previous session, the first bar of today is expected at open + tf.
      const expectedStart = last < s.open ? s.open : nextStart;
      const due = barEnd(expectedStart, timeframe, assetClass);
      return Math.max(0, now - due);
    }
    return Math.max(0, now - barEnd(nextStart, timeframe, assetClass));
  }

  /** Retention: prune bars older than config retention per timeframe. */
  prune(now: number): number {
    const cfg = this.deps.config();
    let n = 0;
    for (const [tf, days] of Object.entries(cfg.data.retentionDays) as Array<[Timeframe, number]>) {
      n += this.deps.db.market.pruneBars(tf, now - days * 86_400_000);
    }
    this.deps.db.market.pruneIssues(now - 30 * 86_400_000);
    return n;
  }
}
