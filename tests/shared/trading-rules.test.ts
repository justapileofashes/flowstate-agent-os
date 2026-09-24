import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GUARDRAILS,
  evaluateTradeIntent,
  sanitizeGuardrails,
  type AccountSnapshot,
  type DayStats,
  type TradeIntent,
} from '@shared/trading-rules';

const account = (over: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  equity: 10_000,
  cash: 10_000,
  openPositions: 0,
  heldSymbols: [],
  ...over,
});

const day = (over: Partial<DayStats> = {}): DayStats => ({
  realizedPnlToday: 0,
  tradesOpenedToday: 0,
  consecutiveLosses: 0,
  ...over,
});

const intent = (over: Partial<TradeIntent> = {}): TradeIntent => ({
  symbol: 'AAPL',
  side: 'buy',
  qty: 100,
  entry: 100,
  stoploss: 98,
  confidence: 0.7,
  ...over,
});

describe('evaluateTradeIntent — sizing', () => {
  it('clamps qty to the risk budget (1% of 10k = $100 / $2 risk = 50 shares)', () => {
    const v = evaluateTradeIntent(intent(), account(), DEFAULT_GUARDRAILS, day());
    expect(v.allowed).toBe(true);
    expect(v.qty).toBe(20); // risk allows 50 but the 20% notional cap wins
    expect(v.notional).toBe(2000);
  });

  it('clamps to the max position % of equity', () => {
    // tight stop → risk budget alone would allow more notional than the 20% cap
    const v = evaluateTradeIntent(
      intent({ entry: 10, stoploss: 9.9, qty: 10_000 }),
      account(),
      DEFAULT_GUARDRAILS,
      day(),
    );
    expect(v.allowed).toBe(true);
    // 20% of 10k = $2000 → 200 shares at $10
    expect(v.qty).toBe(200);
  });

  it('never deploys the cash reserve', () => {
    const rules = { ...DEFAULT_GUARDRAILS, maxPositionPct: 25, riskPctPerTrade: 5, cashReservePct: 20 };
    const v = evaluateTradeIntent(
      intent({ entry: 100, stoploss: 50, qty: 1000 }),
      account({ equity: 1000, cash: 1000 }),
      rules,
      day(),
    );
    // deployable = 1000 - 200 reserve = 800 → but 25% notional cap = 250 → 2 shares
    expect(v.allowed).toBe(true);
    expect(v.notional).toBeLessThanOrEqual(800);
  });

  it('respects the caller qty when smaller than every cap', () => {
    const v = evaluateTradeIntent(intent({ qty: 3 }), account(), DEFAULT_GUARDRAILS, day());
    expect(v.qty).toBe(3);
  });

  it('blocks when size rounds to zero', () => {
    const v = evaluateTradeIntent(
      intent({ entry: 100_000, stoploss: 50_000 }),
      account({ equity: 100, cash: 100 }),
      DEFAULT_GUARDRAILS,
      day(),
    );
    expect(v.allowed).toBe(false);
    expect(v.blocked.join(' ')).toMatch(/zero/);
  });
});

describe('evaluateTradeIntent — hard blocks', () => {
  it('blocks low confidence', () => {
    const v = evaluateTradeIntent(intent({ confidence: 0.3 }), account(), DEFAULT_GUARDRAILS, day());
    expect(v.allowed).toBe(false);
    expect(v.blocked.join(' ')).toMatch(/confidence/);
  });

  it('blocks when already holding the symbol', () => {
    const v = evaluateTradeIntent(
      intent(),
      account({ heldSymbols: ['aapl'] }),
      DEFAULT_GUARDRAILS,
      day(),
    );
    expect(v.allowed).toBe(false);
    expect(v.blocked.join(' ')).toMatch(/already holding/);
  });

  it('blocks at the open-position cap', () => {
    const v = evaluateTradeIntent(
      intent(),
      account({ openPositions: DEFAULT_GUARDRAILS.maxOpenPositions }),
      DEFAULT_GUARDRAILS,
      day(),
    );
    expect(v.allowed).toBe(false);
  });

  it('blocks after the daily trade cap', () => {
    const v = evaluateTradeIntent(
      intent(),
      account(),
      DEFAULT_GUARDRAILS,
      day({ tradesOpenedToday: DEFAULT_GUARDRAILS.maxTradesPerDay }),
    );
    expect(v.allowed).toBe(false);
  });

  it('halts on the daily loss limit', () => {
    const v = evaluateTradeIntent(
      intent(),
      account(),
      DEFAULT_GUARDRAILS,
      day({ realizedPnlToday: -300 }), // 3% of 10k > 2% limit
    );
    expect(v.allowed).toBe(false);
    expect(v.blocked.join(' ')).toMatch(/daily loss/);
  });

  it('cools down after a loss streak', () => {
    const v = evaluateTradeIntent(
      intent(),
      account(),
      DEFAULT_GUARDRAILS,
      day({ consecutiveLosses: 3 }),
    );
    expect(v.allowed).toBe(false);
    expect(v.blocked.join(' ')).toMatch(/consecutive losses/);
  });

  it('rejects a long whose stop is above entry', () => {
    const v = evaluateTradeIntent(intent({ stoploss: 105 }), account(), DEFAULT_GUARDRAILS, day());
    expect(v.allowed).toBe(false);
  });

  it('rejects a short whose stop is below entry', () => {
    const v = evaluateTradeIntent(
      intent({ side: 'sell', stoploss: 95 }),
      account(),
      DEFAULT_GUARDRAILS,
      day(),
    );
    expect(v.allowed).toBe(false);
  });

  it('collects multiple blocks at once', () => {
    const v = evaluateTradeIntent(
      intent({ confidence: 0.1 }),
      account({ openPositions: 99 }),
      DEFAULT_GUARDRAILS,
      day({ consecutiveLosses: 5 }),
    );
    expect(v.allowed).toBe(false);
    expect(v.blocked.length).toBeGreaterThanOrEqual(3);
  });
});

describe('sanitizeGuardrails', () => {
  it('returns defaults for undefined', () => {
    expect(sanitizeGuardrails(undefined)).toEqual(DEFAULT_GUARDRAILS);
  });

  it('clamps out-of-range values into bounds', () => {
    const g = sanitizeGuardrails({
      maxPositionPct: 500,
      riskPctPerTrade: -3,
      maxDailyLossPct: 99,
      maxOpenPositions: 0,
      minConfidence: 2,
    });
    expect(g.maxPositionPct).toBe(50);
    expect(g.riskPctPerTrade).toBe(0.1);
    expect(g.maxDailyLossPct).toBe(10);
    expect(g.maxOpenPositions).toBe(1);
    expect(g.minConfidence).toBe(0.95);
  });

  it('ignores junk types', () => {
    const g = sanitizeGuardrails({ maxPositionPct: 'lots' as unknown as number });
    expect(g.maxPositionPct).toBe(DEFAULT_GUARDRAILS.maxPositionPct);
  });
});
