// Trades/PnL ledger + the per-proposal audit trail.

import type { Database } from 'better-sqlite3';
import type { AccountKind, AuditDto, NodeMessageDto, RiskDecisionDto, Side, Timeframe, TradeDto } from '@shared/trader/types';
import { num, numOrNull, parseJson, startOfDay, uid, type Row } from './util';

export interface TradeRecord extends TradeDto {
  timeframe: Timeframe | null;
  maxHoldUntil: number | null;
}

export class LedgerRepo {
  constructor(private readonly db: Database) {}

  openTrade(t: {
    signalId: string | null;
    account: AccountKind;
    symbol: string;
    side: Side;
    timeframe: Timeframe | null;
    qty: number;
    entryPrice: number;
    stop: number | null;
    takeProfit: number | null;
    fees: number;
    modelVersion: string | null;
    strategyId: string | null;
    maxHoldUntil: number | null;
    legacy?: boolean;
    now: number;
  }): TradeRecord {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO trader_trades (id, signal_id, account, symbol, side, timeframe, qty, entry_price, stop, tp, fees, status,
           model_version, strategy_id, max_hold_until, legacy, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        t.signalId,
        t.account,
        t.symbol,
        t.side,
        t.timeframe,
        t.qty,
        t.entryPrice,
        t.stop,
        t.takeProfit,
        t.fees,
        t.modelVersion,
        t.strategyId,
        t.maxHoldUntil,
        t.legacy ? 1 : 0,
        t.now,
      );
    return this.get(id)!;
  }

  /** Add to an open trade (partial fills of the entry). */
  scaleIn(id: string, addQty: number, price: number, fees: number): void {
    const t = this.get(id);
    if (!t || t.status !== 'open') return;
    const qty = t.qty + addQty;
    const avg = qty > 0 ? (t.entryPrice * t.qty + price * addQty) / qty : price;
    this.db.prepare('UPDATE trader_trades SET qty = ?, entry_price = ?, fees = fees + ? WHERE id = ?').run(qty, avg, fees, id);
  }

  closeTrade(id: string, c: { exitPrice: number; fees: number; reason: string; review?: string | null; now: number }): TradeRecord | null {
    const t = this.get(id);
    if (!t || t.status !== 'open') return null;
    const dir = t.side === 'long' ? 1 : -1;
    const gross = (c.exitPrice - t.entryPrice) * t.qty * dir;
    const fees = t.fees + c.fees;
    const pnl = gross - fees;
    const outcome = pnl > 1e-9 ? 'win' : pnl < -1e-9 ? 'loss' : 'flat';
    this.db
      .prepare(
        `UPDATE trader_trades SET status = 'closed', exit_price = ?, pnl = ?, fees = ?, outcome = ?, exit_reason = ?,
           review = COALESCE(?, review), closed_at = ? WHERE id = ? AND status = 'open'`,
      )
      .run(c.exitPrice, pnl, fees, outcome, c.reason, c.review ?? null, c.now, id);
    return this.get(id);
  }

  cancelTrade(id: string, reason: string, now: number): void {
    this.db
      .prepare("UPDATE trader_trades SET status = 'canceled', exit_reason = ?, closed_at = ? WHERE id = ? AND status = 'open'")
      .run(reason, now, id);
  }

  setReview(id: string, review: string): void {
    this.db.prepare('UPDATE trader_trades SET review = ? WHERE id = ?').run(review.slice(0, 4000), id);
  }

  get(id: string): TradeRecord | null {
    const r = this.db.prepare('SELECT * FROM trader_trades WHERE id = ?').get(id) as Row | undefined;
    return r ? mapTrade(r) : null;
  }

  bySignal(signalId: string, account?: AccountKind): TradeRecord | null {
    const r = (
      account
        ? this.db.prepare('SELECT * FROM trader_trades WHERE signal_id = ? AND account = ? ORDER BY opened_at DESC LIMIT 1').get(signalId, account)
        : this.db.prepare('SELECT * FROM trader_trades WHERE signal_id = ? ORDER BY opened_at DESC LIMIT 1').get(signalId)
    ) as Row | undefined;
    return r ? mapTrade(r) : null;
  }

