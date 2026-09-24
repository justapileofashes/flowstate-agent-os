// Signals emitted by the quant node (and agent/manual proposals).

import type { Database } from 'better-sqlite3';
import type { Side, SignalDto, SignalStatus, Timeframe } from '@shared/trader/types';
import { num, parseJson, uid, type Row } from './util';

export interface SignalInsert {
  cycleId: string | null;
  symbol: string;
  side: Side;
  timeframe: Timeframe | 'fused';
  entry: number;
  stop: number;
  takeProfit: number;
  size: number;
  confidence: number;
  edgePct: number;
  horizonMin: number;
  modelVersion: string | null;
  strategyId: string | null;
  source: 'model' | 'agent' | 'manual';
  status: SignalStatus;
  reason?: string | null;
  rationale?: string;
  perTimeframe: SignalDto['perTimeframe'];
  features: Record<string, number | string | null>;
  barTs: number | null;
  now: number;
}

export interface SignalRecord extends SignalDto {
  features: Record<string, number | string | null>;
  barTs: number | null;
}

export class SignalsRepo {
  constructor(private readonly db: Database) {}

  insert(s: SignalInsert): SignalRecord {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO trader_signals (id, cycle_id, symbol, side, timeframe, entry, stop, tp, size, confidence, edge_pct, horizon_min,
           model_version, strategy_id, source, status, reason, rationale, per_timeframe, features, bar_ts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        s.cycleId,
        s.symbol,
        s.side,
        s.timeframe,
        s.entry,
        s.stop,
        s.takeProfit,
        s.size,
        s.confidence,
        s.edgePct,
        s.horizonMin,
        s.modelVersion,
        s.strategyId,
        s.source,
        s.status,
        s.reason ?? null,
        s.rationale ?? '',
        JSON.stringify(s.perTimeframe),
        JSON.stringify(s.features),
        s.barTs,
        s.now,
        s.now,
      );
    return this.get(id)!;
  }

  get(id: string): SignalRecord | null {
    const r = this.db
      .prepare(
        `SELECT s.*, st.name AS strategy_name FROM trader_signals s LEFT JOIN trader_strategies st ON st.id = s.strategy_id WHERE s.id = ?`,
      )
      .get(id) as Row | undefined;
    return r ? map(r) : null;
  }

  update(
    id: string,
    patch: Partial<{ status: SignalStatus; reason: string | null; rationale: string; size: number; stop: number; takeProfit: number }>,
    now: number,
  ): void {
    const sets: string[] = ['updated_at = ?'];
    const args: unknown[] = [now];
    const cols: Record<string, string> = { status: 'status', reason: 'reason', rationale: 'rationale', size: 'size', stop: 'stop', takeProfit: 'tp' };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !cols[k]) continue;
      sets.push(`${cols[k]} = ?`);
      args.push(v);
    }
    this.db.prepare(`UPDATE trader_signals SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }

  /** Compare-and-set a status transition (prevents double execution). */
  transition(id: string, from: SignalStatus[], to: SignalStatus, now: number, reason?: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE trader_signals SET status = ?, reason = COALESCE(?, reason), updated_at = ?
         WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
      )
      .run(to, reason ?? null, now, id, ...from);
    return res.changes === 1;
  }

  list(opts: { since?: number; status?: SignalStatus[]; symbol?: string; limit?: number } = {}): SignalRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.since !== undefined) {
      where.push('s.created_at >= ?');
      args.push(opts.since);
    }
    if (opts.status?.length) {
      where.push(`s.status IN (${opts.status.map(() => '?').join(',')})`);
      args.push(...opts.status);
    }
    if (opts.symbol) {
      where.push('s.symbol = ?');
      args.push(opts.symbol);
    }
    const sql = `SELECT s.*, st.name AS strategy_name FROM trader_signals s LEFT JOIN trader_strategies st ON st.id = s.strategy_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, opts.limit ?? 200) as Row[]).map(map);
  }

  /** Confidence samples for drift detection. */
  confidences(from: number, to: number): number[] {
    return (
      this.db
        .prepare("SELECT confidence FROM trader_signals WHERE source = 'model' AND created_at >= ? AND created_at < ?")
        .all(from, to) as Array<{ confidence: number }>
    ).map((r) => r.confidence);
  }

  /** Already signalled this symbol on this bar? (idempotent ticks) */
  existsForBar(symbol: string, timeframe: string, barTs: number): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM trader_signals WHERE symbol = ? AND timeframe = ? AND bar_ts = ? LIMIT 1').get(symbol, timeframe, barTs),
    );
  }
}

function map(r: Row): SignalRecord {
  return {
    id: r.id,
    cycleId: r.cycle_id ?? null,
    symbol: r.symbol,
    side: r.side === 'short' ? 'short' : 'long',
    timeframe: r.timeframe,
    entry: num(r.entry),
    stop: num(r.stop),
    takeProfit: num(r.tp),
    size: num(r.size),
    confidence: num(r.confidence),
    edgePct: num(r.edge_pct),
    horizonMin: num(r.horizon_min),
    modelVersion: r.model_version ?? null,
    strategyId: r.strategy_id ?? null,
    strategyName: r.strategy_name ?? null,
    source: r.source,
    status: r.status,
    reason: r.reason ?? null,
    rationale: r.rationale ?? '',
    perTimeframe: parseJson(r.per_timeframe, []),
    features: parseJson(r.features, {}),
    barTs: r.bar_ts ?? null,
    createdAt: r.created_at,
  };
}
