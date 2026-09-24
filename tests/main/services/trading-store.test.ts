import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '@main/db/database';
import { TradingStore, sanitizeStrategyParams } from '@main/services/trading-store';

let dir: string;
let db: Database;
let store: TradingStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-trading-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  store = new TradingStore(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const openTrade = (over: Partial<Parameters<TradingStore['openTrade']>[0]> = {}) =>
  store.openTrade({
    symbol: 'aapl',
    side: 'buy',
    qty: 10,
    entryPrice: 100,
    stoploss: 97,
    takeProfit: 106,
    rationale: '{"confidence":0.7}',
    paper: true,
    ...over,
  });

describe('TradingStore — strategies', () => {
  it('creates and lists strategies with sanitized params', () => {
    const s = store.createStrategy({
      name: 'Trend',
      inspiration: 'Turtles',
      params: { minConfidence: 5, requireTrend: 'up', takeProfitR: 3 },
    });
    expect(s.params.minConfidence).toBe(0.95); // clamped
    expect(s.params.requireTrend).toBe('up');
    expect(store.listStrategies()).toHaveLength(1);
    expect(store.listStrategies('active')).toHaveLength(1);
  });

  it('records results and accumulates stats + lessons', () => {
    const s = store.createStrategy({ name: 'S' });
    store.recordStrategyResult(s.id, 'loss', -50, 'stop too tight');
    store.recordStrategyResult(s.id, 'win', 120);
    const after = store.getStrategy(s.id)!;
    expect(after.wins).toBe(1);
    expect(after.losses).toBe(1);
    expect(after.totalPnl).toBe(70);
    expect(after.lessons).toEqual(['stop too tight']);
  });

  it('retires strategies', () => {
    const s = store.createStrategy({ name: 'S' });
    store.setStrategyStatus(s.id, 'retired');
    expect(store.listStrategies('active')).toHaveLength(0);
    expect(store.getStrategy(s.id)!.status).toBe('retired');
  });
});

describe('TradingStore — trades + journal', () => {
  it('opens uppercase and closes with computed pnl + outcome', () => {
    const t = openTrade();
    expect(t.symbol).toBe('AAPL');
    expect(t.status).toBe('open');
    const closed = store.closeTrade(t.id, 106, 'took profit')!;
    expect(closed.pnl).toBe(60);
    expect(closed.outcome).toBe('win');
    expect(closed.review).toBe('took profit');
    expect(store.openTrades()).toHaveLength(0);
  });

  it('computes loss outcome for a losing long and win for a winning short', () => {
    const long = openTrade();
    expect(store.closeTrade(long.id, 97)!.outcome).toBe('loss');
    const short = openTrade({ symbol: 'MSFT', side: 'sell', stoploss: 103 });
    const closed = store.closeTrade(short.id, 95)!;
    expect(closed.outcome).toBe('win');
    expect(closed.pnl).toBe(50);
  });

  it('closeTrade is idempotent-safe (second close returns null)', () => {
    const t = openTrade();
    store.closeTrade(t.id, 100);
    expect(store.closeTrade(t.id, 90)).toBeNull();
  });

  it('cancelTrade marks without pnl', () => {
    const t = openTrade();
    store.cancelTrade(t.id, 'never filled');
    const after = store.getTrade(t.id)!;
    expect(after.status).toBe('canceled');
    expect(after.pnl).toBeNull();
  });

  it('dayStats aggregates today pnl, opens, and the loss streak', () => {
    const a = openTrade();
    const b = openTrade({ symbol: 'MSFT' });
    const c = openTrade({ symbol: 'NVDA' });
    store.closeTrade(a.id, 110); // +100 win
    store.closeTrade(b.id, 99); // -10 loss
    store.closeTrade(c.id, 98); // -20 loss (most recent)
    const stats = store.dayStats();
    expect(stats.realizedPnlToday).toBe(70);
    expect(stats.tradesOpenedToday).toBe(3);
    expect(stats.consecutiveLosses).toBe(2);
  });

  it('recentLessons returns reviews of losing trades only', () => {
    const w = openTrade();
    store.closeTrade(w.id, 120, 'win note');
    const l = openTrade({ symbol: 'MSFT' });
    store.closeTrade(l.id, 90, 'lesson: counter-trend');
    expect(store.recentLessons()).toEqual(['lesson: counter-trend']);
  });
});

describe('sanitizeStrategyParams', () => {
  it('defaults on junk and clamps factor scores', () => {
    const p = sanitizeStrategyParams({ minFactorScores: { momentum: 9, junk: 'x' }, requireTrend: 'sideways' });
    expect(p.minFactorScores.momentum).toBe(1);
    expect(p.minFactorScores.junk).toBeUndefined();
    expect(p.requireTrend).toBe('any');
  });
});
