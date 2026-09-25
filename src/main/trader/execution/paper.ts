// PaperBroker — Simulation Mode's "broker". Virtual cash + positions persisted
// in SQLite; working orders fill against incoming bars through the same fill
// simulator as the event-driven backtester (next-bar open, slippage,
// commission, participation cap, latency). It never touches the network.
// Used for the paper account (default) and the shadow mirror of live trading.

import type { AccountKind, OrderSide, OrderStatus, Timeframe, TraderConfig } from '@shared/trader/types';
import { TIMEFRAME_MS } from '@shared/trader/types';
import type { TraderDb } from '../db';
import { commission as commissionFor, costModel, fillOnBar, slip } from '../backtest/fills';
import {
  BrokerError,
  type BrokerAccount,
  type BrokerAdapter,
  type BrokerClock,
  type BrokerFill,
  type BrokerOrderRequest,
  type BrokerOrderState,
  type BrokerPosition,
} from './types';

interface SimOrderState {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: 'market' | 'limit';
  qty: number;
  limitPrice: number | null;
  filledQty: number;
  avgFillPrice: number | null;
  status: OrderStatus;
  /** First bar (by open time) eligible to fill. */
  activeFrom: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  fills: BrokerFill[];
}

export interface PaperBrokerDeps {
  account: Extract<AccountKind, 'paper' | 'shadow'>;
  db: TraderDb;
  config: () => TraderConfig;
  now: () => number;
  /** Bars of this timeframe drive fills (the smallest enabled model timeframe). */
  execTimeframe: () => Timeframe;
}

export class PaperBroker implements BrokerAdapter {
  readonly name = 'simulator';
  readonly account: Extract<AccountKind, 'paper' | 'shadow'>;

  constructor(private readonly deps: PaperBrokerDeps) {
    this.account = deps.account;
  }

  managesExits(): boolean {
    return false; // the OMS runs stops/take-profits against bars
  }

  private key(clientOrderId: string): string {
    return `sim:${this.account}:order:${clientOrderId}`;
  }

  private cash(): number {
    return this.deps.db.oms.simAccount(this.account, this.deps.config().execution.paperStartingCash, this.deps.now()).cash;
  }

  /** Latest price: newest tick if fresher than the newest bar close. */
  lastPrice(symbol: string): number | null {
    const tf = this.deps.execTimeframe();
    const bar = this.deps.db.market.bars(symbol, tf, { limit: 1 })[0];
    const tick = this.deps.db.market.latestTick(symbol);
    if (tick && (!bar || tick.ts > bar.ts + TIMEFRAME_MS[tf])) return tick.price;
    if (bar) return bar.close;
    const any = this.deps.db.market.bars(symbol, '1d', { limit: 1 })[0];
    return any?.close ?? null;
  }

  async getAccount(): Promise<BrokerAccount> {
    const cash = this.cash();
    let equity = cash;
    for (const p of this.deps.db.oms.positions(this.account)) equity += p.qty * (this.lastPrice(p.symbol) ?? p.lastPrice);
    return { equity, cash, buyingPower: Math.max(0, cash), status: 'ACTIVE', tradingBlocked: false };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const now = this.deps.now();
    return this.deps.db.oms.positions(this.account).map((p) => {
      const last = this.lastPrice(p.symbol) ?? p.lastPrice;
      if (last !== p.lastPrice) this.deps.db.oms.markPrice(this.account, p.symbol, last, now);
      return { symbol: p.symbol, qty: p.qty, avgPrice: p.avgPrice, lastPrice: last };
    });
  }

  async getClock(): Promise<BrokerClock | null> {
    return null; // calendar decides
  }

