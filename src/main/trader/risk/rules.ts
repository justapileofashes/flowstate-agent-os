// Risk rule plugins. Each rule is deterministic and never learns: it reads the
// proposal, the draft order (size/stop/TP as adjusted by earlier rules), the
// portfolio and market context, and either passes, adjusts (only ever toward
// less risk), or blocks with a verbatim reason for the audit trail.
//
// Spec starters: FixedFractionalRule, AtrStopRule, DailyLossCircuitBreakerRule,
// ExposureLimitRule. The rest cover the spec's hard caps, correlation/sector,
// liquidity, drawdown, blackout, stale data, shorting and trading hours.

import type { RiskConfig } from '@shared/trader/types';
import type { MarketContext, PortfolioState, SignalProposal } from '../types';

export interface DraftOrder {
  size: number;
  stop: number;
  takeProfit: number;
}

export interface RiskContext {
  config: RiskConfig;
  /** Minimum confidence (from the signal config) — defence in depth for agent proposals. */
  minConfidence: number;
  maxTradesPerDay: number;
  portfolio: PortfolioState;
  market: MarketContext;
}

export interface RuleOutcome {
  passed: boolean;
  reason: string;
  adjust?: Partial<DraftOrder>;
  /** Trips the book-wide circuit breaker (halts all new entries). */
  tripBreaker?: boolean;
}

export abstract class RiskRule {
  abstract readonly name: string;
  abstract evaluate(p: SignalProposal, draft: DraftOrder, ctx: RiskContext): RuleOutcome;
}

const pass = (reason: string, adjust?: Partial<DraftOrder>): RuleOutcome => ({ passed: true, reason, ...(adjust ? { adjust } : {}) });
const block = (reason: string, extra: Partial<RuleOutcome> = {}): RuleOutcome => ({ passed: false, reason, ...extra });

export function roundQty(qty: number, symbol: string, ctx: RiskContext): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return ctx.market.assetClass(symbol) === 'crypto' ? Math.floor(qty * 1e6) / 1e6 : Math.floor(qty);
}

const fmt = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : String(n));

/** Numbers must make sense before anything else runs. */
export class SanityRule extends RiskRule {
  readonly name = 'SanityRule';
  evaluate(p: SignalProposal, d: DraftOrder): RuleOutcome {
    const bad: string[] = [];
    if (!(p.entry > 0) || !Number.isFinite(p.entry)) bad.push('entry price must be a positive number');
    if (!(d.stop > 0) || !Number.isFinite(d.stop)) bad.push('stop must be a positive number');
    if (!(d.takeProfit > 0) || !Number.isFinite(d.takeProfit)) bad.push('take-profit must be a positive number');
    if (d.stop === p.entry) bad.push('stop equals entry');
    if (p.side === 'long' && d.stop >= p.entry) bad.push('stop must be below entry for a long');
    if (p.side === 'long' && d.takeProfit <= p.entry) bad.push('take-profit must be above entry for a long');
    if (p.side === 'short' && d.stop <= p.entry) bad.push('stop must be above entry for a short');
    if (p.side === 'short' && d.takeProfit >= p.entry) bad.push('take-profit must be below entry for a short');
    if (!(p.confidence >= 0 && p.confidence <= 1)) bad.push('confidence must be within 0..1');
    return bad.length ? block(bad.join('; ')) : pass('prices consistent');
  }
}

export class ConfidenceFloorRule extends RiskRule {
  readonly name = 'ConfidenceFloorRule';
  evaluate(p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    return p.confidence + 1e-12 >= ctx.minConfidence
      ? pass(`confidence ${fmt(p.confidence)} ≥ ${fmt(ctx.minConfidence)}`)
      : block(`confidence ${fmt(p.confidence)} below the ${fmt(ctx.minConfidence)} floor`);
  }
}

export class ShortingRule extends RiskRule {
  readonly name = 'ShortingRule';
  evaluate(p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    if (p.side === 'long') return pass('long');
    if (!ctx.config.allowShort) return block('short selling is disabled in the risk config');
    return pass('shorting enabled');
  }
}

export class StaleDataRule extends RiskRule {
  readonly name = 'StaleDataRule';
  evaluate(p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    return ctx.market.stale(p.symbol) ? block(`${p.symbol} market data is stale — never trade on a stale feature snapshot`) : pass('data fresh');
  }
}

export class TradingHoursRule extends RiskRule {
  readonly name = 'TradingHoursRule';
  evaluate(p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    return ctx.market.tradable(p.symbol) ? pass('market open') : block(`${p.symbol} market is closed`);
  }
}

