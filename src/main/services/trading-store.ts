// SQLite-backed strategy library + trade journal (tables from 007_trading.sql).
// The journal is the trading engine's memory: every entry records why the
// trade was taken (rationale = factor snapshot + risk verdict), every close
// records the outcome and a post-mortem review. Strategy rows accumulate
// win/loss/pnl stats and distilled lessons so bad ideas get retired.
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';

export type StrategyStatus = 'active' | 'retired';

export interface StrategyParams {
  /** Minimum composite signal confidence to act. */
  minConfidence: number;
  /** Required trend regime ('any' disables the filter). */
  requireTrend: 'up' | 'down' | 'any';
  /** Per-factor minimum scores, e.g. { momentum: 0.1 }. */
  minFactorScores: Record<string, number>;
  /** R-multiple used for the take-profit leg. */
  takeProfitR: number;
  /** ATR multiple for the stoploss distance. */
  stopAtrMult: number;
}

export interface StrategyRow {
  id: string;
  name: string;
  description: string;
  /** Which traders/principles the strategy encodes (human-readable, cited). */
  inspiration: string;
  params: StrategyParams;
  status: StrategyStatus;
  wins: number;
  losses: number;
  totalPnl: number;
  lessons: string[];
  createdAt: number;
  updatedAt: number;
}

export type TradeStatus = 'open' | 'closed' | 'canceled';
export type TradeOutcome = 'win' | 'loss' | 'flat';

