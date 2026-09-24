// The autonomous trading engine. One runCycle() per tick:
//
//   1. sync   — reconcile the journal with the broker (detect fills/exits)
//   2. learn  — post-mortem every newly closed trade, update strategy stats,
//               retire strategies with negative expectancy
//   3. scan   — analyze the watchlist with the active strategies
//   4. gate   — every intent passes evaluateTradeIntent (shared guardrails)
//   5. act    — place bracket orders (entry + stoploss + take-profit atomic)
//
// The engine is long-only on autopilot, paper-mode by default, and refuses to
// touch a live account unless the explicit live acknowledgement is set.
// Broker + analyzer are injected so the whole loop is unit-testable.
import type {
  AlpacaAccount,
  AlpacaClock,
  AlpacaOrder,
  AlpacaPosition,
  BracketOrderRequest,
} from './alpaca-client';
import type { StockAnalysis } from './stock-analysis';
import type { StrategyRow, TradeRow, TradingStore } from './trading-store';
import {
  evaluateTradeIntent,
  type RiskVerdict,
  type TradeIntent,
  type TradingGuardrails,
} from '@shared/trading-rules';

export interface BrokerLike {
  readonly isPaper: boolean;
  getAccount(): Promise<AlpacaAccount>;
  getClock(): Promise<AlpacaClock>;
  getPositions(): Promise<AlpacaPosition[]>;
  getOrders(status?: 'open' | 'closed' | 'all', limit?: number): Promise<AlpacaOrder[]>;
  placeBracketOrder(req: BracketOrderRequest): Promise<AlpacaOrder>;
  closePosition(symbol: string): Promise<AlpacaOrder>;
}

export type Analyzer = (symbol: string) => Promise<StockAnalysis>;

export interface TradingEngineDeps {
  broker: BrokerLike;
  store: TradingStore;
  analyze: Analyzer;
  getGuardrails: () => TradingGuardrails;
  getWatchlist: () => string[];
  /** Must return true before the engine will trade a LIVE (non-paper) account. */
  getLiveAck: () => boolean;
  log?: (msg: string) => void;
}

export interface CycleReport {
  ranAt: string;
  marketOpen: boolean;
  halted: string | null;
  closed: Array<{ symbol: string; pnl: number; outcome: string; review: string }>;
  opened: Array<{ symbol: string; qty: number; entry: number; strategy: string }>;
  skipped: Array<{ symbol: string; reason: string }>;
  errors: string[];
}

/** Built-in strategy library, seeded once. Each encodes principles that the
 *  most successful traders repeat in their own words: trade with the trend
 *  (Livermore, Dennis' Turtles), buy strength on volume (O'Neil, Zanger,
 *  Minervini), buy pullbacks near support in an uptrend (Tudor Jones' 200-day
 *  rule, Raschke) — and, common to all of them, cut losses mechanically. */
export const SEED_STRATEGIES: Array<{
  name: string;
  description: string;
  inspiration: string;
  params: Record<string, unknown>;
}> = [
  {
    name: 'Trend Rider',
    description:
      'Only trade in the direction of the established trend, enter on strength, exit mechanically at the stop. No counter-trend entries, ever.',
    inspiration:
      'Jesse Livermore ("the big money is in the big swing"), Richard Dennis & the Turtles (rule-based trend following, fixed-fraction risk), Ed Seykota (ride winners, cut losers).',
    params: { minConfidence: 0.62, requireTrend: 'up', minFactorScores: { trend: 0.3 }, takeProfitR: 3, stopAtrMult: 1.5 },
  },
  {
    name: 'Momentum Breakout',
    description:
      'Buy momentum confirmed by volume: rising RSI/MACD with above-average volume. Take profit quicker (2R) — breakouts fail fast when volume dries up.',
    inspiration:
      "William O'Neil (CANSLIM: price strength + volume confirmation), Dan Zanger (volume-confirmed breakouts), Mark Minervini (momentum with tight risk).",
    params: { minConfidence: 0.6, requireTrend: 'any', minFactorScores: { momentum: 0.2, volume: 0.1 }, takeProfitR: 2, stopAtrMult: 1.5 },
  },
  {
    name: 'Pullback to Support',
    description:
      'In a non-bearish market, buy near tested support with a stop just beyond it. Asymmetric bets only: small defined risk, larger target.',
    inspiration:
      'Paul Tudor Jones (asymmetric risk/reward, "losers average losers"), Linda Raschke (buy the first pullback), classic support/resistance discipline.',
    params: { minConfidence: 0.58, requireTrend: 'any', minFactorScores: { levels: 0.2 }, takeProfitR: 2.5, stopAtrMult: 1.2 },
  },
];