export class EarningsBlackoutRule extends RiskRule {
  readonly name = 'EarningsBlackoutRule';
  evaluate(p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const days = ctx.config.earningsBlackoutDays;
    for (const e of ctx.config.earningsBlackout) {
      if (e.symbol !== p.symbol) continue;
      const t = Date.parse(`${e.date}T12:00:00Z`);
      if (Math.abs(t - ctx.market.now) <= (days + 0.5) * 86_400_000) return block(`${p.symbol} is inside its earnings blackout (${e.date} ± ${days}d)`);
    }
    return pass('no earnings blackout');
  }
}

/** Stop/TP from ATR multiples unless the signal/strategy already set sane levels. */
export class AtrStopRule extends RiskRule {
  readonly name = 'AtrStopRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const c = ctx.config;
    const dir = p.side === 'long' ? 1 : -1;
    const atr = p.atr > 0 ? p.atr : p.entry * 0.01;
    let stop = d.stop;
    let tp = d.takeProfit;
    const notes: string[] = [];
    const stopDist = Math.abs(p.entry - stop);
    const validSide = dir * (p.entry - stop) > 0;
    if (!validSide || !(stopDist > 0)) {
      stop = p.entry - dir * c.stopAtrMult * atr;
      notes.push(`stop set to ${fmt(c.stopAtrMult, 1)}×ATR`);
    }
    // Clamp stop distance into [minStopPct, maxStopPct] of price.
    const minDist = (c.minStopPct / 100) * p.entry;
    const maxDist = (c.maxStopPct / 100) * p.entry;
    const dist = Math.abs(p.entry - stop);
    if (dist < minDist) {
      stop = p.entry - dir * minDist;
      notes.push(`stop widened to the ${c.minStopPct}% minimum (inside normal noise)`);
    } else if (dist > maxDist) {
      stop = p.entry - dir * maxDist;
      notes.push(`stop tightened to the ${c.maxStopPct}% maximum`);
    }
    if (!(dir * (tp - p.entry) > 0)) {
      tp = p.entry + dir * c.takeProfitAtrMult * atr;
      notes.push(`take-profit set to ${fmt(c.takeProfitAtrMult, 1)}×ATR`);
    }
    if (stop <= 0) return block('ATR stop would be at or below zero');
    return pass(notes.length ? notes.join('; ') : `stop ${fmt(stop)} / TP ${fmt(tp)} kept`, { stop, takeProfit: tp });
  }
}

/**
 * Fixed-fractional sizing, volatility-adjusted through the stop distance:
 * size = equity · f / |entry − stop|   (the stop is ATR-derived, so wider ATR →
 * smaller size). Requested sizes (agents) can only be shrunk.
 */
export class FixedFractionalRule extends RiskRule {
  readonly name = 'FixedFractionalRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const eq = ctx.portfolio.equity;
    if (!(eq > 0)) return block('account equity is zero');
    const perUnit = Math.abs(p.entry - d.stop);
    if (!(perUnit > 0)) return block('stop distance is zero');
    // Halve risk per consecutive loss (up to 3) — adaptive sizing after drawdowns.
    const scale = Math.pow(0.5, Math.min(3, ctx.portfolio.lossStreak));
    const budget = eq * (ctx.config.riskPerTradePct / 100) * scale;
    let size = roundQty(budget / perUnit, p.symbol, ctx);
    const notes = [`risk ${fmt(ctx.config.riskPerTradePct * scale, 2)}% of equity = ${fmt(budget)} → ${size} units at ${fmt(perUnit)}/unit`];
    if (p.requestedSize !== undefined && p.requestedSize > 0 && p.requestedSize < size) {
      size = roundQty(p.requestedSize, p.symbol, ctx);
      notes.push(`requested ${p.requestedSize} (smaller) kept`);
    }
    if (size <= 0) return block(`position size rounds to zero (risk budget ${fmt(budget)} < one unit's risk ${fmt(perUnit)})`);
    return pass(notes.join('; '), { size });
  }
}

/** Book-wide circuit breaker: today's loss (realized + unrealized) ≥ limit. */
export class DailyLossCircuitBreakerRule extends RiskRule {
  readonly name = 'DailyLossCircuitBreakerRule';
  evaluate(_p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const pf = ctx.portfolio;
    const base = pf.dayStartEquity > 0 ? pf.dayStartEquity : pf.equity;
    const lossToday = Math.max(0, base - pf.equity, -(pf.realizedToday + pf.unrealized));
    const limit = (ctx.config.dailyLossLimitPct / 100) * base;
    if (base > 0 && lossToday >= limit) {
      return block(`daily loss ${fmt(lossToday)} ≥ ${ctx.config.dailyLossLimitPct}% limit (${fmt(limit)}) — circuit breaker: no new entries today`, {
        tripBreaker: true,
      });
    }
    return pass(`today ${fmt(-lossToday)} vs limit −${fmt(limit)}`);
  }
}

