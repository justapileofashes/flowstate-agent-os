// Phase 5 DoD — real broker integration (Alpaca), shadow compare, go-live gate,
// kill switch.
//   "first real $ order placed, filled, and recorded in orders/fills/trades;
//    shadow-vs-live slippage measured and logged per trade; kill switch flips
//    all positions to halted within one cycle"
// The "real" broker here is a faithful fake of Alpaca's REST API — no money.

import { describe, it, expect, afterEach } from 'vitest';
import { AlpacaBroker, mapAlpacaStatus, normalizeAlpacaSymbol } from '@main/trader/execution/alpaca';
import { BrokerError } from '@main/trader/execution/types';
import { Oms } from '@main/trader/execution/oms';
import { etParts, etToUtc, isTradingDay } from '@main/trader/data/calendar';
import { defaultTraderConfig } from '@shared/trader/types';
import { backfill, FakeFetch, json, makeDb, makeTrader, marketData, testConfig, type DbEnv, type FetchCall, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
let dbEnv: DbEnv | null = null;
afterEach(() => {
  env?.cleanup();
  dbEnv?.cleanup();
  env = null;
  dbEnv = null;
});

interface FakeOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
  type: string;
  order_class?: string;
  legs?: FakeOrder[];
  submitted_at: string;
  updated_at: string;
}

/** Minimal in-memory Alpaca trading API. */
class FakeAlpaca {
  orders: FakeOrder[] = [];
  positions = new Map<string, { qty: number; avg: number; price: number }>();
  cash = 100_000;
  posts = 0;
  dropNextPostResponse = false;
  private n = 0;

  constructor(
    readonly http: FakeFetch,
    readonly base: string,
  ) {
    http.on(base, (c) => this.route(c));
  }

