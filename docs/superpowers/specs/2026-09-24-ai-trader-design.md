# AI Trader — layered automated-trading architecture (host-adapted design)

**Status:** implemented on `feat/business-agent` (uncommitted), 2026-09-24/25. Runbook: `src/main/trader/README.md`.
**Replaces:** the single-loop Alpaca autopilot (`trading-engine.ts`, `trading-service.ts`, `trading-store.ts`, `shared/trading-rules.ts`, `TradingPanel.tsx`).
**Source spec:** the owner's "AI Trader — Implementation Plan for Claude Code" (phases 1–6).
**Owner decisions (2026-09-24):** build it in TypeScript inside the app (not a Python sidecar); build all phases, gate each on its Definition of Done.

## 1. Reference patterns we emulate

| Reference | Pattern taken |
|---|---|
| Trade Ideas "Money Machine" | Strategy composer (model signals + filters → entry, sizing, stop, target, exit timing); **Simulation Mode** runs the *same* decision code as live against virtual capital; pause/resume; daily loss limit |
| Tickeron AI Bots | ML models per timeframe (5m/15m/1h) fused into one view; signals carry entry/stop/TP, confidence and rationale; continuous learning from every closed trade; signal → virtual (risk-managed) → brokerage tiers |
| Quod IQ / institutional stacks | "AI does the logic; deterministic software does the action." The LLM never reaches an order endpoint; every decision is reproducible from the audit trail |
| QuantConnect / Zorro norms | ingestion → normalization → feature store → research → backtest (vectorized + event-driven with costs) → signals → risk → execution → monitoring |

## 2. What changed vs. the old autopilot

| Old | New |
|---|---|
| One `runCycle()` that analysed the watchlist with a factor score and placed bracket orders | A typed graph per tick: Data → Researcher → Quant → Risk Officer → Trader → Logger, with a deterministic abort path on any node failure |
| Daily bars only (Yahoo), no storage | Data pipeline: Alpaca Data API (with keys) or Yahoo chart API (keyless, dev/backtests), canonical bars in SQLite + immutable NDJSON lake partitions, validation issues → alert queue |
| Hand-weighted factor score | Feature store (RSI/ATR/MACD/Bollinger/OBV/ROC/VWAP-dev/volume-z/regime), gradient-boosted trees per timeframe trained with time splits + purged walk-forward, model registry with hashes, shadow promotion |
| No backtesting | Vectorized + event-driven backtester (slippage, commission, borrow, funding, partial fills, latency), JSON report + equity CSV |
| `evaluateTradeIntent` (one function) | `RiskManager` with composable `RiskRule` plugins; returns `RiskDecision {allowed, reason, suggestedSize/Stop/Tp}`; reasons logged verbatim |
| Orders straight to Alpaca | OMS (idempotent client order ids, order/fill state machine, reconciliation), broker adapters (Paper, Alpaca), order router, kill switch |
| Agent `place_trade` tool could submit orders | Agents can only `propose_trade`; proposals enter the same deterministic pipeline (schema → risk → trader) |
| Live = live keys + typed ack | Live additionally needs a **build flag** (`LIVE_TRADING_BUILD_ENABLED`, a code change), the go-live checklist, and a typed confirmation |

## 3. Deviations from the source spec (host conventions win)

