// OMS persistence: orders (client_order_id = idempotency key), fills,
// positions, and the simulated accounts' cash.

import type { Database } from 'better-sqlite3';
import type { AccountKind, FillDto, OrderDto, OrderSide, OrderStatus } from '@shared/trader/types';
import { num, numOrNull, uid, type Row } from './util';

export interface OrderInsert {
  clientOrderId: string;
  account: AccountKind;
  signalId: string | null;
  tradeId: string | null;
  symbol: string;
  side: OrderSide;
  role: OrderDto['role'];
  type: OrderDto['type'];
  qty: number;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  assumedPrice: number | null;
  expiresAt: number | null;
  now: number;
}

export interface OrderRecord extends OrderDto {
  expiresAt: number | null;
}

export interface PositionRow {
  account: AccountKind;
  symbol: string;
  qty: number;
  avgPrice: number;
  lastPrice: number;
  openedAt: number;
  updatedAt: number;
}

const OPEN_STATUSES: OrderStatus[] = ['new', 'submitted', 'partially_filled'];

export class OmsRepo {
  constructor(private readonly db: Database) {}

  /** Insert, or return the existing order for this idempotency key. */
  insertOrder(o: OrderInsert): { order: OrderRecord; created: boolean } {
    const existing = this.byClientId(o.clientOrderId);
    if (existing) return { order: existing, created: false };
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO trader_orders (id, client_order_id, account, signal_id, trade_id, symbol, side, role, type, qty, limit_price,
           stop_loss, take_profit, assumed_price, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
      )
      .run(
        id,
        o.clientOrderId,
        o.account,
        o.signalId,
        o.tradeId,
        o.symbol,
        o.side,
        o.role,
        o.type,
        o.qty,
        o.limitPrice,
        o.stopLoss,
        o.takeProfit,
        o.assumedPrice,
        o.expiresAt,
        o.now,
        o.now,
      );
    return { order: this.getOrder(id)!, created: true };
  }

  getOrder(id: string): OrderRecord | null {
    const r = this.db.prepare('SELECT * FROM trader_orders WHERE id = ?').get(id) as Row | undefined;
    return r ? mapOrder(r) : null;
  }

  byClientId(clientOrderId: string): OrderRecord | null {
    const r = this.db.prepare('SELECT * FROM trader_orders WHERE client_order_id = ?').get(clientOrderId) as Row | undefined;
    return r ? mapOrder(r) : null;
  }

