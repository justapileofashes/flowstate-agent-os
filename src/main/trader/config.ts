// AI Trader constants. Tunables (risk limits, symbols, thresholds) live in the
// versioned TraderConfig (src/shared/trader/types.ts); this file only holds
// things that must NOT be changeable at runtime.

/**
 * Real-money trading is compiled out by default. Flipping this to `true` is a
 * deliberate code change (spec: "cannot flip to live without a code change +
 * explicit user confirmation UI"). Even when true, live mode still requires
 * every go-live checklist item and a typed confirmation in the app.
 */
export const LIVE_TRADING_BUILD_ENABLED = false;

export const TRADER_VERSION = '2.0.0';

/** Bumped whenever FeatureEngine output changes; models record it. */
export const FEATURE_SET_VERSION = 'fs-3';

/** Conservative ceilings the go-live checklist enforces before live mode. */
export const GO_LIVE_LIMITS = {
  minPaperDays: 14,
  minPaperClosedTrades: 10,
  maxRiskPerTradePct: 0.5,
  maxDailyLossPct: 2,
  killTestMaxAgeMs: 30 * 24 * 60 * 60_000,
} as const;

export const TYPED_LIVE_CONFIRMATION = 'TRADE LIVE';
export const TYPED_PROMOTE_CONFIRMATION = 'PROMOTE';

/** Bars per year used to annualize Sharpe (US equities, regular session). */
export const BARS_PER_YEAR = {
  us_equity: { '5m': 252 * 78, '15m': 252 * 26, '1h': 252 * 7, '1d': 252 },
  crypto: { '5m': 365 * 288, '15m': 365 * 96, '1h': 365 * 24, '1d': 365 },
} as const;

export const LIMITS = {
  /** Wall clock per orchestrator tick before it is aborted. */
  tickWallClockMs: 60_000,
  /** Kept in trader_metrics. */
  metricsRetentionMs: 14 * 24 * 60 * 60_000,
  cyclesRetentionMs: 30 * 24 * 60 * 60_000,
  /** Bars needed before features are considered warm. */
  warmupBars: 60,
  /** Minimum labelled rows to train a model. */
  minTrainRows: 400,
} as const;

/** Settings keys (app credential store; secrets encrypted at rest). */
export const TRADER_SECRET_KEYS = {
  data: { keyId: 'trader_data_key_id', secret: 'trader_data_secret_key' },
  // Paper keys keep the pre-2.0 setting names so existing connections survive.
  paper: { keyId: 'alpaca_key_id', secret: 'alpaca_secret_key' },
  live: { keyId: 'alpaca_live_key_id', secret: 'alpaca_live_secret_key' },
} as const;
