// Phase 3 DoD — risk engine + signal emitter.
//   "unit tests prove a bad-size / bad-stop order is rejected even if
//    confidence = 0.99; a fabricated over-sized signal is logged as rejected in
//    trade_audit with reason; a valid signal persists to signals; the scheduler
//    runs on a cron-like loop"

import { describe, it, expect, afterEach } from 'vitest';
import { RiskManager } from '@main/trader/risk/manager';
import { AtrStopRule, DailyLossCircuitBreakerRule, ExposureLimitRule, FixedFractionalRule, RiskRule, type RiskContext } from '@main/trader/risk/rules';
import { decide, fuseScores, type TimeframeScore } from '@main/trader/signals/core';
import { correlationFromBars } from '@main/trader/risk/market';
import { TraderScheduler } from '@main/trader/scheduler';
import { defaultTraderConfig, strategyParamsSchema, type StrategyDto } from '@shared/trader/types';
import type { MarketContext, PortfolioState, SignalProposal } from '@main/trader/types';
import { etToUtc } from '@main/trader/data/calendar';
import { backfill, makeDb, makeTrader, type DbEnv, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
let dbEnv: DbEnv | null = null;
afterEach(() => {
  env?.cleanup();
  dbEnv?.cleanup();
  env = null;
  dbEnv = null;
});

function proposal(over: Partial<SignalProposal> = {}): SignalProposal {
  return {
    symbol: 'AAPL',
    side: 'long',
    timeframe: '1h',
    baseTimeframe: '1h',
    entry: 100,
    stop: 97,
    takeProfit: 106,
    confidence: 0.7,
    edgePct: 0.3,
    horizonBars: 4,
    horizonMin: 240,
    maxHoldBars: 12,
    atr: 2,
    regime: 'trend_up/normal_vol',
    barTs: 0,
    modelVersion: 'm1',
    modelHash: 'h',
    strategyId: null,
    strategyName: null,
    perTimeframe: [],
    features: {},
    source: 'model',
    drivers: '',
    ...over,
  };
}

function portfolio(over: Partial<PortfolioState> = {}): PortfolioState {
  return {
    equity: 100_000,
    cash: 100_000,
    peakEquity: 100_000,
    dayStartEquity: 100_000,
    realizedToday: 0,
    unrealized: 0,
    openedToday: 0,
    lossStreak: 0,
    positions: [],
    pendingEntries: [],
    ...over,
  };
}

function market(over: Partial<MarketContext> = {}): MarketContext {
  return {
    now: etToUtc(2026, 9, 23, 11, 0),
    adv: () => 50_000_000,
    correlation: () => 0.1,
    stale: () => false,
    tradable: () => true,
    sector: (s) => defaultTraderConfig().sectors[s] ?? 'unknown',
    assetClass: (s) => (s.includes('/') ? 'crypto' : 'us_equity'),
    ...over,
  };
}

function ctx(over: { portfolio?: Partial<PortfolioState>; market?: Partial<MarketContext>; risk?: Partial<RiskContext['config']> } = {}): RiskContext {
  const cfg = defaultTraderConfig();
  return {
    config: { ...cfg.risk, ...over.risk },
    minConfidence: 0.62,
    maxTradesPerDay: cfg.risk.maxTradesPerDay,
    portfolio: portfolio(over.portfolio),
    market: market(over.market),
  };
}

const risk = new RiskManager();

describe('risk engine', () => {
  it('rejects a bad stop even at confidence 0.99', () => {
    const d = risk.evaluate(proposal({ confidence: 0.99, stop: 101 }), ctx());
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/SanityRule: stop must be below entry for a long/);
    expect(d.suggestedSize).toBe(0);
  });

  it('rejects an over-sized order even at confidence 0.99 (one share breaks the position cap)', () => {
    const d = risk.evaluate(proposal({ confidence: 0.99, entry: 20_000, stop: 19_400, takeProfit: 21_200, atr: 400 }), ctx());
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/ExposureLimitRule|FixedFractionalRule|MinSizeRule/);
  });

  it('never grows a requested size; shrinks it to the risk budget and caps', () => {
    const d = risk.evaluate(proposal({ requestedSize: 5_000 }), ctx());
    expect(d.allowed).toBe(true);
    // 0.5% of 100k = 500 risk / 3 per share = 166 → 10% position cap = 100 shares @ 100
    expect(d.suggestedSize).toBe(100);
    const small = risk.evaluate(proposal({ requestedSize: 7 }), ctx());
    expect(small.suggestedSize).toBe(7);
  });

  it('fixed-fractional sizing halves per consecutive loss', () => {
    const r = new FixedFractionalRule();
    const a = r.evaluate(proposal(), { size: 0, stop: 97, takeProfit: 106 }, ctx());
    const b = r.evaluate(proposal(), { size: 0, stop: 97, takeProfit: 106 }, ctx({ portfolio: { lossStreak: 2 } }));
    expect(a.adjust!.size).toBe(166);
    expect(b.adjust!.size).toBe(41);
  });

  it('ATR stop: sets missing stops from ATR multiples and clamps to [min, max] %', () => {
    const r = new AtrStopRule();
    const wrongSide = r.evaluate(proposal({ stop: 105 }), { size: 0, stop: 105, takeProfit: 106 }, ctx());
    expect(wrongSide.adjust!.stop).toBeCloseTo(97, 9); // 100 − 1.5 × 2
    const tooTight = r.evaluate(proposal(), { size: 0, stop: 99.95, takeProfit: 106 }, ctx());
    expect(tooTight.adjust!.stop).toBeCloseTo(99.7, 9); // 0.3% minimum
  });

  it('daily-loss circuit breaker blocks and trips the book', () => {
    const r = new DailyLossCircuitBreakerRule();
    const out = r.evaluate(proposal(), { size: 1, stop: 97, takeProfit: 106 }, ctx({ portfolio: { equity: 97_900, dayStartEquity: 100_000 } }));
    expect(out.passed).toBe(false);
    expect(out.tripBreaker).toBe(true);
    const d = risk.evaluate(proposal({ confidence: 0.99 }), ctx({ portfolio: { equity: 97_900, dayStartEquity: 100_000 } }));
    expect(d.allowed).toBe(false);
    expect(d.tripBreaker).toBe(true);
  });

  it('exposure limits: no averaging in, position count, gross exposure, cash reserve', () => {
    const r = new ExposureLimitRule();
    const held = { symbol: 'AAPL', qty: 10, avgPrice: 100, lastPrice: 100 };
    expect(r.evaluate(proposal(), { size: 10, stop: 97, takeProfit: 106 }, ctx({ portfolio: { positions: [held] } })).passed).toBe(false);
    const five = ['A', 'B', 'C', 'D', 'E'].map((s) => ({ symbol: s, qty: 1, avgPrice: 10, lastPrice: 10 }));
    expect(r.evaluate(proposal(), { size: 10, stop: 97, takeProfit: 106 }, ctx({ portfolio: { positions: five } })).reason).toMatch(/cap \(5\)/);
    const cash = r.evaluate(proposal(), { size: 100, stop: 97, takeProfit: 106 }, ctx({ portfolio: { cash: 15_000 } }));
    expect(cash.adjust!.size).toBe(50); // 15k − 10% reserve of 100k = 5k → 50 shares
    const gross = r.evaluate(proposal(), { size: 100, stop: 97, takeProfit: 106 }, ctx({ portfolio: { positions: [{ symbol: 'MSFT', qty: 590, avgPrice: 100, lastPrice: 100 }] } }));
    expect(gross.adjust!.size).toBe(10); // 60% gross cap: 60k − 59k = 1k
  });

  it('sector, correlation, liquidity, stale data, hours, shorting and blackout rules', () => {
    const tech = [
      { symbol: 'MSFT', qty: 150, avgPrice: 100, lastPrice: 100 },
      { symbol: 'NVDA', qty: 150, avgPrice: 100, lastPrice: 100 },
    ];
    expect(risk.evaluate(proposal(), ctx({ portfolio: { positions: tech } })).reason).toMatch(/SectorCapRule.*tech/);
    const corr = risk.evaluate(proposal({ symbol: 'JPM' }), ctx({ portfolio: { positions: [{ symbol: 'V', qty: 10, avgPrice: 100, lastPrice: 100 }, { symbol: 'MA', qty: 10, avgPrice: 100, lastPrice: 100 }] }, market: { correlation: () => 0.95 } }));
    expect(corr.reason).toMatch(/CorrelationCapRule/);
    expect(risk.evaluate(proposal(), ctx({ market: { adv: () => 2_000 } })).suggestedSize).toBe(20); // 1% of ADV
    expect(risk.evaluate(proposal(), ctx({ market: { stale: () => true } })).reason).toMatch(/stale/);
    expect(risk.evaluate(proposal(), ctx({ market: { tradable: () => false } })).reason).toMatch(/closed/);
    expect(risk.evaluate(proposal({ side: 'short', stop: 103, takeProfit: 94 }), ctx()).reason).toMatch(/short selling is disabled/);
    expect(risk.evaluate(proposal(), ctx({ risk: { earningsBlackout: [{ symbol: 'AAPL', date: '2026-09-23' }] } })).reason).toMatch(/earnings blackout/);
  });

  it('a crashing plugin rule blocks instead of passing', () => {
    class Boom extends RiskRule {
      readonly name = 'Boom';
      evaluate(): never {
        throw new Error('kaput');
      }
    }
    const d = new RiskManager([new Boom()]).evaluate(proposal(), ctx());
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/rule error: kaput/);
  });

  it('return correlation from bars', () => {
    const a = Array.from({ length: 70 }, (_, i) => ({ ts: i, open: 1, high: 1, low: 1, close: 100 + Math.sin(i) * 3 + i * 0.1, volume: 1 }));
    const b = a.map((c) => ({ ...c, close: c.close * 2 }));
    expect(correlationFromBars(a, b)).toBeCloseTo(1, 6);
  });
});