  async placeOrder(req: BrokerOrderRequest): Promise<BrokerOrderState> {
    const now = this.deps.now();
    const existing = this.load(req.clientOrderId);
    if (existing) return this.toState(existing); // idempotent resubmit
    if (!(req.qty > 0)) throw new BrokerError('rejected', 'quantity must be positive');
    const held = this.deps.db.oms.position(this.account, req.symbol)?.qty ?? 0;
    const opensShort = req.side === 'sell' && held - req.qty < -1e-9;
    if (opensShort && !this.deps.config().risk.allowShort) throw new BrokerError('rejected', 'short selling is disabled');
    const ref = req.simFillPrice ?? req.limitPrice ?? this.lastPrice(req.symbol);
    if (req.side === 'buy' && held >= 0 && ref !== null && req.qty * ref > this.cash() * 1.0001) {
      throw new BrokerError('insufficient_funds', `needs ${(req.qty * ref).toFixed(2)}, cash ${this.cash().toFixed(2)}`);
    }
    const tf = TIMEFRAME_MS[this.deps.execTimeframe()];
    const latency = this.deps.config().execution.latencyBars;
    const o: SimOrderState = {
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      qty: req.qty,
      limitPrice: req.limitPrice,
      filledQty: 0,
      avgFillPrice: null,
      status: 'submitted',
      // The bar that opened at the decision bar's close (ticks run a few seconds
      // after it) is the first fillable one: the backtester's next-bar open.
      activeFrom: now - (this.deps.config().schedule.tickDelaySec * 1000 + 60_000) + latency * tf,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      fills: [],
    };
    if (req.simFillPrice !== undefined) {
      this.apply(o, req.qty, req.simFillPrice, now);
    }
    this.save(o);
    return this.toState(o);
  }

  /** Set/extend the expiry of a working order (OMS passes the signal's expiry). */
  setExpiry(clientOrderId: string, expiresAt: number | null): void {
    const o = this.load(clientOrderId);
    if (!o) return;
    o.expiresAt = expiresAt;
    this.save(o);
  }

  /** Work every open order against the bars that arrived since it was placed. */
  process(): number {
    const now = this.deps.now();
    const tf = this.deps.execTimeframe();
    const costs = costModel(this.deps.config().execution);
    let fills = 0;
    for (const { value: o } of this.deps.db.ops.listByPrefix<SimOrderState>(`sim:${this.account}:order:`)) {
      if (o.status !== 'submitted' && o.status !== 'partially_filled') continue;
      const bars = this.deps.db.market.bars(o.symbol, tf, { from: o.activeFrom });
      for (const bar of bars) {
        if (bar.ts > now) break;
        if (o.expiresAt !== null && bar.ts >= o.expiresAt) break; // expired before this bar opened
        const f = fillOnBar({ side: o.side, type: o.type, qty: o.qty, filledQty: o.filledQty, limitPrice: o.limitPrice, activeFrom: o.activeFrom }, bar, costs);
        if (!f) continue;
        this.apply(o, f.qty, f.price, bar.ts, f.commission);
        fills += 1;
        o.activeFrom = bar.ts + TIMEFRAME_MS[tf];
        if (o.filledQty >= o.qty - 1e-9) break;
      }
      if ((o.status === 'submitted' || o.status === 'partially_filled') && o.expiresAt !== null && now >= o.expiresAt) {
        o.status = o.filledQty > 0 ? 'filled' : 'expired';
        if (o.filledQty > 0) o.qty = o.filledQty; // the unfilled remainder lapses
      }
      o.updatedAt = now;
      this.save(o);
    }
    return fills;
  }