export class LossStreakRule extends RiskRule {
  readonly name = 'LossStreakRule';
  evaluate(_p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    return ctx.portfolio.lossStreak >= ctx.config.lossStreakPause
      ? block(`cooling down after ${ctx.portfolio.lossStreak} consecutive losses`)
      : pass(`loss streak ${ctx.portfolio.lossStreak}`);
  }
}

export class MaxDrawdownRule extends RiskRule {
  readonly name = 'MaxDrawdownRule';
  evaluate(_p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const pf = ctx.portfolio;
    if (!(pf.peakEquity > 0)) return pass('no equity history');
    const dd = ((pf.peakEquity - pf.equity) / pf.peakEquity) * 100;
    return dd >= ctx.config.maxOpenDrawdownPct
      ? block(`drawdown ${fmt(dd, 1)}% from peak ≥ ${ctx.config.maxOpenDrawdownPct}% — new entries blocked`)
      : pass(`drawdown ${fmt(dd, 1)}%`);
  }
}

/** Hard caps: no averaging in, max positions, trades/day, single-position %, gross exposure, cash reserve. */
export class ExposureLimitRule extends RiskRule {
  readonly name = 'ExposureLimitRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const c = ctx.config;
    const pf = ctx.portfolio;
    if (pf.positions.some((x) => x.symbol === p.symbol) || pf.pendingEntries.some((x) => x.symbol === p.symbol)) {
      return block(`already holding or entering ${p.symbol} — no averaging in`);
    }
    const open = pf.positions.length + pf.pendingEntries.length;
    if (open >= c.maxPositions) return block(`open positions at the cap (${c.maxPositions})`);
    if (pf.openedToday >= ctx.maxTradesPerDay) return block(`daily trade cap reached (${ctx.maxTradesPerDay})`);
    let size = d.size;
    const notes: string[] = [];
    const eq = pf.equity;
    const posCap = roundQty(((c.maxPositionPct / 100) * eq) / p.entry, p.symbol, ctx);
    if (size > posCap) {
      notes.push(`size ${size} → ${posCap} by the ${c.maxPositionPct}% single-position cap`);
      size = posCap;
    }
    const gross =
      pf.positions.reduce((a, x) => a + Math.abs(x.qty * x.lastPrice), 0) + pf.pendingEntries.reduce((a, x) => a + Math.abs(x.qty * x.price), 0);
    const room = (c.maxGrossExposurePct / 100) * eq - gross;
    const grossCap = roundQty(room / p.entry, p.symbol, ctx);
    if (size > grossCap) {
      notes.push(`size ${size} → ${Math.max(0, grossCap)} by the ${c.maxGrossExposurePct}% gross-exposure cap`);
      size = Math.max(0, grossCap);
    }
    if (p.side === 'long') {
      const pendingCash = pf.pendingEntries.filter((x) => x.side === 'long').reduce((a, x) => a + x.qty * x.price, 0);
      const deployable = pf.cash - pendingCash - (c.cashReservePct / 100) * eq;
      const cashCap = roundQty(deployable / p.entry, p.symbol, ctx);
      if (size > cashCap) {
        notes.push(`size ${size} → ${Math.max(0, cashCap)} by deployable cash (${c.cashReservePct}% reserve kept)`);
        size = Math.max(0, cashCap);
      }
    }
    if (size <= 0) return block(notes.length ? `${notes.join('; ')} — nothing left to trade` : 'no room under exposure limits');
    return pass(notes.length ? notes.join('; ') : 'within exposure limits', { size });
  }
}

export class SectorCapRule extends RiskRule {
  readonly name = 'SectorCapRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const sector = ctx.market.sector(p.symbol);
    if (!sector || sector === 'unknown') return pass('sector unknown — not capped');
    const eq = ctx.portfolio.equity;
    const held =
      ctx.portfolio.positions.filter((x) => ctx.market.sector(x.symbol) === sector).reduce((a, x) => a + Math.abs(x.qty * x.lastPrice), 0) +
      ctx.portfolio.pendingEntries.filter((x) => ctx.market.sector(x.symbol) === sector).reduce((a, x) => a + Math.abs(x.qty * x.price), 0);
    const room = (ctx.config.maxSectorPct / 100) * eq - held;
    const cap = roundQty(room / p.entry, p.symbol, ctx);
    if (cap <= 0) return block(`${sector} exposure already at the ${ctx.config.maxSectorPct}% sector cap`);
    if (d.size > cap) return pass(`size ${d.size} → ${cap} by the ${ctx.config.maxSectorPct}% ${sector} cap`, { size: cap });
    return pass(`${sector} exposure within cap`);
  }
}

