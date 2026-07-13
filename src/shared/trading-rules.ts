// Pure, shared risk guardrails for autonomous trading. Every order — whether
// proposed by the trading engine, an agent tool call, or the UI — passes
// through evaluateTradeIntent before it can reach the broker. The rules are
// deliberately conservative-by-default: small position sizes, a daily loss
// halt, a loss-streak cooldown, and a cash reserve that is never deployed.
// No IO, fully unit-tested.

export interface TradingGuardrails {
  /** Max % of account equity a single position may consume (notional). */
  maxPositionPct: number;
  /** % of equity risked between entry and stoploss per trade. */
  riskPctPerTrade: number;
  /** Realized daily loss (as % of equity) that halts trading until tomorrow. */
  maxDailyLossPct: number;
  /** Max simultaneously open positions. */
  maxOpenPositions: number;
  /** Max new trades opened per day. */
  maxTradesPerDay: number;
  /** % of equity always kept as cash, never deployed. */
  cashReservePct: number;
  /** Consecutive losses that trigger a cooldown (no new trades that day). */
  lossStreakPause: number;
  /** Minimum signal confidence (0..1) required to open a trade. */
  minConfidence: number;
}

export const DEFAULT_GUARDRAILS: TradingGuardrails = {
  maxPositionPct: 20,
  riskPctPerTrade: 1,
  maxDailyLossPct: 2,
  maxOpenPositions: 5,
  maxTradesPerDay: 6,
  cashReservePct: 20,
  lossStreakPause: 3,
  minConfidence: 0.55,
};

/** Clamp arbitrary (possibly user/agent-supplied) config into sane bounds. */
export function sanitizeGuardrails(raw: Partial<TradingGuardrails> | undefined): TradingGuardrails {
  const d = DEFAULT_GUARDRAILS;
  const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.min(hi, Math.max(lo, n));
  };
  return {
    maxPositionPct: num(raw?.maxPositionPct, d.maxPositionPct, 0.5, 50),
    riskPctPerTrade: num(raw?.riskPctPerTrade, d.riskPctPerTrade, 0.1, 5),
    maxDailyLossPct: num(raw?.maxDailyLossPct, d.maxDailyLossPct, 0.5, 10),
    maxOpenPositions: Math.round(num(raw?.maxOpenPositions, d.maxOpenPositions, 1, 20)),
    maxTradesPerDay: Math.round(num(raw?.maxTradesPerDay, d.maxTradesPerDay, 1, 25)),
    cashReservePct: num(raw?.cashReservePct, d.cashReservePct, 0, 80),
    lossStreakPause: Math.round(num(raw?.lossStreakPause, d.lossStreakPause, 1, 10)),
    minConfidence: num(raw?.minConfidence, d.minConfidence, 0, 0.95),
  };
}

export interface TradeIntent {
  symbol: string;
  side: 'buy' | 'sell';
  /** Proposed share count. May be clamped down by the rules. */
  qty: number;
  entry: number;
  stoploss: number;
  /** Signal confidence 0..1 backing this intent. */
  confidence: number;
  strategyId?: string;
}

export interface AccountSnapshot {
  equity: number;
  cash: number;
  openPositions: number;
  heldSymbols: string[];
}

export interface DayStats {
  /** Realized P&L today (negative = loss), in account currency. */
  realizedPnlToday: number;
  /** Trades opened today. */
  tradesOpenedToday: number;
  /** Current consecutive-loss streak across recent closed trades. */
  consecutiveLosses: number;
}

export interface RiskVerdict {
  allowed: boolean;
  /** Final share count after clamping (0 when blocked). */
  qty: number;
  /** Notional value of the approved order. */
  notional: number;
  /** Hard blocks that prevented the trade (empty when allowed). */
  blocked: string[];
  /** Informational notes: clamps applied, sizing math. */
  reasons: string[];
}

/**
 * The single choke point every order must pass. Returns an approved
 * (possibly downsized) quantity, or a blocked verdict with explicit reasons —
 * which double as the learning journal's record of *why* a trade was or
 * wasn't taken.
 */