/** Retire a strategy once it has proven negative expectancy. */
export function shouldRetireStrategy(s: StrategyRow): boolean {
  const total = s.wins + s.losses;
  if (total < 8) return false; // not enough evidence yet
  const winRate = s.wins / total;
  return winRate < 0.4 && s.totalPnl < 0;
}

interface RationaleSnapshot {
  confidence: number;
  direction: string;
  factors: Array<{ key: string; score: number; weight: number; note: string }>;
  stopDistancePct: number;
  strategy: string | null;
  riskNotes: string[];
}

/** Deterministic post-mortem: reads the entry rationale back and names the
 *  most likely mistake. These strings feed strategy lessons and the agent's
 *  prompt context — the "learn from what went wrong" loop. */
export function writePostMortem(trade: TradeRow, exitPrice: number): string {
  let snap: Partial<RationaleSnapshot> = {};
  try {
    snap = JSON.parse(trade.rationale) as RationaleSnapshot;
  } catch {
    /* legacy/agent trades may lack a snapshot */
  }
  const pnl = (exitPrice - trade.entryPrice) * trade.qty * (trade.side === 'buy' ? 1 : -1);
  if (pnl >= 0) {
    return `WIN +${pnl.toFixed(2)}: plan executed — entry ${trade.entryPrice.toFixed(2)}, exit ${exitPrice.toFixed(2)}. Keep: same setup, same sizing.`;
  }
  const notes: string[] = [`LOSS ${pnl.toFixed(2)} on ${trade.symbol}`];
  const stoppedOut =
    trade.side === 'buy' ? exitPrice <= trade.stoploss * 1.01 : exitPrice >= trade.stoploss * 0.99;
  if (stoppedOut) notes.push('stopped out at the planned stop (risk control worked — the read was wrong, not the exit)');
  const trendFactor = snap.factors?.find((f) => f.key === 'trend');
  if (trendFactor && trendFactor.score <= 0 && trade.side === 'buy') {
    notes.push('mistake: long against a non-up trend — require trend alignment next time');
  }
  if (typeof snap.confidence === 'number' && snap.confidence < 0.65) {
    notes.push(`mistake: entered at modest confidence ${snap.confidence.toFixed(2)} — raise the bar after losses`);
  }
  const stopPct = Math.abs(trade.entryPrice - trade.stoploss) / trade.entryPrice;
  if (stopPct < 0.015) {
    notes.push('mistake: stop under 1.5% of price — inside normal noise; widen the stop or skip the trade');
  }
  const momFactor = snap.factors?.find((f) => f.key === 'momentum');
  if (momFactor && momFactor.score < 0) {
    notes.push('mistake: momentum was negative at entry — wait for confirmation');
  }
  if (notes.length === 1) notes.push('no single factor at fault — likely market-wide move; check correlation before adding exposure');
  return notes.join('; ');
}

export class TradingEngine {
  constructor(private readonly deps: TradingEngineDeps) {}

  private log(msg: string): void {
    this.deps.log?.(`[trading] ${msg}`);
  }

  /** Seed the built-in strategy library on first run. */
  seedStrategies(): void {
    if (this.deps.store.listStrategies().length > 0) return;
    for (const s of SEED_STRATEGIES) this.deps.store.createStrategy(s);
    this.log(`seeded ${SEED_STRATEGIES.length} strategies`);
  }

  /** Does this analysis satisfy a strategy's entry rules? */
  matchStrategy(analysis: StockAnalysis, s: StrategyRow): { ok: boolean; why: string } {
    if (analysis.direction !== 'buy') return { ok: false, why: `signal is ${analysis.direction}` };
    if (analysis.confidence < s.params.minConfidence) {
      return { ok: false, why: `confidence ${analysis.confidence.toFixed(2)} < ${s.params.minConfidence}` };
    }
    const factor = (key: string): number => analysis.factors.find((f) => f.key === key)?.score ?? 0;
    if (s.params.requireTrend === 'up' && factor('trend') <= 0) {
      return { ok: false, why: 'trend not up' };
    }
    if (s.params.requireTrend === 'down' && factor('trend') >= 0) {
      return { ok: false, why: 'trend not down' };
    }
    for (const [key, min] of Object.entries(s.params.minFactorScores)) {
      if (factor(key) < min) return { ok: false, why: `${key} ${factor(key).toFixed(2)} < ${min}` };
    }
    return { ok: true, why: 'all entry rules met' };
  }

