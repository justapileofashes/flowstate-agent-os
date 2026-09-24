-- Autonomous trading: strategy library + trade journal. Strategies carry the
-- principles they were built from (inspiration), tunable params, and rolling
-- performance stats so the engine can retire what loses. Trades record the
-- full rationale at entry and a post-mortem review at close — the raw
-- material the learning loop reads to avoid repeating mistakes.
CREATE TABLE IF NOT EXISTS strategies (
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
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id              TEXT PRIMARY KEY,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,
  qty             REAL NOT NULL,
  entry_price     REAL NOT NULL,
  stoploss        REAL NOT NULL,
  take_profit     REAL NOT NULL,
  exit_price      REAL,
  status          TEXT NOT NULL DEFAULT 'open',
  outcome         TEXT,
  pnl             REAL,
  strategy_id     TEXT,
  rationale       TEXT NOT NULL DEFAULT '{}',
  review          TEXT,
  alpaca_order_id TEXT,
  paper           INTEGER NOT NULL DEFAULT 1,
  opened_at       INTEGER NOT NULL,
  closed_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_opened ON trades(opened_at DESC);