  updateOrder(
    id: string,
    patch: Partial<{ status: OrderStatus; filledQty: number; avgFillPrice: number | null; brokerOrderId: string | null; error: string | null; tradeId: string | null }>,
    now: number,
  ): void {
    const cols: Record<string, string> = {
      status: 'status',
      filledQty: 'filled_qty',
      avgFillPrice: 'avg_fill_price',
      brokerOrderId: 'broker_order_id',
      error: 'error',
      tradeId: 'trade_id',
    };
    const sets: string[] = ['updated_at = ?'];
    const args: unknown[] = [now];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !cols[k]) continue;
      sets.push(`${cols[k]} = ?`);
      args.push(v);
    }
    this.db.prepare(`UPDATE trader_orders SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }

  listOrders(opts: { account?: AccountKind; status?: OrderStatus[]; limit?: number; since?: number } = {}): OrderRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.account) {
      where.push('account = ?');
      args.push(opts.account);
    }
    if (opts.status?.length) {
      where.push(`status IN (${opts.status.map(() => '?').join(',')})`);
      args.push(...opts.status);
    }
    if (opts.since !== undefined) {
      where.push('created_at >= ?');
      args.push(opts.since);
    }
    const sql = `SELECT * FROM trader_orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, opts.limit ?? 200) as Row[]).map(mapOrder);
  }

  openOrders(account: AccountKind): OrderRecord[] {
    return this.listOrders({ account, status: OPEN_STATUSES, limit: 1000 });
  }

  ordersForSignal(signalId: string): OrderRecord[] {
    return (this.db.prepare('SELECT * FROM trader_orders WHERE signal_id = ? ORDER BY created_at').all(signalId) as Row[]).map(mapOrder);
  }

  /** Insert a fill once (dedupe on order + broker fill id). */
  insertFill(f: { orderId: string; symbol: string; side: OrderSide; qty: number; price: number; commission: number; ts: number; brokerId?: string | null }): boolean {
    const res = this.db
      .prepare(
        'INSERT OR IGNORE INTO trader_fills (id, order_id, symbol, side, qty, price, commission, ts, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(uid(), f.orderId, f.symbol, f.side, f.qty, f.price, f.commission, f.ts, f.brokerId ?? uid());
    return res.changes === 1;
  }

  fillsFor(orderIds: string[]): FillDto[] {
    if (!orderIds.length) return [];
    return (
      this.db.prepare(`SELECT * FROM trader_fills WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY ts`).all(...orderIds) as Row[]
    ).map(mapFill);
  }

  listFills(opts: { account?: AccountKind; limit?: number } = {}): FillDto[] {
    const rows = opts.account
      ? this.db
          .prepare('SELECT f.* FROM trader_fills f JOIN trader_orders o ON o.id = f.order_id WHERE o.account = ? ORDER BY f.ts DESC LIMIT ?')
          .all(opts.account, opts.limit ?? 200)
      : this.db.prepare('SELECT * FROM trader_fills ORDER BY ts DESC LIMIT ?').all(opts.limit ?? 200);
    return (rows as Row[]).map(mapFill);
  }

  fillStats(since: number): { orders: number; failed: number; filled: number } {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END) AS filled
         FROM trader_orders WHERE created_at >= ?`,
      )
      .get(since) as Row;
    return { orders: num(r.n), failed: num(r.failed), filled: num(r.filled) };
  }

  /** Most recent terminal orders, newest first (fill-failure streaks). */
  recentTerminal(limit: number): OrderRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM trader_orders WHERE status IN ('filled','failed','rejected','canceled','expired') ORDER BY updated_at DESC LIMIT ?")
        .all(limit) as Row[]
    ).map(mapOrder);
  }

  // ── positions ────────────────────────────────────────────────────────────

  position(account: AccountKind, symbol: string): PositionRow | null {
    const r = this.db.prepare('SELECT * FROM trader_positions WHERE account = ? AND symbol = ?').get(account, symbol) as Row | undefined;
    return r ? mapPosition(r) : null;
  }

  positions(account: AccountKind): PositionRow[] {
    return (this.db.prepare('SELECT * FROM trader_positions WHERE account = ? ORDER BY symbol').all(account) as Row[]).map(mapPosition);
  }

  setPosition(p: PositionRow): void {
    if (Math.abs(p.qty) < 1e-9) {
      this.db.prepare('DELETE FROM trader_positions WHERE account = ? AND symbol = ?').run(p.account, p.symbol);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO trader_positions (account, symbol, qty, avg_price, last_price, opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account, symbol) DO UPDATE SET qty = excluded.qty, avg_price = excluded.avg_price, last_price = excluded.last_price,
           updated_at = excluded.updated_at`,
      )
      .run(p.account, p.symbol, p.qty, p.avgPrice, p.lastPrice, p.openedAt, p.updatedAt);
  }

  /** Replace the cached broker positions for an account. */
  replacePositions(account: AccountKind, rows: PositionRow[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM trader_positions WHERE account = ?').run(account);
      for (const p of rows) this.setPosition(p);
    })();
  }

  markPrice(account: AccountKind, symbol: string, price: number, now: number): void {
    this.db.prepare('UPDATE trader_positions SET last_price = ?, updated_at = ? WHERE account = ? AND symbol = ?').run(price, now, account, symbol);
  }

  // ── simulated accounts ───────────────────────────────────────────────────

  simAccount(account: AccountKind, startingCash: number, now: number): { cash: number; startingCash: number } {
    const r = this.db.prepare('SELECT cash, starting_cash FROM trader_sim_accounts WHERE account = ?').get(account) as Row | undefined;
    if (r) return { cash: num(r.cash), startingCash: num(r.starting_cash) };
    this.db
      .prepare('INSERT INTO trader_sim_accounts (account, cash, starting_cash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(account, startingCash, startingCash, now, now);
    return { cash: startingCash, startingCash };
  }

  adjustCash(account: AccountKind, delta: number, now: number): void {
    this.db.prepare('UPDATE trader_sim_accounts SET cash = cash + ?, updated_at = ? WHERE account = ?').run(delta, now, account);
  }

  resetSimAccount(account: AccountKind, startingCash: number, now: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM trader_sim_accounts WHERE account = ?').run(account);
      this.db.prepare('DELETE FROM trader_positions WHERE account = ?').run(account);
      this.db
        .prepare('INSERT INTO trader_sim_accounts (account, cash, starting_cash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(account, startingCash, startingCash, now, now);
    })();
  }
}

function mapOrder(r: Row): OrderRecord {
  const avg = numOrNull(r.avg_fill_price);
  const assumed = numOrNull(r.assumed_price);
  let slippageBps: number | null = null;
  if (avg !== null && assumed !== null && assumed > 0) {
    const raw = ((avg - assumed) / assumed) * 10_000;
    slippageBps = Math.round((r.side === 'buy' ? raw : -raw) * 100) / 100; // + = worse than assumed
  }
  return {
    id: r.id,
    clientOrderId: r.client_order_id,
    account: r.account,
    signalId: r.signal_id ?? null,
    tradeId: r.trade_id ?? null,
    symbol: r.symbol,
    side: r.side === 'sell' ? 'sell' : 'buy',
    role: r.role,
    type: r.type,
    qty: num(r.qty),
    limitPrice: numOrNull(r.limit_price),
    stopLoss: numOrNull(r.stop_loss),
    takeProfit: numOrNull(r.take_profit),
    filledQty: num(r.filled_qty),
    avgFillPrice: avg,
    assumedPrice: assumed,
    slippageBps,
    brokerOrderId: r.broker_order_id ?? null,
    status: r.status,
    error: r.error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at ?? null,
  };
}

function mapFill(r: Row): FillDto {
  return {
    id: r.id,
    orderId: r.order_id,
    symbol: r.symbol,
    side: r.side === 'sell' ? 'sell' : 'buy',
    qty: num(r.qty),
    price: num(r.price),
    commission: num(r.commission),
    ts: r.ts,
  };
}

function mapPosition(r: Row): PositionRow {
  return {
    account: r.account,
    symbol: r.symbol,
    qty: num(r.qty),
    avgPrice: num(r.avg_price),
    lastPrice: num(r.last_price),
    openedAt: r.opened_at,
    updatedAt: r.updated_at,
  };
}