  private route(c: FetchCall): Response {
    const url = new URL(c.url);
    const path = url.pathname;
    if (c.method === 'GET' && path === '/v2/account') {
      const eq = this.cash + [...this.positions.values()].reduce((a, p) => a + p.qty * p.price, 0);
      return json({ equity: String(eq), cash: String(this.cash), buying_power: String(this.cash), status: 'ACTIVE', trading_blocked: false });
    }
    if (c.method === 'GET' && path === '/v2/clock') return json({ is_open: true, next_open: '2026-09-24T13:30:00Z', next_close: '2026-09-23T20:00:00Z' });
    if (c.method === 'GET' && path === '/v2/positions') {
      return json([...this.positions.entries()].map(([symbol, p]) => ({ symbol, qty: String(Math.abs(p.qty)), side: p.qty < 0 ? 'short' : 'long', avg_entry_price: String(p.avg), current_price: String(p.price) })));
    }
    if (c.method === 'POST' && path === '/v2/orders') {
      this.posts += 1;
      const b = JSON.parse(c.body) as Record<string, any>;
      const id = `ord-${++this.n}`;
      const o: FakeOrder = {
        id,
        client_order_id: b.client_order_id,
        symbol: b.symbol,
        side: b.side,
        qty: b.qty,
        filled_qty: '0',
        filled_avg_price: null,
        status: 'accepted',
        type: b.type,
        ...(b.order_class === 'bracket'
          ? {
              order_class: 'bracket',
              legs: [
                { id: `${id}-tp`, client_order_id: '', symbol: b.symbol, side: b.side === 'buy' ? 'sell' : 'buy', qty: b.qty, filled_qty: '0', filled_avg_price: null, status: 'held', type: 'limit', submitted_at: '', updated_at: '' },
                { id: `${id}-sl`, client_order_id: '', symbol: b.symbol, side: b.side === 'buy' ? 'sell' : 'buy', qty: b.qty, filled_qty: '0', filled_avg_price: null, status: 'held', type: 'stop', submitted_at: '', updated_at: '' },
              ],
            }
          : {}),
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.orders.push(o);
      if (this.dropNextPostResponse) {
        this.dropNextPostResponse = false;
        throw new Error('fetch failed: socket hang up'); // the order landed, the response did not
      }
      return json(o);
    }
    if (c.method === 'GET' && path === '/v2/orders:by_client_order_id') {
      const o = this.orders.find((x) => x.client_order_id === url.searchParams.get('client_order_id'));
      return o ? json(o) : json({ message: 'not found' }, 404);
    }
    if (c.method === 'GET' && path.startsWith('/v2/orders/')) {
      const id = decodeURIComponent(path.slice('/v2/orders/'.length));
      const o = this.orders.find((x) => x.id === id);
      return o ? json(o) : json({ message: 'not found' }, 404);
    }
    if (c.method === 'DELETE' && path === '/v2/orders') {
      const open = this.orders.filter((o) => ['accepted', 'new', 'held', 'partially_filled'].includes(o.status));
      for (const o of open) o.status = 'canceled';
      return json(open.map((o) => ({ id: o.id, status: 200 })), 207);
    }
    if (c.method === 'DELETE' && path.startsWith('/v2/orders/')) {
      const o = this.orders.find((x) => x.id === decodeURIComponent(path.slice(11)));
      if (o && o.status !== 'filled') o.status = 'canceled';
      return new Response(null, { status: 204 });
    }
    if (c.method === 'GET' && path === '/v2/account/activities/FILL') return json([]);
    return json({ message: `unhandled ${c.method} ${path}` }, 404);
  }

  fill(id: string, price: number): void {
    const o = this.orders.find((x) => x.id === id)!;
    o.status = 'filled';
    o.filled_qty = o.qty;
    o.filled_avg_price = String(price);
    o.updated_at = new Date().toISOString();
    const q = Number(o.qty) * (o.side === 'buy' ? 1 : -1);
    const p = this.positions.get(o.symbol) ?? { qty: 0, avg: price, price };
    const nq = p.qty + q;
    this.cash -= q * price;
    if (Math.abs(nq) < 1e-9) this.positions.delete(o.symbol);
    else this.positions.set(o.symbol, { qty: nq, avg: p.qty === 0 ? price : p.avg, price });
    for (const l of o.legs ?? []) if (l.status === 'held') l.status = 'new';
  }

  fillLeg(parentId: string, leg: 'tp' | 'sl', price: number): void {
    const parent = this.orders.find((x) => x.id === parentId)!;
    const l = parent.legs!.find((x) => x.id.endsWith(`-${leg}`))!;
    l.status = 'filled';
    l.filled_qty = l.qty;
    l.filled_avg_price = String(price);
    l.updated_at = new Date().toISOString();
    const other = parent.legs!.find((x) => x !== l)!;
    other.status = 'canceled';
    const pos = this.positions.get(parent.symbol);
    if (pos) {
      this.cash += pos.qty * price;
      this.positions.delete(parent.symbol);
    }
  }
}

const PAPER = 'https://paper-api.alpaca.markets';
const LIVE = 'https://api.alpaca.markets';

describe('AlpacaBroker adapter', () => {
  it('sends bracket orders with client ids; crypto goes out plain GTC', async () => {
    const http = new FakeFetch();
    const fake = new FakeAlpaca(http, PAPER);
    const b = new AlpacaBroker('paper', { keyId: 'PKTESTKEY1', secret: 'secretsecret' }, http.fn);
    const s = await b.placeOrder({ clientOrderId: 'fs-abc', symbol: 'AAPL', side: 'buy', type: 'market', qty: 10, limitPrice: null, timeInForce: 'day', bracket: { stopLoss: 97.123, takeProfit: 106.456 } });
    const body = JSON.parse(http.calls.find((c) => c.method === 'POST')!.body);
    expect(body).toMatchObject({ symbol: 'AAPL', qty: '10', side: 'buy', type: 'market', time_in_force: 'day', client_order_id: 'fs-abc', order_class: 'bracket', take_profit: { limit_price: '106.46' }, stop_loss: { stop_price: '97.12' } });
    expect(s.status).toBe('submitted');
    expect(b.managesExits('AAPL')).toBe(true);
    expect(b.managesExits('BTC/USD')).toBe(false);
    await b.placeOrder({ clientOrderId: 'fs-c', symbol: 'BTC/USD', side: 'buy', type: 'market', qty: 0.01, limitPrice: null, timeInForce: 'day', bracket: { stopLoss: 1, takeProfit: 2 } });
    const crypto = JSON.parse(http.calls.filter((c) => c.method === 'POST')[1]!.body);
    expect(crypto.time_in_force).toBe('gtc');
    expect(crypto.order_class).toBeUndefined();
    expect(await b.getOrderByClientId('nope')).toBeNull();
    expect(fake.orders).toHaveLength(2);
  });

  it('maps statuses, symbols and errors', async () => {
    expect(mapAlpacaStatus('pending_new')).toBe('submitted');
    expect(mapAlpacaStatus('done_for_day')).toBe('canceled');
    expect(normalizeAlpacaSymbol('BTCUSD')).toBe('BTC/USD');
    const http = new FakeFetch();
    http.on(PAPER + '/v2/account', () => json({ message: 'unauthorized' }, 401));
    http.on(PAPER + '/v2/orders', () => new Response('insufficient buying power', { status: 403 }));
    const b = new AlpacaBroker('paper', { keyId: 'k', secret: 's' }, http.fn);
    await expect(b.getAccount()).rejects.toMatchObject({ kind: 'auth' });
    await expect(b.placeOrder({ clientOrderId: 'x', symbol: 'AAPL', side: 'buy', type: 'market', qty: 1, limitPrice: null, timeInForce: 'day', bracket: null })).rejects.toBeInstanceOf(BrokerError);
    await expect(b.placeOrder({ clientOrderId: 'x', symbol: 'AAPL', side: 'buy', type: 'market', qty: 1, limitPrice: null, timeInForce: 'day', bracket: null })).rejects.toMatchObject({ kind: 'insufficient_funds' });
    expect(new AlpacaBroker('live', { keyId: 'k', secret: 's' }).name).toBe('alpaca-live');
  });

  it('OMS never double-submits: a lost response is recovered via the client order id', async () => {
    dbEnv = makeDb();
    const http = new FakeFetch();
    const fake = new FakeAlpaca(http, PAPER);
    const broker = new AlpacaBroker('paper', { keyId: 'k', secret: 's' }, http.fn);
    const cfg = defaultTraderConfig();
    const oms = new Oms({ db: dbEnv.db, broker: () => broker, config: () => cfg, now: () => Date.now(), sleep: async () => undefined });
    fake.dropNextPostResponse = true;
    const t = { signalId: 'sig-1', symbol: 'AAPL', side: 'long' as const, qty: 10, entry: 100, stop: 97, takeProfit: 106, timeframe: '1h' as const, maxHoldBars: 6, expiresAt: Date.now() + 3_600_000, modelVersion: null, strategyId: null };
    const r = await oms.submitEntry(t, 'paper');
    expect(r.error).toBeUndefined();
    expect(fake.posts).toBe(1);
    expect(r.order!.brokerOrderId).toBe(fake.orders[0]!.id);
    // Resubmitting the same approved trade is a no-op.
    const again = await oms.submitEntry(t, 'paper');
    expect(again.created).toBe(false);
    expect(fake.posts).toBe(1);
    // Validation happens before any network call.
    const bad = await oms.submitEntry({ ...t, signalId: 'sig-2', stop: 101 }, 'paper');
    expect(bad.error).toMatch(/validation failed/);
    expect(fake.posts).toBe(1);
  });
});

// ── service-level: live gate, first live order, shadow compare, kill switch ──

const START = etToUtc(2026, 9, 14, 9, 45);

function barCloses(from: number, days: number): number[] {
  const out: number[] = [];
  let d = 0;
  for (let i = 0; d < days && i < 20; i++) {
    const p = etParts(from + i * 86_400_000);
    if (!isTradingDay(p.date, p.weekday)) continue;
    d += 1;
    for (let h = 0; h < 7; h++) out.push(Math.min(etToUtc(p.y, p.m, p.d, 10 + h, 30), etToUtc(p.y, p.m, p.d, 16, 0)));
  }
  return out;
}

async function liveReadyEnv(liveBuildEnabled: boolean): Promise<{ env: TraderEnv; live: FakeAlpaca }> {
  const e = await makeTrader({
    now: START,
    data: marketData(START + 10 * 86_400_000, undefined, '1h', 290),
    config: testConfig({ signals: { confidenceThreshold: 0.55, minEdgePct: 0 }, risk: { maxSectorPct: 100 } }),
    liveBuildEnabled,
  });
  const live = new FakeAlpaca(e.http, LIVE);
  e.http.on('https://data.alpaca.markets/v2/stocks/bars', () => json({ bars: { SPY: [{ t: '2026-09-11T04:00:00Z', o: 1, h: 1, l: 1, c: 1, v: 1 }] }, next_page_token: null }));
  await backfill(e);
  await e.service.handle('models.train', { timeframe: '1h' });
  await e.service.handle('consent.accept', { text: 'I UNDERSTAND' });
  return { env: e, live };
}

/** Satisfy the paper-history requirement with a believable 3-week record. */
function seedPaperHistory(e: TraderEnv): void {
  const now = e.clock.now();
  for (let d = 21; d >= 1; d--) e.service.db.ops.recordEquity('paper', now - d * 86_400_000, 100_000 + (21 - d) * 50, 100_000);
  for (let i = 0; i < 12; i++) {
    const t = e.service.db.ledger.openTrade({ signalId: null, account: 'paper', symbol: 'AAPL', side: 'long', timeframe: '1h', qty: 10, entryPrice: 100, stop: 97, takeProfit: 106, fees: 0, modelVersion: 'x', strategyId: null, maxHoldUntil: null, now: now - (20 - i) * 86_400_000 });
    e.service.db.ledger.closeTrade(t.id, { exitPrice: i % 3 ? 102 : 99, fees: 0, reason: 'time', now: now - (19 - i) * 86_400_000 });
  }
}

describe('Phase 5 DoD: go-live gate', () => {
  it('without the build flag nothing can go live, whatever else is configured', async () => {
    const { env: e } = await liveReadyEnv(false);
    env = e;
    seedPaperHistory(e);
    await e.service.handle('credentials.save', { slot: 'live', keyId: 'AKLIVEKEY1', secret: 'livesecret123' });
    const list = await e.service.handle('golive.checklist', {});
    expect(list.items.find((i) => i.key === 'build_flag')!.ok).toBe(false);
    expect(list.ready).toBe(false);
    const r = await e.service.handle('golive.enable', { confirm: 'TRADE LIVE' });
    expect(r.live).toBe(false);
    expect(e.service.broker('live')).toBeNull();
    expect((await e.service.handle('status', {})).mode).toBe('paper');
  }, 120_000);

  it('every checklist item gates live mode; then the first live order is placed, filled and recorded, and mirrored to the shadow book', async () => {
    const { env: e, live } = await liveReadyEnv(true);
    env = e;
    let list = await e.service.handle('golive.checklist', {});
    expect(list.items.filter((i) => !i.ok).map((i) => i.key).sort()).toEqual(['kill_switch_tested', 'live_keys', 'paper_history', 'separate_keys']);
    seedPaperHistory(e);
    expect((await e.service.handle('killswitch.test', {})).ok).toBe(true);
    await e.service.handle('credentials.save', { slot: 'data', keyId: 'DATAKEY001', secret: 'datasecret123' });
    const saved = await e.service.handle('credentials.save', { slot: 'live', keyId: 'AKLIVEKEY1', secret: 'livesecret123' });
    expect(saved.ok).toBe(true);
    list = await e.service.handle('golive.checklist', {});
    expect(list.ready).toBe(true);
    expect((await e.service.handle('golive.enable', { confirm: 'trade live please' })).live).toBe(false);
    const on = await e.service.handle('golive.enable', { confirm: 'TRADE LIVE' });
    expect(on.live).toBe(true);
    const st = await e.service.handle('status', {});
    expect(st.mode).toBe('live');
    expect(st.autopilot).toBe(false); // must be re-armed deliberately
    await e.service.handle('autopilot.set', { enabled: true });

    // Run the graph until the first live entry goes out.
    let liveOrderId: string | null = null;
    for (const t of barCloses(START, 3)) {
      e.clock.set(new Date(t + 30_000));
      await e.service.runTick('schedule');
      const o = e.service.db.oms.listOrders({ account: 'live', limit: 10 }).find((x) => x.role === 'entry');
      if (o) {
        liveOrderId = o.id;
        break;
      }
    }
    expect(liveOrderId).not.toBeNull();
    const order = e.service.db.oms.getOrder(liveOrderId!)!;
    const post = e.http.calls.find((c) => c.method === 'POST' && c.url.startsWith(LIVE))!;
    expect(JSON.parse(post.body)).toMatchObject({ client_order_id: order.clientOrderId, order_class: 'bracket' });
    expect(e.http.calls.some((c) => c.url.startsWith(PAPER))).toBe(false);
    // Shadow mirror in the simulator for the same signal.
    const shadow = e.service.db.oms.ordersForSignal(order.signalId!).find((x) => x.account === 'shadow');
    expect(shadow).toBeTruthy();

    // Broker fills 2 bps worse than the decision price → reconcile records fill, trade, slippage.
    const px = order.assumedPrice! * 1.0002;
    live.fill(order.brokerOrderId!, px);
    e.clock.advance(3_600_000);
    await e.service.runTick('schedule');
    const filled = e.service.db.oms.getOrder(order.id)!;
    expect(filled.status).toBe('filled');
    expect(filled.slippageBps).toBeCloseTo(2, 1);
    expect(e.service.db.oms.fillsFor([order.id])).toHaveLength(1);
    const trade = e.service.db.ledger.bySignal(order.signalId!, 'live')!;
    expect(trade.entryPrice).toBeCloseTo(px, 6);
    const shadowOrder = e.service.db.oms.getOrder(shadow!.id)!;
    expect(shadowOrder.status).toBe('filled');
    expect(shadowOrder.slippageBps).not.toBeNull(); // shadow vs live comparable per trade

    // Stop leg fills at the broker → exit recorded, trade closed as a stop.
    live.fillLeg(order.brokerOrderId!, 'sl', order.stopLoss!);
    e.clock.advance(60_000);
    await e.service.handle('cycles.run', {});
    const closed = e.service.db.ledger.get(trade.id)!;
    expect(closed.status).toBe('closed');
    expect(closed.exitReason).toBe('stop');
    expect(closed.pnl!).toBeLessThan(0);
    const audit = await e.service.handle('audit.get', { tradeId: trade.id });
    expect(audit.orders.some((o) => o.role === 'exit')).toBe(true);
    expect(audit.audit!.approvalTs).not.toBeNull();
  }, 180_000);
});

describe('Phase 5 DoD: kill switch', () => {
  it('flatten closes every simulated position within one call and halts the next cycles', async () => {
    env = await makeTrader({
      now: START,
      data: marketData(START + 10 * 86_400_000, undefined, '1h', 290),
      config: testConfig({ signals: { confidenceThreshold: 0.55, minEdgePct: 0 }, risk: { maxSectorPct: 100 } }),
    });
    await backfill(env);
    await env.service.handle('models.train', { timeframe: '1h' });
    await env.service.handle('consent.accept', { text: 'I UNDERSTAND' });
    await env.service.handle('autopilot.set', { enabled: true });
    for (const t of barCloses(START, 2)) {
      env.clock.set(new Date(t + 30_000));
      await env.service.runTick('schedule');
      if (env.service.db.ledger.openTrades('paper').length >= 1) break;
    }
    const before = env.service.db.ledger.openTrades('paper');
    expect(before.length).toBeGreaterThan(0);
    const k = await env.service.handle('kill', { mode: 'flatten', reason: 'test' });
    expect(k.errors).toEqual([]);
    expect(k.flattened.length).toBe(before.length);
    expect(env.service.db.ledger.openTrades('paper')).toHaveLength(0);
    expect((await env.service.handle('portfolio', { account: 'paper' })).positions).toHaveLength(0);
    for (const t of before) expect(env.service.db.ledger.get(t.id)!.exitReason).toBe('kill_switch');
    const st = await env.service.handle('status', {});
    expect(st.kill.active).toBe(true);
    expect(st.autopilot).toBe(false);
    expect(await env.service.handle('autopilot.set', { enabled: true })).toMatchObject({ autopilot: false });
    env.clock.advance(3_600_000);
    const c = await env.service.handle('cycles.run', {});
    expect(c.cycle!.status).toBe('skipped');
    expect(c.cycle!.skipReason).toMatch(/kill switch/);
    await env.service.handle('resume', {});
    expect((await env.service.handle('status', {})).kill.active).toBe(false);
    expect(env.service.db.ops.opsLog(50).some((l) => l.action === 'kill.engage')).toBe(true);
  }, 180_000);

  it('shadow compare backtests a candidate against production on the same window without orders', async () => {
    env = await makeTrader({ data: marketData(etToUtc(2026, 9, 23, 11, 0)) });
    await backfill(env);
    const first = await env.service.handle('models.train', { timeframe: '1h' });
    const second = await env.service.handle('models.train', { timeframe: '1h' });
    // Retraining on the same data: same hash-stable model → shadow or rejected (must beat the incumbent).
    expect(['shadow', 'rejected']).toContain(second.action);
    const cmp = await env.service.handle('models.shadowCompare', { version: second.model!.version, days: 30 });
    expect(cmp.error).toBeUndefined();
    expect(cmp.candidate!.metrics!.bars).toBeGreaterThan(0);
    expect(cmp.production!.label).toMatch(first.model!.version);
    expect(env.service.db.oms.listOrders()).toHaveLength(0);
  }, 180_000);
});
