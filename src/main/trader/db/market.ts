// Market data repo: canonical bars, latest ticks, validation issues and the
// latest feature snapshot per symbol/timeframe.

import type { Database } from 'better-sqlite3';
import type { DataCoverageDto, DataIssueDto, Timeframe } from '@shared/trader/types';
import type { Candle, DataIssue, Tick } from '../data/types';
import { num, parseJson, uid, type Row } from './util';

export interface FeatureRow {
  symbol: string;
  timeframe: Timeframe;
  updated: number;
  barTs: number;
  regime: string;
  modelReady: boolean;
  features: Record<string, number>;
}

export class MarketRepo {
  constructor(private readonly db: Database) {}

  /** Upsert closed bars. Providers may revise a bar; latest write wins. */
  upsertBars(symbol: string, timeframe: Timeframe, candles: Candle[], source: string): number {
    if (!candles.length) return 0;
    const stmt = this.db.prepare(
      `INSERT INTO trader_bars (symbol, timeframe, ts, open, high, low, close, volume, adj_close, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(symbol, timeframe, ts) DO UPDATE SET
         open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
         volume = excluded.volume, source = excluded.source`,
    );
    let n = 0;
    this.db.transaction(() => {
      for (const c of candles) {
        stmt.run(symbol, timeframe, c.ts, c.open, c.high, c.low, c.close, c.volume, source);
        n += 1;
      }
    })();
    return n;
  }

  bars(symbol: string, timeframe: Timeframe, opts: { from?: number; to?: number; limit?: number } = {}): Candle[] {
    const where = ['symbol = ?', 'timeframe = ?'];
    const args: unknown[] = [symbol, timeframe];
    if (opts.from !== undefined) {
      where.push('ts >= ?');
      args.push(opts.from);
    }
    if (opts.to !== undefined) {
      where.push('ts <= ?');
      args.push(opts.to);
    }
    if (opts.limit !== undefined) {
      // newest N, returned ascending
      const rows = this.db
        .prepare(`SELECT ts, open, high, low, close, volume FROM trader_bars WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`)
        .all(...args, opts.limit) as Candle[];
      return rows.reverse();
    }
    return this.db
      .prepare(`SELECT ts, open, high, low, close, volume FROM trader_bars WHERE ${where.join(' AND ')} ORDER BY ts`)
      .all(...args) as Candle[];
  }

  lastTs(symbol: string, timeframe: Timeframe): number | null {
    const r = this.db
      .prepare('SELECT MAX(ts) AS ts FROM trader_bars WHERE symbol = ? AND timeframe = ?')
      .get(symbol, timeframe) as { ts: number | null };
    return r.ts ?? null;
  }

  coverage(now: number, staleAfter: (tf: Timeframe) => number): DataCoverageDto[] {
    const rows = this.db
      .prepare(
        `SELECT symbol, timeframe, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last
         FROM trader_bars GROUP BY symbol, timeframe ORDER BY symbol, timeframe`,
      )
      .all() as Row[];
    const issueCounts = new Map<string, number>();
    for (const r of this.db
      .prepare('SELECT symbol, timeframe, COUNT(*) AS n FROM trader_data_issues WHERE created_at >= ? GROUP BY symbol, timeframe')
      .all(now - 7 * 86_400_000) as Row[]) {
      issueCounts.set(`${r.symbol}|${r.timeframe}`, r.n as number);
    }
    return rows.map((r) => {
      const tf = r.timeframe as Timeframe;
      const staleMs = r.last === null ? null : Math.max(0, now - (r.last as number));
      return {
        symbol: r.symbol as string,
        timeframe: tf,
        bars: r.n as number,
        firstTs: (r.first as number) ?? null,
        lastTs: (r.last as number) ?? null,
        staleMs,
        stale: staleMs !== null && staleMs > staleAfter(tf),
        issues: issueCounts.get(`${r.symbol}|${tf}`) ?? 0,
      };
    });
  }