export function evaluateTradeIntent(
  intent: TradeIntent,
  account: AccountSnapshot,
  rules: TradingGuardrails,
  day: DayStats,
): RiskVerdict {
  const blocked: string[] = [];
  const reasons: string[] = [];

  if (!Number.isFinite(intent.entry) || intent.entry <= 0) blocked.push('invalid entry price');
  if (!Number.isFinite(intent.qty) || intent.qty <= 0) blocked.push('invalid quantity');
  if (!Number.isFinite(intent.stoploss) || intent.stoploss <= 0) blocked.push('invalid stoploss');
  if (intent.side === 'buy' && intent.stoploss >= intent.entry) {
    blocked.push('stoploss must be below entry for a long');
  }
  if (intent.side === 'sell' && intent.stoploss <= intent.entry) {
    blocked.push('stoploss must be above entry for a short');
  }
  if (account.equity <= 0) blocked.push('account equity is zero');

  if (intent.confidence < rules.minConfidence) {
    blocked.push(
      `confidence ${intent.confidence.toFixed(2)} below minimum ${rules.minConfidence.toFixed(2)}`,
    );
  }
  if (account.heldSymbols.map((s) => s.toUpperCase()).includes(intent.symbol.toUpperCase())) {
    blocked.push(`already holding ${intent.symbol} — no averaging in`);
  }
  if (account.openPositions >= rules.maxOpenPositions) {
    blocked.push(`open positions at cap (${rules.maxOpenPositions})`);
  }
  if (day.tradesOpenedToday >= rules.maxTradesPerDay) {
    blocked.push(`daily trade cap reached (${rules.maxTradesPerDay})`);
  }
  const dailyLossLimit = (rules.maxDailyLossPct / 100) * account.equity;
  if (account.equity > 0 && -day.realizedPnlToday >= dailyLossLimit) {
    blocked.push(
      `daily loss halt: down ${(-day.realizedPnlToday).toFixed(2)} ≥ ${rules.maxDailyLossPct}% of equity`,
    );
  }
  if (day.consecutiveLosses >= rules.lossStreakPause) {
    blocked.push(`cooldown after ${day.consecutiveLosses} consecutive losses`);
  }

  if (blocked.length > 0) {
    return { allowed: false, qty: 0, notional: 0, blocked, reasons };
  }

  // ── Position sizing: start from risk, then clamp by notional + cash. ──
  const riskPerShare = Math.abs(intent.entry - intent.stoploss);
  const riskBudget = (rules.riskPctPerTrade / 100) * account.equity;
  const riskQty = riskPerShare > 0 ? Math.floor(riskBudget / riskPerShare) : 0;
  let qty = Math.min(intent.qty, riskQty);
  if (qty < intent.qty) {
    reasons.push(`qty clamped ${intent.qty} → ${qty} by ${rules.riskPctPerTrade}% risk budget`);
  }

  const notionalCap = (rules.maxPositionPct / 100) * account.equity;
  const notionalQty = Math.floor(notionalCap / intent.entry);
  if (qty > notionalQty) {
    reasons.push(`qty clamped ${qty} → ${notionalQty} by ${rules.maxPositionPct}% position cap`);
    qty = notionalQty;
  }

  const reserve = (rules.cashReservePct / 100) * account.equity;
  const deployable = Math.max(0, account.cash - reserve);
  if (intent.side === 'buy') {
    const cashQty = Math.floor(deployable / intent.entry);
    if (qty > cashQty) {
      reasons.push(
        `qty clamped ${qty} → ${cashQty} by deployable cash (${rules.cashReservePct}% reserve kept)`,
      );
      qty = cashQty;
    }
  }

  if (qty <= 0) {
    return {
      allowed: false,
      qty: 0,
      notional: 0,
      blocked: ['position size rounds to zero after risk caps'],
      reasons,
    };
  }

  const notional = qty * intent.entry;
  reasons.push(
    `approved ${qty} × ${intent.entry.toFixed(2)} = ${notional.toFixed(2)} ` +
      `(risk/share ${riskPerShare.toFixed(2)}, budget ${riskBudget.toFixed(2)})`,
  );
  return { allowed: true, qty, notional, blocked: [], reasons };
}
