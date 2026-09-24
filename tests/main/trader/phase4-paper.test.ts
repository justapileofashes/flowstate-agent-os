// Phase 4 DoD — paper (simulation) execution loop.
//   "simulate 5 business days; portfolio_equity.csv shows entries/exits
//    consistent with generated signals; zero uncontrolled orders leaked to real
//    brokers; the circuit breaker trips when simulated drawdown crosses the
//    configured limit" + the deterministic abort path on any node error.

import { describe, it, expect, afterEach } from 'vitest';
import { etParts, etToUtc, isTradingDay } from '@main/trader/data/calendar';
import { TIMEFRAME_MS } from '@shared/trader/types';
import { backfill, makeTrader, marketData, testConfig, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

const START = etToUtc(2026, 9, 14, 9, 45); // Monday before the open of the first hourly bar close

/** Hourly bar closes (10:30 … 16:00 ET) for the next `days` trading days. */
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

async function tradingEnv(over: Parameters<typeof testConfig>[0] = {}): Promise<TraderEnv> {
  // Data extends 10 days past START; the fake provider only reveals bars that have closed.
  const data = marketData(START + 10 * 86_400_000, undefined, '1h', 290);
  const e = await makeTrader({
    now: START,
    data,
    config: testConfig({ signals: { confidenceThreshold: 0.55, minEdgePct: 0 }, risk: { maxPositions: 4, maxSectorPct: 100 }, ...over }),
  });
  await backfill(e);
  const trained = await e.service.handle('models.train', { timeframe: '1h' });
  expect(trained.action).toBe('promoted');
  await e.service.handle('consent.accept', { text: 'I UNDERSTAND' });
  await e.service.handle('autopilot.set', { enabled: true });
  return e;
}

describe('Phase 4 DoD: 5 simulated business days on the paper account', () => {
  it('trades end-to-end through the graph with consistent orders, fills, ledger and equity', async () => {
    env = await tradingEnv();
    for (const t of barCloses(START, 5)) {
      env.clock.set(new Date(t + 30_000));
      const c = await env.service.runTick('schedule');
      expect(c!.status).not.toBe('aborted');
    }
    const cycles = env.service.db.runs.cycles(200);
    expect(cycles.length).toBeGreaterThanOrEqual(30);

    const signals = (await env.service.handle('signals.list', { since: 'all', limit: 1000 })).signals;
    const orders = (await env.service.handle('orders.list', { limit: 1000 })).orders;
    const trades = (await env.service.handle('trades.list', { limit: 1000 })).trades.filter((t) => !t.legacy);
    expect(signals.length).toBeGreaterThan(0);
    expect(orders.filter((o) => o.role === 'entry').length).toBeGreaterThan(0);
    expect(trades.length).toBeGreaterThan(0);

    // Every entry order belongs to a signal the risk engine approved; every trade to a filled entry.
    for (const o of orders.filter((x) => x.role === 'entry')) {
      const s = signals.find((x) => x.id === o.signalId)!;
      expect(s).toBeTruthy();
      expect(['submitted', 'filled', 'closed', 'expired']).toContain(s.status);
      expect(o.account).toBe('paper');
      expect(o.qty).toBe(s.size);
    }
    for (const t of trades) {
      const entry = orders.find((o) => o.signalId === t.signalId && o.role === 'entry')!;
      expect(entry.status === 'filled' || entry.filledQty > 0).toBe(true);
      expect(t.entryPrice).toBeCloseTo(entry.avgFillPrice!, 6);
      if (t.status === 'closed') {
        expect(t.exitPrice).not.toBeNull();
        expect(['stop', 'take_profit', 'time']).toContain(t.exitReason);
        expect(t.review).toMatch(/WIN|LOSS/);
      }
    }
    // Slippage is measured against the assumed (decision-time) price.
    expect(orders.some((o) => o.slippageBps !== null)).toBe(true);

    // Equity curve + CSV export.
    const csv = (await env.service.handle('equity.csv', { account: 'paper', days: 30 })).csv.trim().split('\n');
    expect(csv[0]).toBe('ts,iso,equity');
    expect(csv.length).toBeGreaterThan(10);
    for (const line of csv.slice(1)) expect(line).toMatch(/^\d{13},\d{4}-\d{2}-\d{2}T[\d:.]+Z,\d+\.\d{2}$/);
    const pf = await env.service.handle('portfolio', { account: 'paper' });
    const realized = trades.filter((t) => t.status === 'closed').reduce((a, t) => a + (t.pnl ?? 0), 0);
    const unrealized = pf.positions.reduce((a, p) => a + p.unrealizedPnl, 0);
    expect(pf.equity).toBeCloseTo(100_000 + realized + unrealized - trades.filter((t) => t.status === 'open').reduce((a, t) => a + t.fees, 0), 0);

    // Zero orders leaked to a real broker.
    expect(env.http.calls.filter((c) => c.url.includes('alpaca.markets'))).toHaveLength(0);
    // Risk rejections are audited verbatim.
    const rejected = signals.filter((s) => s.status === 'rejected');
    for (const s of rejected.slice(0, 3)) {
      const a = await env.service.handle('audit.get', { signalId: s.id });
      expect(a.audit!.risk!.reason).toBe(s.reason);
    }
  }, 180_000);

  it('the circuit breaker trips when the simulated day loss crosses the limit and halts new entries', async () => {
    env = await tradingEnv({ risk: { dailyLossLimitPct: 0.1, maxPositions: 5, maxSectorPct: 100 } });
    let tripped = false;
    let crashed = false;
    for (const t of barCloses(START, 5)) {
      env.clock.set(new Date(t + 30_000));
      const c = await env.service.runTick('schedule');
      const open = env.service.db.ledger.openTrades('paper');
      if (!crashed && open.length) {
        // Gap every future bar of the held symbol 6% lower: the stop fills through the gap.
        crashed = true;
        const sym = open[0]!.symbol;
        const bars = env.yahoo.data.get(sym)!.get('1h')!;
        env.yahoo.data.get(sym)!.set('1h', bars.map((b) => (b.ts > env!.clock.now() ? { ...b, open: b.open * 0.94, high: b.high * 0.94, low: b.low * 0.94, close: b.close * 0.94 } : b)));
      }
      const st = await env.service.handle('status', {});
      if (st.breaker.tripped) {
        tripped = true;
        expect(st.breaker.reason).toMatch(/daily loss/);
        // Rest of the day: ticks skip before any new signal/order.
        const before = env.service.db.oms.listOrders({ limit: 1000 }).filter((o) => o.role === 'entry').length;
        env.clock.advance(TIMEFRAME_MS['1h']);
        const next = await env.service.runTick('schedule');
        expect(next!.status).toBe('skipped');
        expect(next!.skipReason).toMatch(/circuit breaker|market closed/);
        expect(env.service.db.oms.listOrders({ limit: 1000 }).filter((o) => o.role === 'entry').length).toBe(before);
        expect(env.service.db.ops.alerts({ open: true }).some((a) => a.key === 'circuit_breaker')).toBe(true);
        // Manual execution is blocked too while the breaker is tripped.
        const sig = env.service.db.signals.insert({ cycleId: null, symbol: 'AAPL', side: 'long', timeframe: '1h', entry: 100, stop: 97, takeProfit: 106, size: 0, confidence: 0.9, edgePct: 1, horizonMin: 120, modelVersion: null, strategyId: null, source: 'manual', status: 'proposed', perTimeframe: [], features: {}, barTs: null, now: env.clock.now() });
        expect((await env.service.handle('signals.execute', { signalId: sig.id })).reason).toMatch(/circuit breaker/);
        // Next trading day the breaker is clear again.
        const nextDay = barCloses(env.clock.now() + 12 * 3_600_000, 1)[0]!;
        env.clock.set(new Date(nextDay + 30_000));
        expect(env.service.breaker()).toBeNull();
        const fresh = await env.service.runTick('schedule');
        expect(fresh!.skipReason ?? '').not.toMatch(/circuit breaker/);
        break;
      }
      expect(c!.status).not.toBe('aborted');
    }
    expect(tripped).toBe(true);
  }, 180_000);
});

describe('orchestrator failure path', () => {
  it('a failing node aborts the tick: no orders, cycle recorded as aborted, alert raised', async () => {
    env = await tradingEnv();
    const t = barCloses(START, 1)[0]!;
    env.clock.set(new Date(t + 30_000));
    const original = env.service.registry.active.bind(env.service.registry);
    env.service.registry.active = () => {
      throw new Error('model store unavailable');
    };
    const c = await env.service.runTick('schedule');
    env.service.registry.active = original;
    expect(c!.status).toBe('aborted');
    expect(c!.abortReason).toMatch(/model store unavailable/);
    const failed = c!.nodes.find((n) => !n.ok)!;
    expect(failed.node).toBe('researcher');
    expect(c!.nodes.some((n) => n.node === 'trader')).toBe(false);
    expect(env.service.db.oms.listOrders()).toHaveLength(0);
    expect(env.service.db.ops.alerts({ open: true }).some((a) => a.key === 'cycle_aborted')).toBe(true);
  }, 120_000);

  it('no data → no trading (the data node aborts instead of trading on stale features)', async () => {
    env = await tradingEnv();
    env.yahoo.fail = new Error('fetch failed');
    const t = barCloses(START, 1)[0]!;
    env.clock.set(new Date(t + 30_000));
    const c = await env.service.runTick('schedule');
    expect(c!.status).toBe('aborted');
    expect(c!.abortReason).toMatch(/market data unavailable/);
    expect(env.service.db.oms.listOrders()).toHaveLength(0);
  }, 120_000);

  it('an unparseable LLM risk review aborts the tick (no trade); a valid veto blocks just that trade', async () => {
    env = await tradingEnv({ llm: { enabled: true, model: 'fake-model', riskReview: true, rationale: false, maxCallsPerTick: 10 } });
    env.llm.setHandler(() => ({ text: 'Sure! Looks fine to me.' }));
    let aborted = false;
    for (const t of barCloses(START, 2)) {
      env.clock.set(new Date(t + 30_000));
      const c = await env.service.runTick('schedule');
      if (c!.status === 'aborted') {
        aborted = true;
        expect(c!.abortReason).toMatch(/not valid JSON/);
        break;
      }
    }
    expect(aborted).toBe(true);
    expect(env.service.db.oms.listOrders()).toHaveLength(0);

    env.llm.setHandler(() => ({ text: '{"veto": true, "reason": "earnings tomorrow"}' }));
    let vetoed = false;
    for (const t of barCloses(START + 2 * 86_400_000, 2)) {
      env.clock.set(new Date(t + 30_000));
      await env.service.runTick('schedule');
      const v = (await env.service.handle('signals.list', { since: 'all', status: ['vetoed'] })).signals;
      if (v.length) {
        vetoed = true;
        expect(v[0]!.reason).toMatch(/earnings tomorrow/);
        const a = await env.service.handle('audit.get', { signalId: v[0]!.id });
        expect(a.audit!.risk!.allowed).toBe(false);
        expect(a.audit!.trader!.llm!.reply).toContain('veto');
        break;
      }
    }
    expect(vetoed).toBe(true);
    expect(env.service.db.oms.listOrders()).toHaveLength(0);
  }, 180_000);
});