export class CorrelationCapRule extends RiskRule {
  readonly name = 'CorrelationCapRule';
  evaluate(p: SignalProposal, _d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const correlated = ctx.portfolio.positions
      .map((x) => ({ symbol: x.symbol, rho: ctx.market.correlation(p.symbol, x.symbol) }))
      .filter((x) => x.rho !== null && x.rho >= ctx.config.correlationThreshold);
    if (correlated.length >= ctx.config.maxCorrelatedPositions) {
      return block(
        `${correlated.length} held position(s) correlate ≥ ${ctx.config.correlationThreshold} with ${p.symbol} (${correlated.map((x) => `${x.symbol} ${fmt(x.rho!)}`).join(', ')})`,
      );
    }
    return pass(correlated.length ? `${correlated.length} correlated position(s), under the cap` : 'no highly correlated positions');
  }
}

export class NetExposureRule extends RiskRule {
  readonly name = 'NetExposureRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const cls = ctx.market.assetClass(p.symbol);
    const band = ctx.config.netExposure[cls];
    const eq = ctx.portfolio.equity;
    const net = ctx.portfolio.positions.filter((x) => ctx.market.assetClass(x.symbol) === cls).reduce((a, x) => a + x.qty * x.lastPrice, 0);
    const dir = p.side === 'long' ? 1 : -1;
    const after = ((net + dir * d.size * p.entry) / eq) * 100;
    if (after > band.max) {
      const room = (band.max / 100) * eq - net;
      const cap = roundQty(room / p.entry, p.symbol, ctx);
      if (dir > 0 && cap > 0) return pass(`size ${d.size} → ${cap} by the ${band.max}% ${cls} net ceiling`, { size: cap });
      return block(`${cls} net exposure would be ${fmt(after, 1)}% > ${band.max}% ceiling`);
    }
    if (after < band.min) {
      const room = net - (band.min / 100) * eq;
      const cap = roundQty(room / p.entry, p.symbol, ctx);
      if (dir < 0 && cap > 0) return pass(`size ${d.size} → ${cap} by the ${band.min}% ${cls} net floor`, { size: cap });
      return block(`${cls} net exposure would be ${fmt(after, 1)}% < ${band.min}% floor`);
    }
    return pass(`${cls} net ${fmt(after, 1)}% within [${band.min}, ${band.max}]`);
  }
}

export class LiquidityRule extends RiskRule {
  readonly name = 'LiquidityRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const adv = ctx.market.adv(p.symbol);
    if (adv === null || !(adv > 0)) return pass('average daily volume unknown — not capped');
    const cap = roundQty((ctx.config.maxAdvPct / 100) * adv, p.symbol, ctx);
    if (cap <= 0) return block(`${ctx.config.maxAdvPct}% of ADV (${fmt(adv, 0)}) is less than one unit`);
    if (d.size > cap) return pass(`size ${d.size} → ${cap} (≤ ${ctx.config.maxAdvPct}% of ADV ${fmt(adv, 0)})`, { size: cap });
    return pass(`${fmt((d.size / adv) * 100, 3)}% of ADV`);
  }
}

export class MinSizeRule extends RiskRule {
  readonly name = 'MinSizeRule';
  evaluate(p: SignalProposal, d: DraftOrder, ctx: RiskContext): RuleOutcome {
    const size = roundQty(d.size, p.symbol, ctx);
    return size > 0 ? pass(`final size ${size}`, { size }) : block('final size is zero after risk caps');
  }
}

/** Default rule chain, in evaluation order. */
export function defaultRules(): RiskRule[] {
  return [
    new SanityRule(),
    new ConfidenceFloorRule(),
    new ShortingRule(),
    new StaleDataRule(),
    new TradingHoursRule(),
    new EarningsBlackoutRule(),
    new DailyLossCircuitBreakerRule(),
    new MaxDrawdownRule(),
    new LossStreakRule(),
    new AtrStopRule(),
    new FixedFractionalRule(),
    new ExposureLimitRule(),
    new SectorCapRule(),
    new CorrelationCapRule(),
    new NetExposureRule(),
    new LiquidityRule(),
    new MinSizeRule(),
  ];
}
