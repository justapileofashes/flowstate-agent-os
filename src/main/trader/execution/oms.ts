// Order Management System. The only code that talks to a broker.
//  - Idempotent: client order id = hash(signal, account, role, seq). A retry,
//    a restarted app or a duplicate tick can never double-submit; on a
//    network error the OMS asks the broker for the client id before retrying.
//  - Router: market or limit (± offset) entries, bracket exits when the broker
//    supports them, exponential backoff on transient errors, fail fast on
//    rejections.
//  - Reconciliation: polls broker order state, turns fill deltas into fill
//    rows, opens/scales/closes ledger trades, runs software-managed exits
//    (simulator and crypto) and time exits, expires stale entries, and closes
//    ledger trades whose position vanished at the broker.
//  - Learning on close: post-mortem, strategy stats/retirement, replay buffer.

import { createHash } from 'node:crypto';
import {
  assetClassOf,
  TIMEFRAME_MS,
  type AccountKind,
  type OrderDto,
  type Timeframe,
  type TraderConfig,
} from '@shared/trader/types';
import type { TraderDb } from '../db';
import type { OrderRecord } from '../db/oms';
import type { TradeRecord } from '../db/ledger';
import { checkExits, costModel, slip } from '../backtest/fills';
import { PaperBroker } from './paper';
import { BrokerError, isTransientBrokerError, type ApprovedTrade, type BrokerAdapter, type BrokerOrderRequest, type BrokerOrderState } from './types';
import { validateApprovedTrade } from './validate';
import { shouldRetireStrategy, writePostMortem } from './learning';

export type OmsEvent =
  | { type: 'order'; order: OrderDto }
  | { type: 'trade_opened'; trade: TradeRecord }
  | { type: 'trade_closed'; trade: TradeRecord }
  | { type: 'strategy_retired'; name: string; detail: string }
  | { type: 'fill_failure'; order: OrderDto };

export interface OmsDeps {
  db: TraderDb;
  broker: (account: AccountKind) => BrokerAdapter | null;
  config: () => TraderConfig;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (e: OmsEvent) => void;
}

export interface ReconcileReport {
  account: AccountKind;
  fills: number;
  opened: number;
  closed: number;
  expired: number;
  errors: string[];
}

export function clientOrderId(signalId: string, account: AccountKind, role: string, seq = 0): string {
  return `fs-${createHash('sha256').update(`${signalId}|${account}|${role}|${seq}`).digest('hex').slice(0, 28)}`;
}

const OPEN: OrderDto['status'][] = ['new', 'submitted', 'partially_filled'];

export class Oms {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: OmsDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private emit(e: OmsEvent): void {
    try {
      this.deps.onEvent?.(e);
    } catch {
      // observers never break order flow
    }
  }

  private requireBroker(account: AccountKind): BrokerAdapter {
    const b = this.deps.broker(account);
    if (!b) throw new BrokerError('auth', `no broker connected for the ${account} account`);
    return b;
  }

