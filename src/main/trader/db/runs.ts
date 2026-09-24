// Orchestrator cycles, backtest runs, strategies and the replay buffer.

import type { Database } from 'better-sqlite3';
import {
  strategyParamsSchema,
  type BacktestDto,
  type BacktestMetricsDto,
  type CycleDto,
  type NodeMessageDto,
  type StrategyDto,
  type StrategyParams,
  type TradingMode,
} from '@shared/trader/types';
import { num, parseJson, uid, type Row } from './util';

export class RunsRepo {
  constructor(private readonly db: Database) {}

  // ── cycles ───────────────────────────────────────────────────────────────

  createCycle(trigger: CycleDto['trigger'], mode: TradingMode, now: number): CycleDto {
    const id = uid();
    this.db
      .prepare("INSERT INTO trader_cycles (id, trigger, status, mode, started_at) VALUES (?, ?, 'running', ?, ?)")
      .run(id, trigger, mode, now);
    return this.cycle(id)!;
  }

  finishCycle(
    id: string,
    f: { status: CycleDto['status']; nodes: NodeMessageDto[]; abortReason?: string | null; skipReason?: string | null; llmCalls: number; signals: number; orders: number; now: number },
  ): void {
    this.db
      .prepare(
        `UPDATE trader_cycles SET status = ?, ended_at = ?, abort_reason = ?, skip_reason = ?, nodes = ?, llm_calls = ?, signals = ?, orders = ?
         WHERE id = ?`,
      )
      .run(f.status, f.now, f.abortReason ?? null, f.skipReason ?? null, JSON.stringify(f.nodes), f.llmCalls, f.signals, f.orders, id);
  }

  cycle(id: string): CycleDto | null {
    const r = this.db.prepare('SELECT * FROM trader_cycles WHERE id = ?').get(id) as Row | undefined;
    return r ? mapCycle(r) : null;
  }

  cycles(limit = 50, opts: { excludeSkipped?: boolean } = {}): CycleDto[] {
    const sql = opts.excludeSkipped
      ? "SELECT * FROM trader_cycles WHERE status != 'skipped' ORDER BY started_at DESC LIMIT ?"
      : 'SELECT * FROM trader_cycles ORDER BY started_at DESC LIMIT ?';
    return (this.db.prepare(sql).all(limit) as Row[]).map(mapCycle);
  }

  lastCycle(): CycleDto | null {
    const r = this.db.prepare('SELECT * FROM trader_cycles ORDER BY started_at DESC LIMIT 1').get() as Row | undefined;
    return r ? mapCycle(r) : null;
  }

  /** Crash recovery: a cycle still 'running' at startup was interrupted. */
  recoverInterrupted(now: number): number {
    return this.db
      .prepare("UPDATE trader_cycles SET status = 'aborted', abort_reason = 'interrupted (app closed mid-cycle)', ended_at = ? WHERE status = 'running'")
      .run(now).changes;
  }

  pruneCycles(olderThan: number): void {
    this.db.prepare("DELETE FROM trader_cycles WHERE started_at < ? AND status = 'skipped'").run(olderThan);
  }

  // ── backtests ────────────────────────────────────────────────────────────

  createBacktest(kind: BacktestDto['kind'], label: string, config: Record<string, unknown>, now: number): BacktestDto {
    const id = uid();
    this.db
      .prepare("INSERT INTO trader_backtests (id, kind, label, status, config, created_at) VALUES (?, ?, ?, 'running', ?, ?)")
      .run(id, kind, label.slice(0, 200), JSON.stringify(config), now);
    return this.backtest(id)!;
  }

  finishBacktest(id: string, f: { metrics: BacktestMetricsDto; reportPath: string | null; equityPath: string | null; now: number }): void {
    this.db
      .prepare("UPDATE trader_backtests SET status = 'done', metrics = ?, report_path = ?, equity_path = ?, finished_at = ? WHERE id = ?")
      .run(JSON.stringify(f.metrics), f.reportPath, f.equityPath, f.now, id);
  }