| Spec | Here | Why |
|---|---|---|
| Standalone Python microservice (`services/ai-trader`, FastAPI) | In-process TypeScript module `src/main/trader/` with no Electron imports (runs under vitest); the IPC handler injects keychain/notifications/broadcast | Owner decision: ships with the desktop app, no Python/Docker on user machines |
| REST + WebSocket (`/api/trader/*`, `/ws/trader/stream`), JWT, HTTPS, IP allowlist | One typed RPC IPC channel `trader:rpc` (zod schema per method, errors `{code,message,details}`) + push channel `trader:event` | Renderer ↔ main IPC is already process-local; no network surface to authenticate |
| PostgreSQL + TimescaleDB hypertables | SQLite migration `009_ai_trader.sql`, `WITHOUT ROWID` composite keys on bars, retention pruning job instead of hypertable retention | Local-first app |
| Parquet lake (`pyarrow`) | Append-only NDJSON partitions `userData/trader/lake/<tf>/<symbol>/<yyyy-mm-dd>.ndjson` + dataset manifests (sha256 dataset id) | No new native dependency; same immutability/reproducibility |
| LightGBM / XGBoost | `model/gbdt.ts`: histogram-binned gradient-boosted trees (logistic loss), deterministic, JSON-serializable, gain importances, warm-start for incremental updates. Training yields to the event loop between trees | No Python; small data sizes (tens of thousands of rows) |
| CNN/LSTM, RL execution, sentiment NLP | Not built (spec lists them as optional advanced phases) | Out of scope |
| LangGraph + hosted LLM | Hand-rolled typed graph (`orchestrator/graph.ts`) over the app's `ModelGateway`. LLM writes rationale text and may *veto* (opt-in); ≤ `llm.maxCallsPerTick` calls (default 2); rationale cache; LLM off → deterministic templates | Same shape without the dependency; decisions stay deterministic |
| Interactive Brokers adapter (ib_insync) | Not built; `BrokerAdapter` interface is ready for it | Requires IB Gateway + Python; Alpaca covers Phase 5 |
| Prometheus + Grafana, Sentry | Metrics registry persisted to `trader_metrics`, Prometheus text exposition via RPC and an **opt-in** `127.0.0.1` `/metrics` endpoint; in-app Monitor tab replaces Grafana | Desktop app; users who run Prometheus can still scrape |
| Email alerts | Desktop notification + in-app alerts + optional webhook URL | No SMTP in the app |
| Vault / env vars for keys | App credential store (`SettingsService` secret keys, OS-keychain encrypted). Separate slots: market-data key, paper trading key, live trading key | Host convention |
| YAML config-as-code | Versioned JSON config (`trader_config_versions`), zod-validated, exportable; defaults in code | No YAML dependency in the app |
| `POST /kill` "requires elevated auth" | Kill is one click in the app (main-process only). `flatten` asks for a confirm; `halt` is instant | Single local user; the spec also wants the kill switch front and centre |
| Report PDF | JSON report + equity CSV + in-app report view | No PDF renderer dependency |
| Ingest CLI (`python -m src.data.ingest …`) | `data.ingest` RPC + "Backfill" in the UI + scheduler | Desktop app |

## 4. Module layout

```
src/shared/trader/
  types.ts        TraderConfig schema (defaults), DTOs, enums
  api.ts          RPC request schemas, responses, push events
src/main/trader/
  README.md       runbook (go-live, kill switch, retrain, troubleshooting)
  config.ts       build flag, constants, bar-size math
  service.ts      TraderService: composition root + RPC dispatch + audit of mutations
  scheduler.ts    tick loop (bar-close aligned, single-flight), nightly/weekly retrain, shadow eval, retention, alerts
  golive.ts       go-live checklist
  legacy.ts       import old strategies/trades (007 tables kept, read-only)
  db/             TraderDb repos (bars, features, models, signals, orders/fills/positions, trades, audit, cycles, backtests, ops)
  data/           providers (Alpaca, Yahoo), normalize+validate, lake, pipeline, market calendar
  features/       indicators, FeatureEngine.compute, wrapFeatures (lagged X/y), regime
  model/          gbdt, metrics, trainer (time split, purge, walk-forward), registry, baselines, shadow
  backtest/       costs, fill simulator, vectorized, event-driven, reports
  signals/        generator (score → gate → fuse → strategies → SignalEvent), rationale
  risk/           RiskRule base + rules, RiskManager
  execution/      BrokerAdapter, PaperBroker, AlpacaBroker, OMS, router, trade validation, kill switch
  orchestrator/   typed state, graph runner, nodes (researcher, quant, risk officer, trader, logger), LLM budget
  monitor/        metrics registry + Prometheus text, alert rules, optional HTTP endpoint
src/main/ipc/handlers/trader.ts
src/renderer/src/screens/trader/   AI Trader view (Trading screen → "AI Trader")
tests/main/trader/                 unit + DoD tests per phase
```

## 5. Decision path (every tick)