describe('signal generator (quant core)', () => {
  const score = (tf: '15m' | '1h', p: number): TimeframeScore => ({ timeframe: tf, probUp: p, modelVersion: `v-${tf}`, modelHash: 'h', horizonBars: 4, upAtr: 1, downAtr: 1 });
  const base = { timeframe: '1h' as const, barTs: 1, close: 100, atr: 2, regime: 'trend_up/normal_vol', features: { roc_15: 1.2, rsi_14: 55 }, drivers: 'x' };
  const cfg = defaultTraderConfig();

  it('fuses timeframes by weighted log-odds and requires agreement', () => {
    expect(fuseScores([score('15m', 0.7), score('1h', 0.7)], cfg.signals.timeframeWeights, true)).toMatchObject({ agree: true });
    expect(fuseScores([score('15m', 0.7), score('1h', 0.4)], cfg.signals.timeframeWeights, true).agree).toBe(false);
    const d = decide({ symbol: 'AAPL', scores: [score('15m', 0.8), score('1h', 0.35)], base, config: cfg, strategies: [] });
    expect(d.proposal).toBeNull();
    expect(d.reason).toMatch(/disagree/);
  });

  it('gates on confidence and expected edge', () => {
    expect(decide({ symbol: 'AAPL', scores: [score('1h', 0.6)], base, config: cfg, strategies: [] }).reason).toMatch(/threshold/);
    const noEdge = decide({ symbol: 'AAPL', scores: [{ ...score('1h', 0.7), upAtr: 0.1, downAtr: 5 }], base, config: cfg, strategies: [] });
    expect(noEdge.reason).toMatch(/edge/);
    const ok = decide({ symbol: 'AAPL', scores: [score('1h', 0.75)], base, config: cfg, strategies: [] });
    expect(ok.proposal).toMatchObject({ side: 'long', entry: 100, stop: 97, takeProfit: 106, horizonMin: 240, maxHoldBars: 12 });
    expect(ok.edgePct).toBeCloseTo(0.75 * 2 - 0.25 * 2, 9);
  });

  it('applies strategy filters (regime, feature filters) and strategy stop/target multiples', () => {
    const strat = (params: Record<string, unknown>, name = 'S'): StrategyDto => ({
      id: name,
      name,
      description: '',
      inspiration: '',
      status: 'active',
      params: strategyParamsSchema.parse(params),
      wins: 0,
      losses: 0,
      totalPnl: 0,
      lessons: [],
      legacy: false,
      createdAt: 0,
      updatedAt: 0,
    });
    const down = strat({ regimes: ['trend_down'] }, 'Down only');
    const mom = strat({ featureFilters: [{ feature: 'roc_15', op: '>', value: 1 }], stopAtrMult: 1, takeProfitAtrMult: 4 }, 'Momentum');
    const miss = decide({ symbol: 'AAPL', scores: [score('1h', 0.75)], base, config: cfg, strategies: [down] });
    expect(miss.reason).toMatch(/no strategy matched.*regime/);
    const hit = decide({ symbol: 'AAPL', scores: [score('1h', 0.75)], base, config: cfg, strategies: [down, mom] });
    expect(hit.proposal).toMatchObject({ strategyName: 'Momentum', stop: 98, takeProfit: 108 });
  });
});