  failBacktest(id: string, error: string, now: number): void {
    this.db.prepare("UPDATE trader_backtests SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error.slice(0, 2000), now, id);
  }

  backtest(id: string): (BacktestDto & { config: Record<string, unknown> }) | null {
    const r = this.db.prepare('SELECT * FROM trader_backtests WHERE id = ?').get(id) as Row | undefined;
    return r ? { ...mapBacktest(r), config: parseJson(r.config, {}) } : null;
  }

  backtests(limit = 50): BacktestDto[] {
    return (this.db.prepare('SELECT * FROM trader_backtests ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map(mapBacktest);
  }

  recoverBacktests(now: number): void {
    this.db.prepare("UPDATE trader_backtests SET status = 'failed', error = 'interrupted', finished_at = ? WHERE status = 'running'").run(now);
  }

  // ── strategies ───────────────────────────────────────────────────────────

  createStrategy(s: { name: string; description?: string; inspiration?: string; params?: unknown; legacy?: boolean; stats?: { wins: number; losses: number; totalPnl: number; lessons: string[]; status: 'active' | 'retired' } }, now: number): StrategyDto {
    const id = uid();
    const params = strategyParamsSchema.parse(s.params ?? {});
    this.db
      .prepare(
        `INSERT INTO trader_strategies (id, name, description, inspiration, params, status, wins, losses, total_pnl, lessons, legacy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        s.name.slice(0, 120),
        (s.description ?? '').slice(0, 2000),
        (s.inspiration ?? '').slice(0, 2000),
        JSON.stringify(params),
        s.stats?.status ?? 'active',
        s.stats?.wins ?? 0,
        s.stats?.losses ?? 0,
        s.stats?.totalPnl ?? 0,
        JSON.stringify(s.stats?.lessons ?? []),
        s.legacy ? 1 : 0,
        now,
        now,
      );
    return this.strategy(id)!;
  }

  strategy(id: string): StrategyDto | null {
    const r = this.db.prepare('SELECT * FROM trader_strategies WHERE id = ?').get(id) as Row | undefined;
    return r ? mapStrategy(r) : null;
  }

  strategies(status?: StrategyDto['status']): StrategyDto[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM trader_strategies WHERE status = ? ORDER BY created_at').all(status)
      : this.db.prepare('SELECT * FROM trader_strategies ORDER BY created_at').all();
    return (rows as Row[]).map(mapStrategy);
  }

  updateStrategy(id: string, patch: { name?: string; description?: string; inspiration?: string; params?: StrategyParams; status?: StrategyDto['status'] }, now: number): StrategyDto | null {
    const s = this.strategy(id);
    if (!s) return null;
    this.db
      .prepare('UPDATE trader_strategies SET name = ?, description = ?, inspiration = ?, params = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(
        (patch.name ?? s.name).slice(0, 120),
        (patch.description ?? s.description).slice(0, 2000),
        (patch.inspiration ?? s.inspiration).slice(0, 2000),
        JSON.stringify(patch.params ?? s.params),
        patch.status ?? s.status,
        now,
        id,
      );
    return this.strategy(id);
  }

  recordStrategyResult(id: string, outcome: 'win' | 'loss' | 'flat', pnl: number, lesson: string | null, now: number): StrategyDto | null {
    const s = this.strategy(id);
    if (!s) return null;
    const lessons = lesson ? [...s.lessons.slice(-49), lesson] : s.lessons;
    this.db
      .prepare('UPDATE trader_strategies SET wins = wins + ?, losses = losses + ?, total_pnl = total_pnl + ?, lessons = ?, updated_at = ? WHERE id = ?')
      .run(outcome === 'win' ? 1 : 0, outcome === 'loss' ? 1 : 0, pnl, JSON.stringify(lessons), now, id);
    return this.strategy(id);
  }

  // ── replay buffer ────────────────────────────────────────────────────────

  addReplay(r: { tradeId: string; modelVersion: string | null; timeframe: string | null; symbol: string; features: Record<string, number | string | null>; label: 0 | 1; pnl: number }, now: number): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO trader_replay (id, trade_id, model_version, timeframe, symbol, features, label, pnl, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(uid(), r.tradeId, r.modelVersion, r.timeframe, r.symbol, JSON.stringify(r.features), r.label, r.pnl, now);
  }

  replay(opts: { timeframe?: string; since?: number } = {}): Array<{ symbol: string; features: Record<string, number>; label: 0 | 1; pnl: number; createdAt: number }> {
    const rows = this.db
      .prepare(
        `SELECT symbol, features, label, pnl, created_at FROM trader_replay WHERE (? IS NULL OR timeframe = ?) AND created_at >= ? ORDER BY created_at`,
      )
      .all(opts.timeframe ?? null, opts.timeframe ?? null, opts.since ?? 0) as Row[];
    return rows.map((r) => ({ symbol: r.symbol, features: parseJson(r.features, {}), label: r.label === 1 ? 1 : 0, pnl: num(r.pnl), createdAt: r.created_at }));
  }

  replayCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM trader_replay').get() as { n: number }).n;
  }
}

function mapCycle(r: Row): CycleDto {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    mode: r.mode,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    abortReason: r.abort_reason ?? null,
    skipReason: r.skip_reason ?? null,
    nodes: parseJson(r.nodes, []),
    llmCalls: num(r.llm_calls),
    signals: num(r.signals),
    orders: num(r.orders),
  };
}

function mapBacktest(r: Row): BacktestDto {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    status: r.status,
    metrics: parseJson(r.metrics, null),
    error: r.error ?? null,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? null,
    reportPath: r.report_path ?? null,
    equityPath: r.equity_path ?? null,
  };
}

function mapStrategy(r: Row): StrategyDto {
  const parsed = strategyParamsSchema.safeParse(parseJson(r.params, {}));
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    inspiration: r.inspiration,
    status: r.status === 'retired' ? 'retired' : 'active',
    params: parsed.success ? parsed.data : strategyParamsSchema.parse({}),
    wins: num(r.wins),
    losses: num(r.losses),
    totalPnl: num(r.total_pnl),
    lessons: parseJson(r.lessons, []),
    legacy: r.legacy === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