  private apply(o: SimOrderState, qty: number, price: number, ts: number, commission?: number): void {
    const now = this.deps.now();
    const comm = commission ?? commissionFor(qty, costModel(this.deps.config().execution));
    const dir = o.side === 'buy' ? 1 : -1;
    this.deps.db.oms.adjustCash(this.account, -dir * qty * price - comm, now);
    const pos = this.deps.db.oms.position(this.account, o.symbol);
    const oldQty = pos?.qty ?? 0;
    const newQty = oldQty + dir * qty;
    let avg = pos?.avgPrice ?? price;
    if (oldQty === 0 || Math.sign(oldQty) === dir) {
      avg = (Math.abs(oldQty) * (pos?.avgPrice ?? 0) + qty * price) / Math.abs(newQty || 1);
    } else if (Math.sign(newQty) !== Math.sign(oldQty) && Math.abs(newQty) > 1e-9) {
      avg = price; // flipped through zero
    }
    this.deps.db.oms.setPosition({
      account: this.account,
      symbol: o.symbol,
      qty: Math.abs(newQty) < 1e-9 ? 0 : newQty,
      avgPrice: avg,
      lastPrice: price,
      openedAt: pos?.openedAt ?? ts,
      updatedAt: now,
    });
    o.avgFillPrice = o.filledQty > 0 && o.avgFillPrice !== null ? (o.avgFillPrice * o.filledQty + price * qty) / (o.filledQty + qty) : price;
    o.filledQty += qty;
    o.fills.push({ id: `${o.clientOrderId}:${o.fills.length + 1}`, qty, price, ts });
    o.status = o.filledQty >= o.qty - 1e-9 ? 'filled' : 'partially_filled';
    o.updatedAt = now;
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrderState> {
    const o = this.load(brokerOrderId.replace(/^sim-/, ''));
    if (!o) throw new BrokerError('not_found', `unknown simulator order ${brokerOrderId}`);
    return this.toState(o);
  }

  async getOrderByClientId(clientOrderId: string): Promise<BrokerOrderState | null> {
    const o = this.load(clientOrderId);
    return o ? this.toState(o) : null;
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const o = this.load(brokerOrderId.replace(/^sim-/, ''));
    if (!o || (o.status !== 'submitted' && o.status !== 'partially_filled')) return;
    o.status = o.filledQty > 0 ? 'filled' : 'canceled';
    if (o.filledQty > 0) o.qty = o.filledQty;
    o.updatedAt = this.deps.now();
    this.save(o);
  }

  async cancelAll(): Promise<number> {
    let n = 0;
    for (const { value: o } of this.deps.db.ops.listByPrefix<SimOrderState>(`sim:${this.account}:order:`)) {
      if (o.status === 'submitted' || o.status === 'partially_filled') {
        await this.cancelOrder(`sim-${o.clientOrderId}`);
        n += 1;
      }
    }
    return n;
  }

  async fillsSince(since: number): Promise<Array<BrokerFill & { brokerOrderId: string; symbol: string; side: OrderSide }>> {
    const out: Array<BrokerFill & { brokerOrderId: string; symbol: string; side: OrderSide }> = [];
    for (const { value: o } of this.deps.db.ops.listByPrefix<SimOrderState>(`sim:${this.account}:order:`)) {
      for (const f of o.fills) if (f.ts >= since) out.push({ ...f, brokerOrderId: `sim-${o.clientOrderId}`, symbol: o.symbol, side: o.side });
    }
    return out;
  }

  /** Emergency liquidation price: last price with slippage against us. */
  flattenPrice(symbol: string, side: OrderSide): number | null {
    const last = this.lastPrice(symbol);
    return last === null ? null : slip(last, side, this.deps.config().execution.slippageBps);
  }

  /** Forget sim orders older than `olderThan` that are no longer working. */
  prune(olderThan: number): void {
    for (const { key, value: o } of this.deps.db.ops.listByPrefix<SimOrderState>(`sim:${this.account}:order:`)) {
      if (o.status !== 'submitted' && o.status !== 'partially_filled' && o.updatedAt < olderThan) this.deps.db.ops.delete(key);
    }
  }

  private load(clientOrderId: string): SimOrderState | null {
    const v = this.deps.db.ops.get<SimOrderState | null>(this.key(clientOrderId), null);
    return v && v.clientOrderId ? v : null;
  }

  private save(o: SimOrderState): void {
    this.deps.db.ops.set(this.key(o.clientOrderId), o, this.deps.now());
  }

  private toState(o: SimOrderState): BrokerOrderState {
    return {
      brokerOrderId: `sim-${o.clientOrderId}`,
      clientOrderId: o.clientOrderId,
      symbol: o.symbol,
      side: o.side,
      status: o.status,
      qty: o.qty,
      filledQty: o.filledQty,
      avgFillPrice: o.avgFillPrice,
      legs: [],
      submittedAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }
}