  openTrades(account: AccountKind): TradeRecord[] {
    return (this.db.prepare("SELECT * FROM trader_trades WHERE account = ? AND status = 'open' ORDER BY opened_at").all(account) as Row[]).map(
      mapTrade,
    );
  }

  openTradeFor(account: AccountKind, symbol: string): TradeRecord | null {
    const r = this.db
      .prepare("SELECT * FROM trader_trades WHERE account = ? AND symbol = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(account, symbol) as Row | undefined;
    return r ? mapTrade(r) : null;
  }

  list(opts: { account?: AccountKind; status?: TradeDto['status']; limit?: number; since?: number } = {}): TradeRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.account) {
      where.push('account = ?');
      args.push(opts.account);
    }
    if (opts.status) {
      where.push('status = ?');
      args.push(opts.status);
    }
    if (opts.since !== undefined) {
      where.push('opened_at >= ?');
      args.push(opts.since);
    }
    const sql = `SELECT * FROM trader_trades ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY opened_at DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, opts.limit ?? 200) as Row[]).map(mapTrade);
  }

  /** Guardrail inputs: realized PnL today, trades opened today, loss streak. */
  dayStats(account: AccountKind, now: number): { realizedToday: number; openedToday: number; lossStreak: number } {
    const start = startOfDay(now);
    const pnl = this.db
      .prepare("SELECT COALESCE(SUM(pnl), 0) AS p FROM trader_trades WHERE account = ? AND status = 'closed' AND closed_at >= ? AND legacy = 0")
      .get(account, start) as { p: number };
    const opened = this.db
      .prepare('SELECT COUNT(*) AS n FROM trader_trades WHERE account = ? AND opened_at >= ? AND legacy = 0')
      .get(account, start) as { n: number };
    const recent = this.db
      .prepare("SELECT outcome FROM trader_trades WHERE account = ? AND status = 'closed' AND legacy = 0 ORDER BY closed_at DESC LIMIT 20")
      .all(account) as Array<{ outcome: string | null }>;
    let lossStreak = 0;
    for (const r of recent) {
      if (r.outcome === 'loss') lossStreak += 1;
      else break;
    }
    return { realizedToday: num(pnl.p), openedToday: num(opened.n), lossStreak };
  }

  closedStats(account: AccountKind): { closed: number; firstOpenedAt: number | null } {
    const r = this.db
      .prepare(
        "SELECT COUNT(*) AS n, (SELECT MIN(opened_at) FROM trader_trades WHERE account = ? AND legacy = 0) AS first FROM trader_trades WHERE account = ? AND status = 'closed' AND legacy = 0",
      )
      .get(account, account) as Row;
    return { closed: num(r.n), firstOpenedAt: r.first ?? null };
  }

  recentLessons(limit = 10): string[] {
    return (
      this.db
        .prepare("SELECT review FROM trader_trades WHERE outcome = 'loss' AND review IS NOT NULL ORDER BY closed_at DESC LIMIT ?")
        .all(limit) as Array<{ review: string }>
    ).map((r) => r.review);
  }

  // ── audit ────────────────────────────────────────────────────────────────

  insertAudit(a: {
    signalId: string | null;
    tradeId?: string | null;
    cycleId: string | null;
    features: Record<string, number | string | null>;
    modelVersion: string | null;
    modelHash: string | null;
    research: NodeMessageDto | null;
    quant: NodeMessageDto | null;
    risk: RiskDecisionDto | null;
    trader?: NodeMessageDto | null;
    orderIds?: string[];
    approvalTs: number | null;
    now: number;
  }): string {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO trader_audit (id, signal_id, trade_id, cycle_id, features, model_version, model_hash, research_txt, quant_txt,
           risk_decision, trader_txt, order_ids, approval_ts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        a.signalId,
        a.tradeId ?? null,
        a.cycleId,
        JSON.stringify(a.features),
        a.modelVersion,
        a.modelHash,
        a.research ? JSON.stringify(a.research) : null,
        a.quant ? JSON.stringify(a.quant) : null,
        a.risk ? JSON.stringify(a.risk) : null,
        a.trader ? JSON.stringify(a.trader) : null,
        JSON.stringify(a.orderIds ?? []),
        a.approvalTs,
        a.now,
      );
    return id;
  }

  updateAudit(id: string, patch: { tradeId?: string | null; trader?: NodeMessageDto | null; orderIds?: string[] }): void {
    if (patch.tradeId !== undefined) this.db.prepare('UPDATE trader_audit SET trade_id = ? WHERE id = ?').run(patch.tradeId, id);
    if (patch.trader !== undefined) this.db.prepare('UPDATE trader_audit SET trader_txt = ? WHERE id = ?').run(JSON.stringify(patch.trader), id);
    if (patch.orderIds !== undefined) this.db.prepare('UPDATE trader_audit SET order_ids = ? WHERE id = ?').run(JSON.stringify(patch.orderIds), id);
  }

  linkAuditTrade(signalId: string, tradeId: string): void {
    this.db.prepare('UPDATE trader_audit SET trade_id = ? WHERE signal_id = ? AND trade_id IS NULL').run(tradeId, signalId);
  }

  auditFor(ref: { signalId?: string; tradeId?: string; id?: string }): (Omit<AuditDto, 'fills'> & { rawOrderIds: string[] }) | null {
    let r: Row | undefined;
    if (ref.id) r = this.db.prepare('SELECT * FROM trader_audit WHERE id = ?').get(ref.id) as Row | undefined;
    else if (ref.signalId) r = this.db.prepare('SELECT * FROM trader_audit WHERE signal_id = ? ORDER BY created_at DESC LIMIT 1').get(ref.signalId) as Row | undefined;
    else if (ref.tradeId) r = this.db.prepare('SELECT * FROM trader_audit WHERE trade_id = ? ORDER BY created_at DESC LIMIT 1').get(ref.tradeId) as Row | undefined;
    if (!r) return null;
    const orderIds = parseJson<string[]>(r.order_ids, []);
    return {
      id: r.id,
      signalId: r.signal_id ?? null,
      tradeId: r.trade_id ?? null,
      cycleId: r.cycle_id ?? null,
      features: parseJson(r.features, {}),
      modelVersion: r.model_version ?? null,
      modelHash: r.model_hash ?? null,
      research: parseJson(r.research_txt, null),
      quant: parseJson(r.quant_txt, null),
      risk: parseJson(r.risk_decision, null),
      trader: parseJson(r.trader_txt, null),
      orderIds,
      rawOrderIds: orderIds,
      approvalTs: r.approval_ts ?? null,
      createdAt: r.created_at,
    };
  }

  rejectedCount(since: number): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM trader_audit WHERE created_at >= ? AND json_extract(risk_decision, '$.allowed') = 0")
        .get(since) as { n: number }
    ).n;
  }
}

function mapTrade(r: Row): TradeRecord {
  return {
    id: r.id,
    signalId: r.signal_id ?? null,
    account: r.account,
    symbol: r.symbol,
    side: r.side === 'short' ? 'short' : 'long',
    timeframe: r.timeframe ?? null,
    qty: num(r.qty),
    entryPrice: num(r.entry_price),
    exitPrice: numOrNull(r.exit_price),
    stop: numOrNull(r.stop),
    takeProfit: numOrNull(r.tp),
    pnl: numOrNull(r.pnl),
    fees: num(r.fees),
    status: r.status,
    outcome: r.outcome ?? null,
    exitReason: r.exit_reason ?? null,
    modelVersion: r.model_version ?? null,
    strategyId: r.strategy_id ?? null,
    review: r.review ?? null,
    legacy: r.legacy === 1,
    openedAt: r.opened_at,
    closedAt: r.closed_at ?? null,
    maxHoldUntil: r.max_hold_until ?? null,
  };
}