  pruneBars(timeframe: Timeframe, olderThan: number): number {
    return this.db.prepare('DELETE FROM trader_bars WHERE timeframe = ? AND ts < ?').run(timeframe, olderThan).changes;
  }

  insertTick(t: Tick, source: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO trader_ticks (symbol, ts, price, size, source) VALUES (?, ?, ?, ?, ?)')
      .run(t.symbol, t.ts, t.price, t.size, source);
    this.db.prepare('DELETE FROM trader_ticks WHERE symbol = ? AND ts < ?').run(t.symbol, t.ts - 86_400_000);
  }

  latestTick(symbol: string): Tick | null {
    const r = this.db.prepare('SELECT symbol, ts, price, size FROM trader_ticks WHERE symbol = ? ORDER BY ts DESC LIMIT 1').get(symbol) as
      | Tick
      | undefined;
    return r ?? null;
  }

  addIssues(issues: DataIssue[], now: number): void {
    if (!issues.length) return;
    const stmt = this.db.prepare(
      'INSERT INTO trader_data_issues (id, symbol, timeframe, ts, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      for (const i of issues) stmt.run(uid(), i.symbol, i.timeframe, i.ts, i.kind, i.detail.slice(0, 500), now);
    })();
  }

  issues(limit = 200): DataIssueDto[] {
    return (this.db.prepare('SELECT * FROM trader_data_issues ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      symbol: r.symbol,
      timeframe: r.timeframe,
      ts: r.ts ?? null,
      kind: r.kind,
      detail: r.detail,
      createdAt: r.created_at,
    }));
  }

  pruneIssues(olderThan: number): void {
    this.db.prepare('DELETE FROM trader_data_issues WHERE created_at < ?').run(olderThan);
  }

  upsertFeatures(row: FeatureRow): void {
    const f = row.features;
    this.db
      .prepare(
        `INSERT INTO trader_features_latest
           (symbol, timeframe, updated, bar_ts, rsi_14, atr_pct, macd, sma_20, roc_5, vol_zscore, regime, model_ready, features)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, timeframe) DO UPDATE SET
           updated = excluded.updated, bar_ts = excluded.bar_ts, rsi_14 = excluded.rsi_14, atr_pct = excluded.atr_pct,
           macd = excluded.macd, sma_20 = excluded.sma_20, roc_5 = excluded.roc_5, vol_zscore = excluded.vol_zscore,
           regime = excluded.regime, model_ready = excluded.model_ready, features = excluded.features`,
      )
      .run(
        row.symbol,
        row.timeframe,
        row.updated,
        row.barTs,
        f['rsi_14'] ?? null,
        f['atr_pct'] ?? null,
        f['macd'] ?? null,
        f['sma_20'] ?? null,
        f['roc_5'] ?? null,
        f['vol_z'] ?? null,
        row.regime,
        row.modelReady ? 1 : 0,
        JSON.stringify(f),
      );
  }

  features(symbol: string, timeframe: Timeframe): FeatureRow | null {
    const r = this.db.prepare('SELECT * FROM trader_features_latest WHERE symbol = ? AND timeframe = ?').get(symbol, timeframe) as Row | undefined;
    return r ? mapFeatures(r) : null;
  }

  allFeatures(timeframe?: Timeframe): FeatureRow[] {
    const rows = timeframe
      ? this.db.prepare('SELECT * FROM trader_features_latest WHERE timeframe = ? ORDER BY symbol').all(timeframe)
      : this.db.prepare('SELECT * FROM trader_features_latest ORDER BY symbol, timeframe').all();
    return (rows as Row[]).map(mapFeatures);
  }
}

function mapFeatures(r: Row): FeatureRow {
  return {
    symbol: r.symbol,
    timeframe: r.timeframe,
    updated: num(r.updated),
    barTs: num(r.bar_ts),
    regime: r.regime ?? 'unknown',
    modelReady: r.model_ready === 1,
    features: parseJson<Record<string, number>>(r.features, {}),
  };
}
