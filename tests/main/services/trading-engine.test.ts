import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '@main/db/database';
import { TradingStore } from '@main/services/trading-store';
import {
  TradingEngine,
  SEED_STRATEGIES,
  shouldRetireStrategy,
  writePostMortem,
  type BrokerLike,
} from '@main/services/trading-engine';
import type { AlpacaOrder, AlpacaPosition } from '@main/services/alpaca-client';
import type { StockAnalysis } from '@main/services/stock-analysis';
import { DEFAULT_GUARDRAILS } from '@shared/trading-rules';

let dir: string;
let db: Database;
let store: TradingStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-engine-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  store = new TradingStore(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── Fakes ────────────────────────────────────────────────────────────────────

interface FakeBrokerState {
  isPaper?: boolean;
  isOpen?: boolean;
  equity?: number;
  cash?: number;
  tradingBlocked?: boolean;
  positions?: AlpacaPosition[];
  closedOrders?: AlpacaOrder[];
}

function fakeBroker(state: FakeBrokerState = {}) {
  const placed: Array<{ symbol: string; qty: number; side: string; takeProfit: number; stopLoss: number }> = [];
  const broker: BrokerLike = {
    isPaper: state.isPaper ?? true,
    getAccount: async () => ({
      id: 'a',
      status: 'ACTIVE',
      currency: 'USD',
      equity: state.equity ?? 10_000,
      cash: state.cash ?? 10_000,
      buyingPower: (state.cash ?? 10_000) * 2,
      portfolioValue: state.equity ?? 10_000,
      daytradeCount: 0,
      tradingBlocked: state.tradingBlocked ?? false,
    }),
    getClock: async () => ({
      isOpen: state.isOpen ?? true,
      timestamp: '',
      nextOpen: '',
      nextClose: '',
    }),
    getPositions: async () => state.positions ?? [],
    getOrders: async () => state.closedOrders ?? [],
    placeBracketOrder: async (req) => {
      placed.push({ symbol: req.symbol, qty: req.qty, side: req.side, takeProfit: req.takeProfit, stopLoss: req.stopLoss });
      return order({ id: `o-${placed.length}`, symbol: req.symbol, qty: req.qty });
    },
    closePosition: async (symbol) => order({ id: 'close', symbol }),
  };
  return { broker, placed };
}

function order(over: Partial<AlpacaOrder> = {}): AlpacaOrder {
  return {
    id: 'o1',
    clientOrderId: '',
    symbol: 'AAPL',
    qty: 10,
    filledQty: 10,
    side: 'buy',
    type: 'market',
    status: 'filled',
    limitPrice: null,
    stopPrice: null,
    filledAvgPrice: 100,
    submittedAt: new Date().toISOString(),
    filledAt: new Date().toISOString(),
    legs: [],
    ...over,
  };
}

function analysis(over: Partial<StockAnalysis> = {}): StockAnalysis {
  return {
    symbol: 'AAPL',
    range: '1y',
    asOf: new Date().toISOString(),
    price: 100,
    direction: 'buy',
    confidence: 0.75,
    factors: [
      { key: 'trend', score: 0.7, weight: 2, note: 'trend up' },
      { key: 'momentum', score: 0.4, weight: 2, note: 'rsi 62' },
      { key: 'volume', score: 0.3, weight: 1, note: 'above avg' },
      { key: 'levels', score: 0.3, weight: 1, note: 'near support' },
    ],
    entry: 100,
    stoploss: 97,
    takeProfit: [103, 106, 109],
    rewardRisk: 3,
    forecast: { bull: [], base: [], bear: [] },
    patterns: [],
    rsi: 62,
    macdHistogram: 0.5,
    chartHtml: '',
    ...over,
  } as StockAnalysis;
}

function makeEngine(opts: {
  broker: BrokerLike;
  watchlist?: string[];
  analyze?: (symbol: string) => Promise<StockAnalysis>;
  liveAck?: boolean;
}) {
  return new TradingEngine({
    broker: opts.broker,
    store,
    analyze: opts.analyze ?? (async (symbol) => analysis({ symbol })),
    getGuardrails: () => DEFAULT_GUARDRAILS,
    getWatchlist: () => opts.watchlist ?? ['AAPL'],
    getLiveAck: () => opts.liveAck ?? false,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TradingEngine — strategy seeding + matching', () => {
  it('seeds the built-in strategies once', async () => {
    const { broker } = fakeBroker({ isOpen: false });
    const engine = makeEngine({ broker, watchlist: [] });
    await engine.runCycle();
    await engine.runCycle();
    expect(store.listStrategies()).toHaveLength(SEED_STRATEGIES.length);
  });

  it('matchStrategy rejects sell/hold signals and low confidence', () => {
    const { broker } = fakeBroker();
    const engine = makeEngine({ broker });
    engine.seedStrategies();
    const [s] = store.listStrategies('active');
    expect(engine.matchStrategy(analysis({ direction: 'hold' }), s!).ok).toBe(false);
    expect(engine.matchStrategy(analysis({ confidence: 0.2 }), s!).ok).toBe(false);
    expect(engine.matchStrategy(analysis(), s!).ok).toBe(true);
  });
});

describe('TradingEngine — autonomous cycle', () => {
  it('opens a risk-sized bracket order and journals it', async () => {
    const { broker, placed } = fakeBroker();
    const engine = makeEngine({ broker });
    const report = await engine.runCycle();
    expect(report.opened).toHaveLength(1);
    expect(placed).toHaveLength(1);
    // 1% risk of 10k = $100 / $3 risk per share = 33 shares,
    // then the 20% notional cap (=$2000 at $100) clamps to 20.
    expect(placed[0]!.qty).toBe(20);
    expect(placed[0]!.stopLoss).toBe(97);
    const journal = store.openTrades();
    expect(journal).toHaveLength(1);
    expect(journal[0]!.strategyId).toBeTruthy();
    expect(JSON.parse(journal[0]!.rationale).strategy).toBeTruthy();
  });

  it('does nothing when the market is closed', async () => {
    const { broker, placed } = fakeBroker({ isOpen: false });
    const report = await makeEngine({ broker }).runCycle();
    expect(report.halted).toMatch(/market closed/);
    expect(placed).toHaveLength(0);
  });

  it('halts when the account is blocked', async () => {
    const { broker } = fakeBroker({ tradingBlocked: true });
    const report = await makeEngine({ broker }).runCycle();
    expect(report.halted).toMatch(/blocked/);
  });

  it('skips symbols already held', async () => {
    const { broker, placed } = fakeBroker({
      positions: [
        { symbol: 'AAPL', qty: 5, side: 'long', avgEntryPrice: 90, currentPrice: 100, marketValue: 500, unrealizedPl: 50, unrealizedPlPct: 11 },
      ],
    });
    const report = await makeEngine({ broker }).runCycle();
    expect(placed).toHaveLength(0);
    expect(report.skipped[0]!.reason).toMatch(/already holding/);
  });

  it('skips hold signals with per-strategy reasons', async () => {
    const { broker, placed } = fakeBroker();
    const report = await makeEngine({
      broker,
      analyze: async (s) => analysis({ symbol: s, direction: 'hold' }),
    }).runCycle();
    expect(placed).toHaveLength(0);
    expect(report.skipped[0]!.reason).toMatch(/signal is hold/);
  });

  it('halts for the day after the daily loss limit', async () => {
    // Book a big loss today: -3% of 10k equity.
    const t = store.openTrade({ symbol: 'MSFT', side: 'buy', qty: 10, entryPrice: 100, stoploss: 60, takeProfit: 130, rationale: '{}', paper: true });
    store.closeTrade(t.id, 70); // -300
    const { broker, placed } = fakeBroker();
    const report = await makeEngine({ broker }).runCycle();
    expect(report.halted).toMatch(/daily loss/);
    expect(placed).toHaveLength(0);
  });

  it('refuses to trade live without the explicit acknowledgement', async () => {
    const { broker, placed } = fakeBroker({ isPaper: false });
    const report = await makeEngine({ broker, liveAck: false }).runCycle();
    expect(placed).toHaveLength(0);
    expect(report.skipped[0]!.reason).toMatch(/live trading not acknowledged/);
  });

  it('trades at most one new position per symbol and respects position caps', async () => {
    const { broker, placed } = fakeBroker();
    const engine = makeEngine({ broker, watchlist: ['AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'GOOG', 'META'] });
    const report = await engine.runCycle();
    // maxOpenPositions default 5 — the rest must be skipped, not ordered.
    expect(placed.length).toBeLessThanOrEqual(DEFAULT_GUARDRAILS.maxOpenPositions);
    expect(report.opened.length + report.skipped.length).toBe(7);
  });
});

describe('TradingEngine — learning loop', () => {
  it('closes journal trades whose position disappeared, writes a post-mortem, and updates strategy stats', async () => {
    const engine = makeEngine({ broker: fakeBroker().broker });
    engine.seedStrategies();
    const strategy = store.listStrategies('active')[0]!;
    const t = store.openTrade({
      symbol: 'AAPL', side: 'buy', qty: 33, entryPrice: 100, stoploss: 97, takeProfit: 109,
      strategyId: strategy.id,
      rationale: JSON.stringify({ confidence: 0.6, factors: [{ key: 'trend', score: -0.5, weight: 2, note: 'trend down' }] }),
      alpacaOrderId: 'parent-1', paper: true,
    });
    // Broker: position gone; parent order filled; stop leg filled at 97.
    const { broker } = fakeBroker({
      isOpen: false,
      closedOrders: [
        order({
          id: 'parent-1', symbol: 'AAPL', filledQty: 33, filledAvgPrice: 100,
          legs: [order({ id: 'sl', side: 'sell', filledQty: 33, filledAvgPrice: 97, type: 'stop' })],
        }),
      ],
    });
    const report = await makeEngine({ broker }).runCycle();
    expect(report.closed).toHaveLength(1);
    expect(report.closed[0]!.outcome).toBe('loss');
    const closed = store.getTrade(t.id)!;
    expect(closed.status).toBe('closed');
    expect(closed.review).toMatch(/stopped out/);
    expect(closed.review).toMatch(/against a non-up trend/);
    const s = store.getStrategy(strategy.id)!;
    expect(s.losses).toBe(1);
    expect(s.lessons.length).toBe(1);
  });

  it('cancels journal trades whose entry never filled', async () => {
    const t = store.openTrade({
      symbol: 'AAPL', side: 'buy', qty: 5, entryPrice: 100, stoploss: 97, takeProfit: 109,
      rationale: '{}', alpacaOrderId: 'parent-2', paper: true,
    });
    const { broker } = fakeBroker({
      isOpen: false,
      closedOrders: [order({ id: 'parent-2', filledQty: 0, filledAvgPrice: null, status: 'canceled' })],
    });
    await makeEngine({ broker }).runCycle();
    expect(store.getTrade(t.id)!.status).toBe('canceled');
  });

  it('cools down after a loss streak', async () => {
    for (let i = 0; i < 3; i++) {
      const t = store.openTrade({ symbol: `S${i}`, side: 'buy', qty: 1, entryPrice: 100, stoploss: 99, takeProfit: 102, rationale: '{}', paper: true });
      store.closeTrade(t.id, 99.5);
    }
    const { broker, placed } = fakeBroker({ equity: 1_000_000, cash: 1_000_000 });
    const report = await makeEngine({ broker }).runCycle();
    expect(report.halted).toMatch(/consecutive losses/);
    expect(placed).toHaveLength(0);
  });
});

describe('post-mortem + retirement rules', () => {
  it('writePostMortem names counter-trend, low-confidence, and tight-stop mistakes', () => {
    const trade = {
      id: 't', symbol: 'AAPL', side: 'buy' as const, qty: 10, entryPrice: 100, stoploss: 99.2,
      takeProfit: 104, exitPrice: null, status: 'open' as const, outcome: null, pnl: null,
      strategyId: null,
      rationale: JSON.stringify({ confidence: 0.58, factors: [{ key: 'trend', score: -0.7, weight: 2, note: 'down' }, { key: 'momentum', score: -0.2, weight: 2, note: '' }] }),
      review: null, alpacaOrderId: null, paper: true, openedAt: 0, closedAt: null,
    };
    const review = writePostMortem(trade, 99.2);
    expect(review).toMatch(/stopped out/);
    expect(review).toMatch(/non-up trend/);
    expect(review).toMatch(/modest confidence/);
    expect(review).toMatch(/stop under 1.5%/);
    expect(review).toMatch(/momentum was negative/);
  });

  it('writePostMortem records wins as keepers', () => {
    const trade = {
      id: 't', symbol: 'AAPL', side: 'buy' as const, qty: 10, entryPrice: 100, stoploss: 97,
      takeProfit: 106, exitPrice: null, status: 'open' as const, outcome: null, pnl: null,
      strategyId: null, rationale: '{}', review: null, alpacaOrderId: null, paper: true, openedAt: 0, closedAt: null,
    };
    expect(writePostMortem(trade, 106)).toMatch(/^WIN/);
  });

  it('shouldRetireStrategy requires evidence and negative expectancy', () => {
    const base = {
      id: 's', name: 'S', description: '', inspiration: '', status: 'active' as const,
      params: { minConfidence: 0.6, requireTrend: 'any' as const, minFactorScores: {}, takeProfitR: 2, stopAtrMult: 1.5 },
      lessons: [], createdAt: 0, updatedAt: 0,
    };
    expect(shouldRetireStrategy({ ...base, wins: 1, losses: 3, totalPnl: -100 })).toBe(false); // too few
    expect(shouldRetireStrategy({ ...base, wins: 2, losses: 8, totalPnl: -400 })).toBe(true);
    expect(shouldRetireStrategy({ ...base, wins: 2, losses: 8, totalPnl: 50 })).toBe(false); // profitable net
    expect(shouldRetireStrategy({ ...base, wins: 6, losses: 4, totalPnl: -10 })).toBe(false); // decent win rate
  });
});