  /** Pick the take-profit closest to the strategy's R preference. */
  private pickTakeProfit(analysis: StockAnalysis, s: StrategyRow): number {
    const idx = Math.min(
      analysis.takeProfit.length - 1,
      Math.max(0, Math.round(s.params.takeProfitR) - 1),
    );
    return analysis.takeProfit[idx] ?? analysis.takeProfit[analysis.takeProfit.length - 1]!;
  }

  /** Shared execution path (autopilot + agent tool): gate → order → journal. */
  async executeIntent(input: {
    intent: TradeIntent;
    takeProfit: number;
    rationale: RationaleSnapshot;
    account: { equity: number; cash: number };
    positions: AlpacaPosition[];
  }): Promise<{ verdict: RiskVerdict; trade: TradeRow | null }> {
    if (!this.deps.broker.isPaper && !this.deps.getLiveAck()) {
      return {
        verdict: {
          allowed: false,
          qty: 0,
          notional: 0,
          blocked: ['live trading not acknowledged — enable paper mode or confirm live trading in Settings'],
          reasons: [],
        },
        trade: null,
      };
    }
    const rules = this.deps.getGuardrails();
    const day = this.deps.store.dayStats();
    const verdict = evaluateTradeIntent(
      input.intent,
      {
        equity: input.account.equity,
        cash: input.account.cash,
        openPositions: input.positions.length,
        heldSymbols: input.positions.map((p) => p.symbol),
      },
      rules,
      day,
    );
    if (!verdict.allowed) return { verdict, trade: null };

    const order = await this.deps.broker.placeBracketOrder({
      symbol: input.intent.symbol,
      qty: verdict.qty,
      side: input.intent.side,
      takeProfit: input.takeProfit,
      stopLoss: input.intent.stoploss,
    });
    const trade = this.deps.store.openTrade({
      symbol: input.intent.symbol,
      side: input.intent.side,
      qty: verdict.qty,
      entryPrice: input.intent.entry,
      stoploss: input.intent.stoploss,
      takeProfit: input.takeProfit,
      ...(input.intent.strategyId ? { strategyId: input.intent.strategyId } : {}),
      rationale: JSON.stringify({ ...input.rationale, riskNotes: verdict.reasons }),
      alpacaOrderId: order.id,
      paper: this.deps.broker.isPaper,
    });
    this.log(`opened ${input.intent.symbol} x${verdict.qty} (order ${order.id})`);
    return { verdict, trade };
  }

  /** Reconcile open journal trades with broker state; post-mortem the closed. */
  private async sync(positions: AlpacaPosition[], report: CycleReport): Promise<void> {
    const open = this.deps.store.openTrades();
    if (open.length === 0) return;
    const held = new Set(positions.map((p) => p.symbol.toUpperCase()));
    let orders: AlpacaOrder[] | null = null;
    for (const t of open) {
      if (held.has(t.symbol.toUpperCase())) continue; // still on
      orders ??= await this.deps.broker.getOrders('closed', 200);
      const parent = t.alpacaOrderId ? orders.find((o) => o.id === t.alpacaOrderId) : undefined;
      const entryFilled = parent ? parent.filledQty > 0 : true;
      if (!entryFilled) {
        // Entry never executed (canceled/expired) — not a real trade.
        this.deps.store.cancelTrade(t.id, 'entry order never filled');
        continue;
      }
      // Use the actual entry fill when available so P&L (and lessons) are honest.
      const realEntry = parent?.filledAvgPrice ?? t.entryPrice;
      const exitLeg = parent?.legs.find((l) => l.filledQty > 0 && l.filledAvgPrice !== null);
      const exitFromOrders = orders.find(
        (o) =>
          o.symbol.toUpperCase() === t.symbol.toUpperCase() &&
          o.side !== t.side &&
          o.filledQty > 0 &&
          o.filledAvgPrice !== null &&
          Date.parse(o.submittedAt || '') >= t.openedAt - 60_000,
      );
      const exitPrice = exitLeg?.filledAvgPrice ?? exitFromOrders?.filledAvgPrice ?? t.stoploss;
      const adjusted = realEntry !== t.entryPrice ? { ...t, entryPrice: realEntry } : t;
      const review = writePostMortem(adjusted, exitPrice);
      const closed = this.deps.store.closeTrade(t.id, exitPrice, review);
      if (!closed) continue;
      report.closed.push({
        symbol: t.symbol,
        pnl: closed.pnl ?? 0,
        outcome: closed.outcome ?? 'flat',
        review,
      });
      if (t.strategyId) {
        this.deps.store.recordStrategyResult(
          t.strategyId,
          closed.outcome ?? 'flat',
          closed.pnl ?? 0,
          closed.outcome === 'loss' ? review : undefined,
        );
        const s = this.deps.store.getStrategy(t.strategyId);
        if (s && s.status === 'active' && shouldRetireStrategy(s)) {
          this.deps.store.setStrategyStatus(s.id, 'retired');
          this.log(`retired strategy "${s.name}" (negative expectancy: ${s.wins}W/${s.losses}L, pnl ${s.totalPnl.toFixed(2)})`);
        }
      }
    }
  }

