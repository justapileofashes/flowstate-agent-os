-- AI Trader: layered automated trading (data → features → models →
-- backtests → signals → risk → execution → monitoring). All tables are
-- prefixed trader_; the 007 `strategies` / `trades` tables are left in place
-- and imported once (legacy rows are flagged).

-- Canonical OHLCV bars per symbol/timeframe (ts = bar open, epoch ms UTC).
CREATE TABLE IF NOT EXISTS trader_bars (
  symbol     TEXT NOT NULL,
  timeframe  TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  open       REAL NOT NULL,
  high       REAL NOT NULL,
  low        REAL NOT NULL,
  close      REAL NOT NULL,
  volume     REAL NOT NULL,
  adj_close  REAL,
  source     TEXT NOT NULL,
  PRIMARY KEY (symbol, timeframe, ts)
) WITHOUT ROWID;

-- Last traded price/size samples (latest-trade polling; not a full tape).
CREATE TABLE IF NOT EXISTS trader_ticks (
  symbol TEXT NOT NULL,
  ts     INTEGER NOT NULL,
  price  REAL NOT NULL,
  size   REAL NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (symbol, ts)
) WITHOUT ROWID;

-- Normalization/validation problems (the "alert queue" feed).
CREATE TABLE IF NOT EXISTS trader_data_issues (
  id         TEXT PRIMARY KEY,
  symbol     TEXT NOT NULL,
  timeframe  TEXT NOT NULL,
  ts         INTEGER,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_data_issues ON trader_data_issues(created_at DESC);

-- Latest feature snapshot per symbol/timeframe (updated every cycle).
CREATE TABLE IF NOT EXISTS trader_features_latest (
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  updated     INTEGER NOT NULL,
  bar_ts      INTEGER NOT NULL,
  rsi_14      REAL,
  atr_pct     REAL,
  macd        REAL,
  sma_20      REAL,
  roc_5       REAL,
  vol_zscore  REAL,
  regime      TEXT,
  model_ready INTEGER NOT NULL DEFAULT 0,
  features    TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (symbol, timeframe)
);

-- Model registry. Only status='active' models score live signals.
CREATE TABLE IF NOT EXISTS trader_models (
  id             TEXT PRIMARY KEY,
  version        TEXT NOT NULL UNIQUE,
  timeframe      TEXT NOT NULL,
  horizon_bars   INTEGER NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'full',
  parent_version TEXT,
  status         TEXT NOT NULL DEFAULT 'candidate',
  trained_at     INTEGER NOT NULL,
  dataset_id     TEXT NOT NULL,
  feature_set    TEXT NOT NULL,
  auc            REAL NOT NULL DEFAULT 0,
  sharpe         REAL NOT NULL DEFAULT 0,
  max_dd         REAL NOT NULL DEFAULT 0,
  metrics        TEXT NOT NULL DEFAULT '{}',
  hash           TEXT NOT NULL,
  blob           TEXT NOT NULL,
  promoted_at    INTEGER,
  retired_at     INTEGER,
  notes          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trader_models_tf ON trader_models(timeframe, status);

-- Daily shadow comparison of a candidate against the active model.
CREATE TABLE IF NOT EXISTS trader_shadow_evals (
  model_version   TEXT NOT NULL,
  day             TEXT NOT NULL,
  active_version  TEXT,
  candidate_score REAL NOT NULL,
  active_score    REAL NOT NULL,
  samples         INTEGER NOT NULL,
  passed          INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (model_version, day)
);

-- Scores produced by shadow models each tick (never traded).
CREATE TABLE IF NOT EXISTS trader_shadow_scores (
  model_version TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  bar_ts        INTEGER NOT NULL,
  prob_up       REAL NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (model_version, symbol, bar_ts)
);

CREATE TABLE IF NOT EXISTS trader_strategies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  inspiration TEXT NOT NULL DEFAULT '',
  params      TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'active',
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  total_pnl   REAL NOT NULL DEFAULT 0,
  lessons     TEXT NOT NULL DEFAULT '[]',
  legacy      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Signals emitted by the quant node (or proposed by agents / the user).
CREATE TABLE IF NOT EXISTS trader_signals (
  id            TEXT PRIMARY KEY,
  cycle_id      TEXT,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  entry         REAL NOT NULL,
  stop          REAL NOT NULL,
  tp            REAL NOT NULL,
  size          REAL NOT NULL DEFAULT 0,
  confidence    REAL NOT NULL,
  edge_pct      REAL NOT NULL DEFAULT 0,
  horizon_min   INTEGER NOT NULL DEFAULT 0,
  model_version TEXT,
  strategy_id   TEXT,
  source        TEXT NOT NULL DEFAULT 'model',
  status        TEXT NOT NULL,
  reason        TEXT,
  rationale     TEXT NOT NULL DEFAULT '',
  per_timeframe TEXT NOT NULL DEFAULT '[]',
  features      TEXT NOT NULL DEFAULT '{}',
  bar_ts        INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_signals_created ON trader_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trader_signals_status ON trader_signals(status);

-- OMS: orders + fills. client_order_id is the idempotency key.
CREATE TABLE IF NOT EXISTS trader_orders (
  id              TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  account         TEXT NOT NULL,
  signal_id       TEXT,
  trade_id        TEXT,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,
  role            TEXT NOT NULL,
  type            TEXT NOT NULL,
  qty             REAL NOT NULL,
  limit_price     REAL,
  stop_loss       REAL,
  take_profit     REAL,
  filled_qty      REAL NOT NULL DEFAULT 0,
  avg_fill_price  REAL,
  assumed_price   REAL,
  broker_order_id TEXT,
  status          TEXT NOT NULL,
  error           TEXT,
  expires_at      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_orders_status ON trader_orders(account, status);
CREATE INDEX IF NOT EXISTS idx_trader_orders_created ON trader_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS trader_fills (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  side       TEXT NOT NULL,
  qty        REAL NOT NULL,
  price      REAL NOT NULL,
  commission REAL NOT NULL DEFAULT 0,
  ts         INTEGER NOT NULL,
  broker_id  TEXT,
  UNIQUE (order_id, broker_id)
);
CREATE INDEX IF NOT EXISTS idx_trader_fills_order ON trader_fills(order_id);

-- Simulated accounts (paper + the shadow mirror of live).
CREATE TABLE IF NOT EXISTS trader_sim_accounts (
  account       TEXT PRIMARY KEY,
  cash          REAL NOT NULL,
  starting_cash REAL NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Positions of the simulated accounts, and a cache of broker positions.
CREATE TABLE IF NOT EXISTS trader_positions (
  account    TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  qty        REAL NOT NULL,
  avg_price  REAL NOT NULL,
  last_price REAL NOT NULL,
  opened_at  INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account, symbol)
);

-- Trades / PnL ledger (one row per round trip).
CREATE TABLE IF NOT EXISTS trader_trades (
  id            TEXT PRIMARY KEY,
  signal_id     TEXT,
  account       TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,
  timeframe     TEXT,
  qty           REAL NOT NULL,
  entry_price   REAL NOT NULL,
  exit_price    REAL,
  stop          REAL,
  tp            REAL,
  pnl           REAL,
  fees          REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,
  outcome       TEXT,
  exit_reason   TEXT,
  model_version TEXT,
  strategy_id   TEXT,
  review        TEXT,
  max_hold_until INTEGER,
  legacy        INTEGER NOT NULL DEFAULT 0,
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trader_trades_status ON trader_trades(account, status);
CREATE INDEX IF NOT EXISTS idx_trader_trades_opened ON trader_trades(opened_at DESC);

-- Full decision trace per proposal (who / why / approval).
CREATE TABLE IF NOT EXISTS trader_audit (
  id            TEXT PRIMARY KEY,
  signal_id     TEXT,
  trade_id      TEXT,
  cycle_id      TEXT,
  features      TEXT NOT NULL DEFAULT '{}',
  model_version TEXT,
  model_hash    TEXT,
  research_txt  TEXT,
  quant_txt     TEXT,
  risk_decision TEXT,
  trader_txt    TEXT,
  order_ids     TEXT NOT NULL DEFAULT '[]',
  approval_ts   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_audit_signal ON trader_audit(signal_id);
CREATE INDEX IF NOT EXISTS idx_trader_audit_trade ON trader_audit(trade_id);

-- One row per orchestrator tick.
CREATE TABLE IF NOT EXISTS trader_cycles (
  id           TEXT PRIMARY KEY,
  trigger      TEXT NOT NULL,
  status       TEXT NOT NULL,
  mode         TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  abort_reason TEXT,
  skip_reason  TEXT,
  nodes        TEXT NOT NULL DEFAULT '[]',
  llm_calls    INTEGER NOT NULL DEFAULT 0,
  signals      INTEGER NOT NULL DEFAULT 0,
  orders       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trader_cycles_started ON trader_cycles(started_at DESC);

CREATE TABLE IF NOT EXISTS trader_backtests (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',
  metrics     TEXT,
  report_path TEXT,
  equity_path TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS trader_alerts (
  id              TEXT PRIMARY KEY,
  key             TEXT NOT NULL,
  severity        TEXT NOT NULL,
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  acknowledged_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trader_alerts_created ON trader_alerts(created_at DESC);

-- Metric samples for dashboards (gauges/counters snapshotted each tick).
CREATE TABLE IF NOT EXISTS trader_metrics (
  name   TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '',
  ts     INTEGER NOT NULL,
  value  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_metrics ON trader_metrics(name, ts);

-- Equity snapshots per account (the equity curve).
CREATE TABLE IF NOT EXISTS trader_equity (
  account TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  equity  REAL NOT NULL,
  cash    REAL NOT NULL,
  PRIMARY KEY (account, ts)
) WITHOUT ROWID;

-- Continuous-learning replay buffer: feature vector at entry + realized outcome.
CREATE TABLE IF NOT EXISTS trader_replay (
  id            TEXT PRIMARY KEY,
  trade_id      TEXT NOT NULL UNIQUE,
  model_version TEXT,
  timeframe     TEXT,
  symbol        TEXT NOT NULL,
  features      TEXT NOT NULL,
  label         INTEGER NOT NULL,
  pnl           REAL NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trader_config_versions (
  version    INTEGER PRIMARY KEY,
  config     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  edited_by  TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);

-- Durable switches: autopilot, kill switch, breaker, consent, live mode, leases.
CREATE TABLE IF NOT EXISTS trader_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Operator actions (who changed what, when).
CREATE TABLE IF NOT EXISTS trader_ops_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_ops_log ON trader_ops_log(created_at DESC);