```
reconcile (OMS ⇄ broker, fills, exits, breaker)      ← always, even when paused
   │
guard: kill switch? breaker? autopilot on? market open? consent?
   │
Data: incremental ingest → validate → staleness per symbol (gap > tf + 2 min ⇒ no trading on it)
   │
Researcher: features_latest, regime, (news, LLM narrative: optional)
   │
Quant: active model per timeframe scores new closed bars → fuse 5m/15m/1h → gate (confidence ≥ 0.62 and edge ≥ min) → strategies → SignalProposal
   │
Risk Officer: RiskManager (deterministic, never learns) → RiskDecision; optional LLM veto (JSON; parse failure ⇒ abort)
   │
Trader: validate numbers (size > 0, stop ≠ entry, side-correct stop/TP, expiry) → OMS (idempotent id) → router → Paper | Alpaca (+ shadow paper book when live)
   │
Logger: trader_audit row per proposal (features snapshot, model version + hash, all node messages, risk decision, order ids, fills), rationale text
```

Any node throwing aborts the cycle: no order is placed after the failing node, the cycle is recorded as `aborted` with the reason, and an alert is raised. The backtester and Simulation Mode call the same Quant gating, strategies, RiskManager and fill simulator.

## 6. Safety defaults

- Paper mode on every install. Live requires: `LIVE_TRADING_BUILD_ENABLED = true` in `src/main/trader/config.ts` (code change) + every go-live checklist item + typed `TRADE LIVE`.
- Go-live checklist: consent accepted; ≥ 14 days of paper trading with ≥ 10 closed trades and drawdown within the limit; risk limits at or below the conservative ceiling (≤ 0.5 % risk per trade, ≤ 2 % daily loss); kill switch tested in the last 30 days; separate market-data and trading keys.
- Risk defaults: 0.5 % equity risked per trade, 10 % max single position, 60 % max gross exposure, 5 positions, 2 % daily loss circuit breaker (halts new entries across the book), 30 % max per sector, ≤ 1 % of average daily volume, stale-data block, long-only (shorts opt-in).
- Model promotion: first model only if it beats the heuristic baselines out-of-sample; later models only after beating the incumbent on the latest walk-forward window **and** 3 consecutive winning shadow days. Manual promotion is possible in paper mode with a typed confirmation.
- LLM budget: ≤ 2 calls per tick; rationale is written after orders are placed so it never delays execution.

## 7. Verification (2026-09-24/25)

Definition-of-Done tests per phase live in `tests/main/trader/phase{1..6}-*.test.ts` (58 tests; synthetic session-aligned AR(1) data with a learnable edge + a pure-noise control):

| Phase | DoD evidence |
|---|---|
| 1 Data + features | fetch-and-store AAPL 1h (store + lake, incremental upsert); RSI/ATR/ROC non-null; features provably causal (changing future bars never changes past rows); label = return at t+h |
| 2 Model + backtest | GBDT promoted on ≥ 6 months with AUC and Sharpe above both baselines; noise-trained model rejected; vectorized engine reproduces an analytic equity/Sharpe; report JSON + equity CSV written |
| 3 Risk + signals | bad-stop and over-sized orders rejected at confidence 0.99 and audited with every rule's reason; scheduler fires once per bar under a lease |
| 4 Paper loop | 5 simulated business days through the full graph; orders ↔ signals ↔ fills ↔ ledger ↔ equity CSV consistent; zero requests to a real broker; breaker trips on a gap-down loss and halts entries; node failure / missing data / unparseable LLM veto each abort with no orders |
| 5 Broker + go-live | Alpaca bracket orders with client ids; lost POST response recovered via client id (1 POST); live gated by build flag + checklist + typed confirmation; first live order filled, recorded, mirrored to the shadow book with slippage per order; stop leg closes the trade; flatten kill switch closes all simulated positions in one call |
| 6 Ops | Prometheus text + 127.0.0.1 endpoint; data-gap injection → alert + stale symbols untraded; drift / fill-failure alerts + webhook; candidate promoted only after 3 winning shadow days, losers reverted; incremental retrain evaluated only on unseen bars; nightly/weekly crons |

Real app, real market data (Yahoo, 24 symbols, market open): backfill 20,760 × 1h and 26,208 × 15m bars in < 3 s each; both trained models were **rejected** by the promotion gate (test AUC ≈ 0.515; live confidences 0.50–0.54), which is the gate working. With a manually promoted model and demo thresholds, a live tick ingested fresh bars, scored 24 symbols, approved and sized 5 signals and submitted 5 paper orders in 881 ms (≈ 600 ms of it network); event backtest (40 days, 67 trades) and a one-session simulation completed from the UI.