export interface TradeRow {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  entryPrice: number;
  stoploss: number;
  takeProfit: number;
  exitPrice: number | null;
  status: TradeStatus;
  outcome: TradeOutcome | null;
  pnl: number | null;
  strategyId: string | null;
  /** JSON: factor snapshot + risk verdict at entry. */
  rationale: string;
  /** Post-mortem written by the learning loop at close. */
  review: string | null;
  alpacaOrderId: string | null;
  paper: boolean;
  openedAt: number;
  closedAt: number | null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_PARAMS: StrategyParams = {
  minConfidence: 0.6,
  requireTrend: 'any',
  minFactorScores: {},
  takeProfitR: 2,
  stopAtrMult: 1.5,
};

export function sanitizeStrategyParams(raw: unknown): StrategyParams {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number, lo: number, hi: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fb;
    return Math.min(hi, Math.max(lo, n));
  };
  const scores: Record<string, number> = {};
  if (o.minFactorScores && typeof o.minFactorScores === 'object') {
    for (const [k, v] of Object.entries(o.minFactorScores as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) scores[k.slice(0, 30)] = Math.min(1, Math.max(-1, v));
    }
  }
  const trend = o.requireTrend === 'up' || o.requireTrend === 'down' ? o.requireTrend : 'any';
  return {
    minConfidence: num(o.minConfidence, DEFAULT_PARAMS.minConfidence, 0, 0.95),
    requireTrend: trend,
    minFactorScores: scores,
    takeProfitR: num(o.takeProfitR, DEFAULT_PARAMS.takeProfitR, 0.5, 10),
    stopAtrMult: num(o.stopAtrMult, DEFAULT_PARAMS.stopAtrMult, 0.5, 5),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapStrategy(r: any): StrategyRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    inspiration: r.inspiration,
    params: sanitizeStrategyParams(parseJson(r.params, {})),
    status: r.status === 'retired' ? 'retired' : 'active',
    wins: r.wins,
    losses: r.losses,
    totalPnl: r.total_pnl,
    lessons: parseJson<string[]>(r.lessons, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTrade(r: any): TradeRow {
  return {
    id: r.id,
    symbol: r.symbol,
    side: r.side === 'sell' ? 'sell' : 'buy',
    qty: r.qty,
    entryPrice: r.entry_price,
    stoploss: r.stoploss,
    takeProfit: r.take_profit,
    exitPrice: r.exit_price,
    status: r.status,
    outcome: r.outcome,
    pnl: r.pnl,
    strategyId: r.strategy_id,
    rationale: r.rationale,
    review: r.review,
    alpacaOrderId: r.alpaca_order_id,
    paper: r.paper === 1,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class TradingStore {
  constructor(private readonly db: Database) {}

  // ── Strategies ────────────────────────────────────────────────────────────

  createStrategy(input: {
    name: string;
    description?: string;
    inspiration?: string;
    params?: unknown;
  }): StrategyRow {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      name: input.name.slice(0, 120),
      description: (input.description ?? '').slice(0, 2000),
      inspiration: (input.inspiration ?? '').slice(0, 2000),
      params: JSON.stringify(sanitizeStrategyParams(input.params)),
    };
    this.db
      .prepare(
        `INSERT INTO strategies (id, name, description, inspiration, params, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(row.id, row.name, row.description, row.inspiration, row.params, now, now);
    return this.getStrategy(row.id)!;
  }

  getStrategy(id: string): StrategyRow | null {
    const r = this.db.prepare('SELECT * FROM strategies WHERE id = ?').get(id);
    return r ? mapStrategy(r) : null;
  }

  listStrategies(status?: StrategyStatus): StrategyRow[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM strategies WHERE status = ? ORDER BY created_at').all(status)
      : this.db.prepare('SELECT * FROM strategies ORDER BY created_at').all();
    return rows.map(mapStrategy);
  }

  setStrategyStatus(id: string, status: StrategyStatus): void {
    this.db
      .prepare('UPDATE strategies SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
  }

  updateStrategyParams(id: string, params: unknown): void {
    this.db
      .prepare('UPDATE strategies SET params = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(sanitizeStrategyParams(params)), Date.now(), id);
  }

  /** Record a closed trade's result against its strategy + append a lesson. */
  recordStrategyResult(id: string, outcome: TradeOutcome, pnl: number, lesson?: string): void {
    const s = this.getStrategy(id);
    if (!s) return;
    const lessons = lesson ? [...s.lessons.slice(-49), lesson] : s.lessons;
    this.db
      .prepare(
        `UPDATE strategies SET wins = wins + ?, losses = losses + ?, total_pnl = total_pnl + ?,
         lessons = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        outcome === 'win' ? 1 : 0,
        outcome === 'loss' ? 1 : 0,
        pnl,
        JSON.stringify(lessons),
        Date.now(),
        id,
      );
  }

  // ── Trades ────────────────────────────────────────────────────────────────

  openTrade(input: {
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    entryPrice: number;
    stoploss: number;
    takeProfit: number;
    strategyId?: string;
    rationale: string;
    alpacaOrderId?: string;
    paper: boolean;
  }): TradeRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO trades (id, symbol, side, qty, entry_price, stoploss, take_profit,
           status, strategy_id, rationale, alpaca_order_id, paper, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.symbol.toUpperCase(),
        input.side,
        input.qty,
        input.entryPrice,
        input.stoploss,
        input.takeProfit,
        input.strategyId ?? null,
        input.rationale.slice(0, 20_000),
        input.alpacaOrderId ?? null,
        input.paper ? 1 : 0,
        Date.now(),
      );
    return this.getTrade(id)!;
  }

  getTrade(id: string): TradeRow | null {
    const r = this.db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    return r ? mapTrade(r) : null;
  }

  openTrades(): TradeRow[] {
    return this.db
      .prepare("SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at")
      .all()
      .map(mapTrade);
  }

  listTrades(limit = 100): TradeRow[] {
    return this.db
      .prepare('SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?')
      .all(limit)
      .map(mapTrade);
  }

  closeTrade(id: string, exitPrice: number, review?: string): TradeRow | null {
    const t = this.getTrade(id);
    if (!t || t.status !== 'open') return null;
    const gross = (exitPrice - t.entryPrice) * t.qty * (t.side === 'buy' ? 1 : -1);
    const outcome: TradeOutcome = gross > 0 ? 'win' : gross < 0 ? 'loss' : 'flat';
    this.db
      .prepare(
        `UPDATE trades SET status = 'closed', exit_price = ?, pnl = ?, outcome = ?,
         review = COALESCE(?, review), closed_at = ? WHERE id = ?`,
      )
      .run(exitPrice, gross, outcome, review ?? null, Date.now(), id);
    return this.getTrade(id);
  }

  cancelTrade(id: string, review?: string): void {
    this.db
      .prepare(
        `UPDATE trades SET status = 'canceled', review = COALESCE(?, review), closed_at = ? WHERE id = ? AND status = 'open'`,
      )
      .run(review ?? null, Date.now(), id);
  }

  setTradeReview(id: string, review: string): void {
    this.db.prepare('UPDATE trades SET review = ? WHERE id = ?').run(review.slice(0, 10_000), id);
  }

  /** Stats the guardrails need: today's realized P&L, opens today, loss streak. */
  dayStats(now = Date.now()): { realizedPnlToday: number; tradesOpenedToday: number; consecutiveLosses: number } {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const start = dayStart.getTime();
    const pnlRow = this.db
      .prepare(
        "SELECT COALESCE(SUM(pnl), 0) AS pnl FROM trades WHERE status = 'closed' AND closed_at >= ?",
      )
      .get(start) as { pnl: number };
    const openedRow = this.db
      .prepare('SELECT COUNT(*) AS n FROM trades WHERE opened_at >= ?')
      .get(start) as { n: number };
    const recent = this.db
      .prepare(
        "SELECT outcome FROM trades WHERE status = 'closed' ORDER BY closed_at DESC, rowid DESC LIMIT 10",
      )
      .all() as Array<{ outcome: string | null }>;
    let streak = 0;
    for (const r of recent) {
      if (r.outcome === 'loss') streak++;
      else break;
    }
    return { realizedPnlToday: pnlRow.pnl, tradesOpenedToday: openedRow.n, consecutiveLosses: streak };
  }

  /** Distilled lessons from the most recent losing trades (for prompts + UI). */
  recentLessons(limit = 10): string[] {
    return (
      this.db
        .prepare(
          "SELECT review FROM trades WHERE outcome = 'loss' AND review IS NOT NULL ORDER BY closed_at DESC LIMIT ?",
        )
        .all(limit) as Array<{ review: string }>
    ).map((r) => r.review);
  }
}