  async runCycle(): Promise<CycleReport> {
    const report: CycleReport = {
      ranAt: new Date().toISOString(),
      marketOpen: false,
      halted: null,
      closed: [],
      opened: [],
      skipped: [],
      errors: [],
    };
    this.seedStrategies();

    const [account, clock, positions] = await Promise.all([
      this.deps.broker.getAccount(),
      this.deps.broker.getClock(),
      this.deps.broker.getPositions(),
    ]);
    report.marketOpen = clock.isOpen;

    // Learning first: post-mortems run even when the market is closed.
    await this.sync(positions, report);

    if (account.tradingBlocked) {
      report.halted = 'account is blocked from trading';
      return report;
    }
    if (!clock.isOpen) {
      report.halted = 'market closed';
      return report;
    }

    const rules = this.deps.getGuardrails();
    const day = this.deps.store.dayStats();
    if (account.equity > 0 && -day.realizedPnlToday >= (rules.maxDailyLossPct / 100) * account.equity) {
      report.halted = `daily loss limit hit (${rules.maxDailyLossPct}% of equity) — no more trades today`;
      return report;
    }
    if (day.consecutiveLosses >= rules.lossStreakPause) {
      report.halted = `cooling down after ${day.consecutiveLosses} consecutive losses`;
      return report;
    }

    const strategies = this.deps.store.listStrategies('active');
    if (strategies.length === 0) {
      report.halted = 'no active strategies';
      return report;
    }
    const held = new Set([
      ...positions.map((p) => p.symbol.toUpperCase()),
      ...this.deps.store.openTrades().map((t) => t.symbol.toUpperCase()),
    ]);

    // Adaptive sizing: after consecutive losses, halve risk per remaining loss.
    const riskScale = Math.pow(0.5, Math.min(3, day.consecutiveLosses));

    for (const symbol of this.deps.getWatchlist()) {
      const sym = symbol.toUpperCase();
      if (held.has(sym)) {
        report.skipped.push({ symbol: sym, reason: 'already holding' });
        continue;
      }
      let analysis: StockAnalysis;
      try {
        analysis = await this.deps.analyze(sym);
      } catch (err) {
        report.errors.push(`${sym}: analyze failed — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      let match: { s: StrategyRow; why: string } | null = null;
      const misses: string[] = [];
      for (const s of strategies) {
        const m = this.matchStrategy(analysis, s);
        if (m.ok) {
          match = { s, why: m.why };
          break;
        }
        misses.push(`${s.name}: ${m.why}`);
      }
      if (!match) {
        report.skipped.push({ symbol: sym, reason: misses.join(' | ') || 'no strategy matched' });
        continue;
      }

      const riskPerShare = Math.abs(analysis.entry - analysis.stoploss);
      const riskBudget = (rules.riskPctPerTrade / 100) * account.equity * riskScale;
      const qty = riskPerShare > 0 ? Math.floor(riskBudget / riskPerShare) : 0;
      const intent: TradeIntent = {
        symbol: sym,
        side: 'buy', // autopilot is long-only; shorting only via explicit manual/agent action
        qty,
        entry: analysis.entry,
        stoploss: analysis.stoploss,
        confidence: analysis.confidence,
        strategyId: match.s.id,
      };
      try {
        const { verdict, trade } = await this.executeIntent({
          intent,
          takeProfit: this.pickTakeProfit(analysis, match.s),
          rationale: {
            confidence: analysis.confidence,
            direction: analysis.direction,
            factors: analysis.factors,
            stopDistancePct: riskPerShare / analysis.entry,
            strategy: match.s.name,
            riskNotes: [],
          },
          account: { equity: account.equity, cash: account.cash },
          positions,
        });
        if (trade) {
          report.opened.push({ symbol: sym, qty: trade.qty, entry: trade.entryPrice, strategy: match.s.name });
          held.add(sym);
          positions.push({
            symbol: sym,
            qty: trade.qty,
            side: 'long',
            avgEntryPrice: trade.entryPrice,
            currentPrice: trade.entryPrice,
            marketValue: trade.qty * trade.entryPrice,
            unrealizedPl: 0,
            unrealizedPlPct: 0,
          });
        } else {
          report.skipped.push({ symbol: sym, reason: verdict.blocked.join('; ') });
        }
      } catch (err) {
        report.errors.push(`${sym}: order failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return report;
  }
}