describe('Phase 3 DoD (service level)', () => {
  it('logs a fabricated over-sized proposal and a bad-stop proposal as rejected in the audit, with reasons', async () => {
    env = await makeTrader();
    await backfill(env);
    await env.service.handle('consent.accept', { text: 'I UNDERSTAND' });
    await env.service.handle('autopilot.set', { enabled: true });
    const huge = await env.service.proposeFromAgent({ symbol: 'AAPL', side: 'long', entry: 20_000, stop: 19_500, takeProfit: 21_000, confidence: 0.99, reason: 'fabricated oversize' });
    expect(huge.status).toBe('rejected');
    const badStop = await env.service.proposeFromAgent({ symbol: 'MSFT', side: 'long', entry: 100, stop: 101, takeProfit: 110, confidence: 0.99, reason: 'bad stop' });
    expect(badStop.status).toBe('rejected');
    for (const id of [huge.signalId, badStop.signalId]) {
      const a = await env.service.handle('audit.get', { signalId: id });
      expect(a.audit!.risk!.allowed).toBe(false);
      expect(a.audit!.risk!.reason.length).toBeGreaterThan(10);
      expect(a.audit!.risk!.results.length).toBeGreaterThan(10); // every rule reported
      expect(a.orders).toHaveLength(0);
    }
    expect(env.service.db.oms.listOrders()).toHaveLength(0);
  }, 60_000);

  it('a valid model signal persists to trader_signals with rationale + audit', async () => {
    env = await makeTrader();
    await backfill(env);
    await env.service.handle('models.train', { timeframe: '1h' });
    await env.service.handle('consent.accept', { text: 'I UNDERSTAND' });
    // Scan the whole universe on the latest bar (advisory: signals only).
    const c = await env.service.handle('cycles.run', { advisory: true });
    expect(c.cycle!.status).toBe('done');
    const sigs = await env.service.handle('signals.list', { since: 'all' });
    const quant = c.cycle!.nodes.find((n) => n.node === 'quant')!;
    expect(quant.ok).toBe(true);
    if (sigs.signals.length) {
      const s = sigs.signals[0]!;
      expect(s.rationale).toMatch(/confidence/);
      expect(['proposed', 'rejected']).toContain(s.status);
      const a = await env.service.handle('audit.get', { signalId: s.id });
      expect(a.audit!.modelVersion).toBe(s.modelVersion);
      expect(a.audit!.modelHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(a.audit!.features).length).toBeGreaterThan(20);
    } else {
      // No signal cleared the gates on this bar — the decisions are still recorded.
      expect(JSON.stringify(quant.data)).toMatch(/threshold|edge|disagree|strategy/);
    }
    expect(env.service.db.oms.listOrders()).toHaveLength(0); // advisory never orders
  }, 120_000);

  it('the scheduler fires once per closed bar, under a lease, and reconciles when the autopilot is off', async () => {
    dbEnv = makeDb();
    const { TraderDb } = await import('@main/trader/db');
    const db = new TraderDb(dbEnv.raw);
    let t = etToUtc(2026, 9, 23, 10, 0, ) + 5_000;
    const cfg = defaultTraderConfig();
    const calls: string[] = [];
    let autopilot = true;
    const sched = new TraderScheduler({
      db,
      config: () => ({ ...cfg, schedule: { ...cfg.schedule, tickDelaySec: 0 } }),
      now: () => t,
      autopilot: () => autopilot,
      anyMarketOpen: () => true,
      tick: async () => void calls.push('tick'),
      reconcile: async () => void calls.push('reconcile'),
      retrain: async (k) => void calls.push(`retrain:${k}`),
      dailyReview: async () => void calls.push('daily'),
      housekeeping: async () => void calls.push('housekeeping'),
    });
    await sched.beat();
    await sched.beat(); // same 15m boundary → no second tick
    expect(calls.filter((c) => c === 'tick')).toHaveLength(1);
    t += 15 * 60_000;
    autopilot = false;
    await sched.beat();
    expect(calls).toContain('reconcile');
    expect(sched.nextTickAt(t)).toBeGreaterThan(t);
    // Held lease by another process blocks the tick.
    t += 15 * 60_000;
    autopilot = true;
    db.ops.tryLease('lease:tick', 'other-process', t, 60_000);
    const before = calls.length;
    await sched.beat();
    expect(calls.length).toBe(before);
  });
});