  /** Submit with retries; idempotent on the client order id. */
  private async submit(broker: BrokerAdapter, req: BrokerOrderRequest): Promise<BrokerOrderState> {
    const max = this.deps.config().execution.maxRetries;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= max; attempt++) {
      if (attempt > 0) {
        // A timed-out request may have landed — never submit twice.
        const existing = await broker.getOrderByClientId(req.clientOrderId).catch(() => null);
        if (existing) return existing;
        await this.sleep(400 * 4 ** (attempt - 1));
      }
      try {
        return await broker.placeOrder(req);
      } catch (err) {
        lastErr = err;
        if (!isTransientBrokerError(err)) throw err; // rejections fail fast
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Trader node: validated, approved trade → entry order. */
  async submitEntry(t: ApprovedTrade, account: AccountKind): Promise<{ order: OrderRecord | null; created: boolean; error?: string }> {
    const now = this.deps.now();
    const v = validateApprovedTrade(t, now);
    if (!v.ok) return { order: null, created: false, error: `validation failed: ${v.error}` };
    const broker = this.requireBroker(account);
    const cfg = this.deps.config().execution;
    const buy = t.side === 'long';
    const limitPrice = cfg.orderType === 'limit' ? (buy ? t.entry * (1 + cfg.limitOffsetBps / 10_000) : t.entry * (1 - cfg.limitOffsetBps / 10_000)) : null;
    const { order, created } = this.deps.db.oms.insertOrder({
      clientOrderId: clientOrderId(t.signalId, account, 'entry'),
      account,
      signalId: t.signalId,
      tradeId: null,
      symbol: t.symbol,
      side: buy ? 'buy' : 'sell',
      role: 'entry',
      type: cfg.orderType,
      qty: t.qty,
      limitPrice,
      stopLoss: t.stop,
      takeProfit: t.takeProfit,
      assumedPrice: t.entry,
      expiresAt: t.expiresAt,
      now,
    });
    if (!created && order.status !== 'new') return { order, created: false };
    try {
      const state = await this.submit(broker, {
        clientOrderId: order.clientOrderId,
        symbol: t.symbol,
        side: order.side,
        type: cfg.orderType,
        qty: t.qty,
        limitPrice,
        timeInForce: 'day',
        bracket: broker.managesExits(t.symbol) ? { stopLoss: t.stop, takeProfit: t.takeProfit } : null,
      });
      if (broker instanceof PaperBroker) broker.setExpiry(order.clientOrderId, t.expiresAt);
      this.deps.db.oms.updateOrder(order.id, { brokerOrderId: state.brokerOrderId, status: state.status === 'new' ? 'submitted' : state.status }, this.deps.now());
      const fresh = this.deps.db.oms.getOrder(order.id)!;
      this.applyState(fresh, state);
      const final = this.deps.db.oms.getOrder(order.id)!;
      this.emit({ type: 'order', order: final });
      return { order: final, created: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err instanceof BrokerError && (err.kind === 'rejected' || err.kind === 'insufficient_funds') ? 'rejected' : 'failed';
      this.deps.db.oms.updateOrder(order.id, { status, error: msg.slice(0, 500) }, this.deps.now());
      const final = this.deps.db.oms.getOrder(order.id)!;
      this.emit({ type: 'order', order: final });
      this.emit({ type: 'fill_failure', order: final });
      return { order: final, created: true, error: msg };
    }
  }

  /** Exit (or emergency flatten) the whole position in a symbol. */
  async closePosition(
    account: AccountKind,
    symbol: string,
    reason: string,
    opts: { role?: 'exit' | 'flatten'; simFillPrice?: number; emergency?: boolean } = {},
  ): Promise<OrderRecord | null> {
    const broker = this.requireBroker(account);
    const positions = await broker.getPositions();
    const pos = positions.find((p) => p.symbol === symbol);
    if (!pos || Math.abs(pos.qty) < 1e-9) return null;
    const now = this.deps.now();
    // Cancel working orders on the symbol first (bracket legs, stale entries).
    for (const o of this.deps.db.oms.openOrders(account).filter((x) => x.symbol === symbol)) {
      if (o.brokerOrderId) await broker.cancelOrder(o.brokerOrderId).catch(() => undefined);
    }
    const trade = this.deps.db.ledger.openTradeFor(account, symbol);
    const side = pos.qty > 0 ? 'sell' : 'buy';
    const role = opts.role ?? 'exit';
    const seq = this.deps.db.oms.listOrders({ account, limit: 1000 }).filter((o) => o.symbol === symbol && o.role === role && o.tradeId === (trade?.id ?? null)).length;
    let simFillPrice = opts.simFillPrice;
    if (simFillPrice === undefined && opts.emergency && broker instanceof PaperBroker) simFillPrice = broker.flattenPrice(symbol, side) ?? undefined;
    const { order } = this.deps.db.oms.insertOrder({
      clientOrderId: clientOrderId(trade?.id ?? `pos-${symbol}-${now}`, account, role, seq),
      account,
      signalId: trade?.signalId ?? null,
      tradeId: trade?.id ?? null,
      symbol,
      side,
      role,
      type: 'market',
      qty: Math.abs(pos.qty),
      limitPrice: null,
      stopLoss: null,
      takeProfit: null,
      assumedPrice: pos.lastPrice,
      expiresAt: null,
      now,
    });
    this.deps.db.ops.log('system', `order.${role}`, { account, symbol, qty: Math.abs(pos.qty), reason }, now);
    try {
      const state = await this.submit(broker, {
        clientOrderId: order.clientOrderId,
        symbol,
        side,
        type: 'market',
        qty: Math.abs(pos.qty),
        limitPrice: null,
        timeInForce: assetClassOf(symbol) === 'crypto' ? 'gtc' : 'day',
        bracket: null,
        ...(simFillPrice !== undefined ? { simFillPrice } : {}),
      });
      this.deps.db.oms.updateOrder(order.id, { brokerOrderId: state.brokerOrderId, status: state.status === 'new' ? 'submitted' : state.status, error: reason.slice(0, 300) }, this.deps.now());
      this.applyState(this.deps.db.oms.getOrder(order.id)!, state, reason);
    } catch (err) {
      this.deps.db.oms.updateOrder(order.id, { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) }, this.deps.now());
      this.emit({ type: 'fill_failure', order: this.deps.db.oms.getOrder(order.id)! });
      throw err;
    }
    const final = this.deps.db.oms.getOrder(order.id)!;
    this.emit({ type: 'order', order: final });
    return final;
  }

  async cancelAll(account: AccountKind): Promise<number> {
    const broker = this.deps.broker(account);
    if (!broker) return 0;
    const n = await broker.cancelAll();
    const now = this.deps.now();
    for (const o of this.deps.db.oms.openOrders(account)) {
      if (!o.brokerOrderId) {
        this.deps.db.oms.updateOrder(o.id, { status: 'canceled' }, now);
        continue;
      }
      const s = await broker.getOrder(o.brokerOrderId).catch(() => null);
      if (s) this.applyState(o, s);
      else this.deps.db.oms.updateOrder(o.id, { status: 'canceled' }, now);
    }
    return n;
  }

  /** Fold a broker order state into our order row + ledger. */
  applyState(order: OrderRecord, state: BrokerOrderState, reason?: string): void {
    const now = this.deps.now();
    const delta = state.filledQty - order.filledQty;
    if (delta > 1e-9) {
      const prevNotional = (order.avgFillPrice ?? 0) * order.filledQty;
      const newNotional = (state.avgFillPrice ?? order.avgFillPrice ?? 0) * state.filledQty;
      const price = delta > 0 ? (newNotional - prevNotional) / delta : state.avgFillPrice ?? 0;
      const fillPrice = Number.isFinite(price) && price > 0 ? price : state.avgFillPrice ?? 0;
      const commission = costModel(this.deps.config().execution).commissionPerShare * delta;
      this.deps.db.oms.insertFill({
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        qty: delta,
        price: fillPrice,
        commission,
        ts: state.updatedAt || now,
        brokerId: `${state.brokerOrderId}:${state.filledQty}`,
      });
      this.deps.db.oms.updateOrder(order.id, { filledQty: state.filledQty, avgFillPrice: state.avgFillPrice ?? fillPrice, status: state.status }, now);
      const updated = this.deps.db.oms.getOrder(order.id)!;
      if (order.role === 'entry') this.onEntryFill(updated, delta, fillPrice, commission, state.updatedAt || now);
      else this.onExitFill(updated, fillPrice, commission, reason ?? order.error ?? order.role);
    } else if (state.status !== order.status) {
      this.deps.db.oms.updateOrder(order.id, { status: state.status }, now);
      if (order.role === 'entry' && (state.status === 'expired' || state.status === 'canceled') && order.filledQty === 0 && order.signalId) {
        this.deps.db.signals.transition(order.signalId, ['submitted', 'approved'], 'expired', now, 'entry order did not fill before expiry');
      }
      if (state.status === 'rejected' && order.signalId) {
        this.deps.db.signals.transition(order.signalId, ['submitted', 'approved'], 'failed', now, 'broker rejected the order');
      }
    }
    // Bracket legs filled at the broker → exit rows + close the trade.
    for (const leg of state.legs) {
      if (!(leg.filledQty > 0)) continue;
      const { order: legRow, created } = this.deps.db.oms.insertOrder({
        clientOrderId: `leg-${leg.brokerOrderId}`,
        account: order.account,
        signalId: order.signalId,
        tradeId: order.tradeId,
        symbol: order.symbol,
        side: leg.side,
        role: 'exit',
        type: leg.legType === 'take_profit' ? 'limit' : 'stop',
        qty: leg.qty,
        limitPrice: null,
        stopLoss: null,
        takeProfit: null,
        assumedPrice: leg.legType === 'take_profit' ? order.takeProfit : order.stopLoss,
        expiresAt: null,
        now,
      });
      if (created || legRow.filledQty < leg.filledQty) {
        this.deps.db.oms.updateOrder(legRow.id, { brokerOrderId: leg.brokerOrderId, status: 'submitted' }, now);
        this.applyState(this.deps.db.oms.getOrder(legRow.id)!, { ...leg, legs: [] }, leg.legType);
      }
    }
  }

  private onEntryFill(order: OrderRecord, qty: number, price: number, fees: number, ts: number): void {
    const now = this.deps.now();
    let trade = order.tradeId ? this.deps.db.ledger.get(order.tradeId) : null;
    if (trade && trade.status === 'open') {
      this.deps.db.ledger.scaleIn(trade.id, qty, price, fees);
      return;
    }
    const signal = order.signalId ? this.deps.db.signals.get(order.signalId) : null;
    const tf: Timeframe | null = signal ? (signal.timeframe === 'fused' ? (signal.perTimeframe[0]?.timeframe ?? null) : signal.timeframe) : null;
    const baseTf = (signal?.features['base_timeframe'] as Timeframe | undefined) ?? tf;
    const holdBars = typeof signal?.features['max_hold_bars'] === 'number' ? (signal.features['max_hold_bars'] as number) : 0;
    trade = this.deps.db.ledger.openTrade({
      signalId: order.signalId,
      account: order.account,
      symbol: order.symbol,
      side: order.side === 'buy' ? 'long' : 'short',
      timeframe: baseTf,
      qty,
      entryPrice: price,
      stop: order.stopLoss,
      takeProfit: order.takeProfit,
      fees,
      modelVersion: signal?.modelVersion ?? null,
      strategyId: signal?.strategyId ?? null,
      maxHoldUntil: holdBars > 0 && baseTf ? ts + holdBars * TIMEFRAME_MS[baseTf] : null,
      now: ts || now,
    });
    this.deps.db.oms.updateOrder(order.id, { tradeId: trade.id }, now);
    if (order.signalId) {
      this.deps.db.signals.transition(order.signalId, ['approved', 'submitted', 'proposed'], 'filled', now);
      this.deps.db.ledger.linkAuditTrade(order.signalId, trade.id);
    }
    this.emit({ type: 'trade_opened', trade });
  }

  private onExitFill(order: OrderRecord, price: number, fees: number, reason: string): void {
    const now = this.deps.now();
    const trade = (order.tradeId ? this.deps.db.ledger.get(order.tradeId) : null) ?? this.deps.db.ledger.openTradeFor(order.account, order.symbol);
    if (!trade || trade.status !== 'open') return;
    if (order.filledQty < trade.qty - 1e-9 && order.status !== 'filled') return; // wait for the rest
    const exitReason = /stop/i.test(reason) ? 'stop' : /take|profit/i.test(reason) ? 'take_profit' : /time/i.test(reason) ? 'time' : /kill|flatten/i.test(reason) ? 'kill_switch' : reason.slice(0, 60);
    const closed = this.deps.db.ledger.closeTrade(trade.id, { exitPrice: price, fees, reason: exitReason, now });
    if (!closed) return;
    const signal = closed.signalId ? this.deps.db.signals.get(closed.signalId) : null;
    const review = writePostMortem(closed, signal?.features ?? {}, signal?.confidence ?? null);
    this.deps.db.ledger.setReview(closed.id, review);
    if (closed.signalId) this.deps.db.signals.transition(closed.signalId, ['filled', 'submitted', 'approved'], 'closed', now);
    if (closed.strategyId && closed.outcome) {
      const s = this.deps.db.runs.recordStrategyResult(closed.strategyId, closed.outcome, closed.pnl ?? 0, closed.outcome === 'loss' ? review : null, now);
      if (s && s.status === 'active' && shouldRetireStrategy(s)) {
        this.deps.db.runs.updateStrategy(s.id, { status: 'retired' }, now);
        this.emit({ type: 'strategy_retired', name: s.name, detail: `${s.wins}W/${s.losses}L, P&L ${s.totalPnl.toFixed(2)}` });
      }
    }
    if (signal && closed.account !== 'shadow') {
      this.deps.db.runs.addReplay(
        { tradeId: closed.id, modelVersion: closed.modelVersion, timeframe: closed.timeframe, symbol: closed.symbol, features: signal.features, label: (closed.pnl ?? 0) > 0 ? 1 : 0, pnl: closed.pnl ?? 0 },
        now,
      );
    }
    this.emit({ type: 'trade_closed', trade: { ...closed, review } });
  }

  /** Sync one account with its broker. Safe to call every tick (and when paused). */
  async reconcile(account: AccountKind): Promise<ReconcileReport> {
    const report: ReconcileReport = { account, fills: 0, opened: 0, closed: 0, expired: 0, errors: [] };
    const broker = this.deps.broker(account);
    if (!broker) return report;
    const now = this.deps.now();
    const before = { open: this.deps.db.ledger.openTrades(account).length, closed: this.deps.db.ledger.list({ account, status: 'closed', limit: 1000 }).length };
    try {
      if (broker instanceof PaperBroker) report.fills += broker.process();
      // 1) working orders
      for (const o of this.deps.db.oms.listOrders({ account, status: OPEN, limit: 500 })) {
        try {
          const state = o.brokerOrderId ? await broker.getOrder(o.brokerOrderId) : await broker.getOrderByClientId(o.clientOrderId);
          if (!state) {
            if (now - o.createdAt > 10 * 60_000) this.deps.db.oms.updateOrder(o.id, { status: 'failed', error: 'order never reached the broker' }, now);
            continue;
          }
          if (!o.brokerOrderId) this.deps.db.oms.updateOrder(o.id, { brokerOrderId: state.brokerOrderId }, now);
          this.applyState(this.deps.db.oms.getOrder(o.id)!, state);
          const after = this.deps.db.oms.getOrder(o.id)!;
          if (o.role === 'entry' && OPEN.includes(after.status) && after.expiresAt !== null && now >= after.expiresAt && after.brokerOrderId) {
            await broker.cancelOrder(after.brokerOrderId);
            const s2 = await broker.getOrder(after.brokerOrderId).catch(() => null);
            if (s2) this.applyState(after, s2);
            report.expired += 1;
          }
        } catch (err) {
          report.errors.push(`${o.symbol} order ${o.clientOrderId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // 2) broker-managed brackets: poll entry orders of open trades for leg fills
      for (const t of this.deps.db.ledger.openTrades(account)) {
        if (!broker.managesExits(t.symbol) || !t.signalId) continue;
        const entry = this.deps.db.oms.ordersForSignal(t.signalId).find((o) => o.role === 'entry' && o.account === account && o.brokerOrderId);
        if (!entry?.brokerOrderId) continue;
        try {
          const st = await broker.getOrder(entry.brokerOrderId);
          if (st.legs.some((l) => l.filledQty > 0)) this.applyState(entry, st);
        } catch (err) {
          report.errors.push(`${t.symbol} bracket: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // 3) software-managed exits (simulator, crypto) + time exits
      await this.manageExits(account, broker, report);
      // 4) positions that vanished at the broker
      if (!(broker instanceof PaperBroker)) {
        const positions = await broker.getPositions();
        this.deps.db.oms.replacePositions(
          account,
          positions.map((p) => ({ account, symbol: p.symbol, qty: p.qty, avgPrice: p.avgPrice, lastPrice: p.lastPrice, openedAt: now, updatedAt: now })),
        );
        const held = new Set(positions.map((p) => p.symbol));
        for (const t of this.deps.db.ledger.openTrades(account)) {
          if (held.has(t.symbol) || t.legacy) continue;
          const pendingEntry = t.signalId ? this.deps.db.oms.ordersForSignal(t.signalId).some((o) => o.role === 'entry' && OPEN.includes(o.status)) : false;
          if (pendingEntry) continue;
          const last = this.deps.db.market.bars(t.symbol, t.timeframe ?? '1d', { limit: 1 })[0]?.close ?? t.entryPrice;
          const closed = this.deps.db.ledger.closeTrade(t.id, { exitPrice: last, fees: 0, reason: 'reconciled: position closed at the broker', now });
          if (closed) this.emit({ type: 'trade_closed', trade: closed });
        }
      }
    } catch (err) {
      report.errors.push(err instanceof Error ? err.message : String(err));
    }
    const after = { open: this.deps.db.ledger.openTrades(account).length, closed: this.deps.db.ledger.list({ account, status: 'closed', limit: 1000 }).length };
    report.closed = Math.max(0, after.closed - before.closed);
    report.opened = Math.max(0, after.open - before.open + report.closed);
    return report;
  }

  private async manageExits(account: AccountKind, broker: BrokerAdapter, report: ReconcileReport): Promise<void> {
    const now = this.deps.now();
    const costs = costModel(this.deps.config().execution);
    for (const t of this.deps.db.ledger.openTrades(account)) {
      if (t.legacy) continue;
      const openExit = this.deps.db.oms.openOrders(account).some((o) => o.symbol === t.symbol && o.role !== 'entry');
      if (openExit) continue;
      if (!broker.managesExits(t.symbol) && (t.stop !== null || t.takeProfit !== null)) {
        const tf = t.timeframe ?? '15m';
        const bars = this.deps.db.market.bars(t.symbol, tf, { from: t.openedAt - TIMEFRAME_MS[tf] + 1 });
        for (const bar of bars) {
          if (bar.ts + TIMEFRAME_MS[tf] <= t.openedAt) continue;
          const ex = checkExits(t.side, t.stop, t.takeProfit, bar, costs);
          if (!ex) continue;
          try {
            await this.closePosition(account, t.symbol, ex.reason, broker instanceof PaperBroker ? { simFillPrice: ex.price } : {});
          } catch (err) {
            report.errors.push(`${t.symbol} ${ex.reason}: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        if (this.deps.db.ledger.get(t.id)?.status !== 'open') continue;
      }
      if (t.maxHoldUntil !== null && now >= t.maxHoldUntil) {
        try {
          const last = broker instanceof PaperBroker ? broker.lastPrice(t.symbol) : null;
          await this.closePosition(
            account,
            t.symbol,
            'time exit (holding period elapsed)',
            broker instanceof PaperBroker && last !== null ? { simFillPrice: slip(last, t.side === 'long' ? 'sell' : 'buy', costs.slippageBps) } : {},
          );
        } catch (err) {
          report.errors.push(`${t.symbol} time exit: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
}
